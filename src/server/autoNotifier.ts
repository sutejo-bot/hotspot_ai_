import fs from "fs";
import path from "path";
import { checkHotspotZone } from "../data";
import { findNearestLocalVillage } from "../villageData";

export interface AutoNotifierStatus {
  enabled: boolean;
  intervalMinutes: number;
  lastRunTime: string | null;
  lastCheckStatus: string;
  newHotspotsDetectedLastRun: number;
  totalTrackedHotspots: number;
  telegramConfigured: boolean;
  whatsappConfigured: boolean;
  recentNotifications: Array<{
    id: string;
    lat: number;
    lng: number;
    detectedAt: string;
    notifiedAt: string;
    location: string;
    zone: string;
  }>;
}

const DATA_DIR = path.join(process.cwd(), "data");
const STORAGE_FILE = path.join(DATA_DIR, "notified_hotspots.json");

interface StoredHotspot {
  id: string;
  lat: number;
  lng: number;
  detectedAt: string;
  notifiedAt: string;
  location: string;
  zone: string;
  status: "initial_baseline" | "notified";
  telegramSent: boolean;
  waSent: boolean;
}

interface StorageData {
  createdAt: string;
  updatedAt: string;
  lastRunTime?: string | null;
  lastCheckStatus?: string;
  hotspots: Record<string, StoredHotspot>;
}

// In-memory cache of notified IDs for ultra-fast lookup
let storageCache: StorageData | null = null;
let lastRunTime: string | null = null;
let lastCheckStatus = "Belum berjalan";
let lastNewCount = 0;
let timerId: NodeJS.Timeout | null = null;

// Mutex & caching for checking cycle
let activeCheckPromise: Promise<{
  checked: number;
  newHotspots: number;
  notified: string[];
}> | null = null;
let cachedFirmsCsv: { data: string[]; timestamp: number } | null = null;
const FIRMS_CACHE_TTL_MS = 60 * 1000; // 60s cache

function ensureStorage(): StorageData {
  if (storageCache) return storageCache;

  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    if (fs.existsSync(STORAGE_FILE)) {
      const raw = fs.readFileSync(STORAGE_FILE, "utf-8");
      storageCache = JSON.parse(raw);
      if (storageCache?.lastRunTime && !lastRunTime) {
        lastRunTime = storageCache.lastRunTime;
      }
      if (storageCache?.lastCheckStatus && lastCheckStatus === "Belum berjalan") {
        lastCheckStatus = storageCache.lastCheckStatus;
      }
      return storageCache!;
    }
  } catch (err) {
    console.error("[AutoNotifier] Gagal membaca storage file:", err);
  }

  storageCache = {
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastRunTime: null,
    lastCheckStatus: "Siap",
    hotspots: {}
  };
  saveStorage(storageCache);
  return storageCache;
}

function saveStorage(data: StorageData) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    data.updatedAt = new Date().toISOString();
    data.lastRunTime = lastRunTime;
    data.lastCheckStatus = lastCheckStatus;
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2), "utf-8");
    storageCache = data;
  } catch (err) {
    console.error("[AutoNotifier] Gagal menyimpan storage file:", err);
  }
}

// Reverse geocode via local database first, then ArcGIS
async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const local = findNearestLocalVillage(lat, lng);
  if (local) return local;

  try {
    const url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode?location=${lng},${lat}&f=json`;
    const res = await fetch(url, {
      headers: { "User-Agent": "AdaroHotspotMonitor/1.0" }
    });
    if (!res.ok) return "Wilayah Konsesi PT Adaro Indonesia";
    const data = await res.json();
    const addr = data.address || {};
    const ds = addr.Neighborhood || addr.PlaceName || "";
    const kec = addr.City || addr.District || "";
    const kab = addr.Subregion || addr.MetroArea || "";
    const prov = addr.Region || "";

    const parts: string[] = [];
    if (ds) {
      if (ds.toLowerCase().includes("desa") || ds.toLowerCase().includes("kelurahan")) {
        parts.push(ds);
      } else {
        parts.push(`Desa/Kel. ${ds}`);
      }
    }
    if (kec) parts.push(`Kec. ${kec}`);
    if (kab) {
      if (kab.toLowerCase().includes("kabupaten") || kab.toLowerCase().includes("kota")) {
        parts.push(kab);
      } else {
        parts.push(`Kab. ${kab}`);
      }
    }
    if (prov) parts.push(prov);

    return parts.length > 0 ? parts.join(", ") : "Wilayah Sekitar Konsesi Adaro";
  } catch {
    return "Wilayah Konsesi PT Adaro Indonesia";
  }
}

// Format timestamp to WITA (UTC+8) in standard Indonesian style
function formatWITA(dateObj: Date): string {
  const days = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  const months = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
  ];

  // Shift UTC by +8 hours for WITA
  const witaTime = new Date(dateObj.getTime() + 8 * 60 * 60 * 1000);

  const dayName = days[witaTime.getUTCDay()];
  const dateNum = witaTime.getUTCDate();
  const monthName = months[witaTime.getUTCMonth()];
  const year = witaTime.getUTCFullYear();
  const hours = String(witaTime.getUTCHours()).padStart(2, "0");
  const minutes = String(witaTime.getUTCMinutes()).padStart(2, "0");
  const seconds = String(witaTime.getUTCSeconds()).padStart(2, "0");

  return `${dayName}, ${dateNum} ${monthName} ${year} ${hours}.${minutes}.${seconds} WITA`;
}

// Send alert to Telegram Bot
async function sendTelegramAlert(hotspot: {
  id: string;
  lat: number;
  lng: number;
  location: string;
  date: string;
  zone: string;
  confidence: number;
}): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn("[AutoNotifier] ⚠️ TELEGRAM_BOT_TOKEN atau TELEGRAM_CHAT_ID belum terkonfigurasi.");
    return false;
  }

  const zoneLabel = hotspot.zone === "iupk"
    ? "IUPK PT Adaro Indonesia (Area Inti Tambang / Pelabuhan Kelanis)"
    : "Buffer 1 KM (Konsesi / Koridor Hauling Road)";

  const pesan = `🚨 *PERINGATAN DINI KARHUTLA - DETEKSI OTOMATIS* 🚨\n\n` +
    `Sistem mendeteksi adanya anomali termal / titik api baru di area operasional Adaro Indonesia:\n\n` +
    `🔥 *ID Hotspot*: \`${hotspot.id}\`\n` +
    `📍 *Koordinat*: \`${hotspot.lat}, ${hotspot.lng}\`\n` +
    `🗺️ *Lokasi*: ${hotspot.location}\n` +
    `🕒 *Waktu Satelit*: ${hotspot.date}\n` +
    `🎯 *Keyakinan*: ${hotspot.confidence}%\n` +
    `🛡️ *Kategori Wilayah*: ${zoneLabel}\n\n` +
    `🤖 *Status*: Notifikasi ini dikirim secara otomatis oleh server pemantau satelit 24/7.\n` +
    `⚠️ *Perhatian Petugas*: Segera hubungi posko satgas terdekat untuk pengecekan darat!\n\n` +
    `📍 *Buka Titik di Google Maps:*\n` +
    `https://maps.google.com/?q=${hotspot.lat},${hotspot.lng}`;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: pesan,
        parse_mode: "Markdown"
      }),
      signal: AbortSignal.timeout(6000)
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("[AutoNotifier] Telegram API Error:", errText);
      return false;
    }

    console.log(`[AutoNotifier] ✅ Berhasil mengirim Telegram untuk hotspot ${hotspot.id}`);
    return true;
  } catch (err) {
    console.error("[AutoNotifier] Gagal menghubungi Telegram API:", err);
    return false;
  }
}

// Send alert to WhatsApp via Fonnte (optional)
async function sendWhatsAppAlert(hotspot: {
  id: string;
  lat: number;
  lng: number;
  location: string;
  date: string;
  zone: string;
  confidence: number;
}): Promise<boolean> {
  const token = process.env.FONNTE_TOKEN;
  const target = process.env.FONNTE_TARGET || "085821237889";

  if (!token) return false;

  const zoneLabel = hotspot.zone === "iupk"
    ? "IUPK PT Adaro Indonesia (Inti Tambang / Kelanis)"
    : "Buffer 1 KM (Konsesi / Hauling Road)";

  const pesan = `🚨 *DARURAT KARHUTLA - DETEKSI OTOMATIS* 🚨\n\n` +
    `Terdeteksi titik api baru!\n\n` +
    `🔥 *ID*: ${hotspot.id}\n` +
    `📍 *Koordinat*: ${hotspot.lat}, ${hotspot.lng}\n` +
    `🗺️ *Lokasi*: ${hotspot.location}\n` +
    `🕒 *Waktu*: ${hotspot.date}\n` +
    `🎯 *Confidence*: ${hotspot.confidence}%\n` +
    `🛡️ *Zona*: ${zoneLabel}\n\n` +
    `🤖 *Status*: Notifikasi ini dikirim secara otomatis oleh server 24/7.\n` +
    `Segera lakukan pengecekan ke lokasi!\n\n` +
    `📍 *Buka Peta:*\nhttps://maps.google.com/?q=${hotspot.lat},${hotspot.lng}`;

  try {
    const formData = new URLSearchParams();
    formData.append("target", target);
    formData.append("message", pesan);
    formData.append("countryCode", "62");

    const res = await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: {
        Authorization: token,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: formData.toString(),
      signal: AbortSignal.timeout(6000)
    });

    return res.ok;
  } catch {
    return false;
  }
}

// Main background checking logic
export async function runHotspotCheckCycle(): Promise<{
  checked: number;
  newHotspots: number;
  notified: string[];
}> {
  if (activeCheckPromise) {
    console.log("[AutoNotifier] Siklus pemantauan sedang berjalan, menggunakan eksekusi aktif...");
    return activeCheckPromise;
  }

  activeCheckPromise = (async () => {
    lastRunTime = new Date().toISOString();
    const apiKey = process.env.NASA_API_KEY;

    if (!apiKey) {
      lastCheckStatus = "Error: NASA_API_KEY belum dikonfigurasi di server";
      console.warn(`[AutoNotifier] ⚠️ ${lastCheckStatus}`);
      return { checked: 0, newHotspots: 0, notified: [] };
    }

    const storage = ensureStorage();
    const isFirstRunEver = Object.keys(storage.hotspots).length === 0;

    // NASA FIRMS Bounding Box for Adaro Concession + Kelanis Port + Hauling Road
    const bbox = "114.85,-2.35,115.65,-2.05";
    const sources = ["VIIRS_SNPP_NRT", "MODIS_NRT", "VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT"];

    try {
      let csvResults: string[] = [];
      if (cachedFirmsCsv && (Date.now() - cachedFirmsCsv.timestamp < FIRMS_CACHE_TTL_MS)) {
        csvResults = cachedFirmsCsv.data;
      } else {
        csvResults = await Promise.all(
          sources.map(async (src) => {
            const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${apiKey}/${src}/${bbox}/1`;
            try {
              const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
              if (!res.ok) return "";
              return await res.text();
            } catch (err: any) {
              console.warn(`[AutoNotifier] FIRMS fetch gagal untuk ${src}:`, err?.message || err);
              return "";
            }
          })
        );
        if (csvResults.some(c => c.length > 0)) {
          cachedFirmsCsv = { data: csvResults, timestamp: Date.now() };
        }
      }

      const detectedCandidates: Array<{
        id: string;
        lat: number;
        lng: number;
        confidence: number;
        detectedAt: Date;
        zone: string;
      }> = [];

      const seenIds = new Set<string>();

      for (const text of csvResults) {
        const lines = text.trim().split("\n");
        if (lines.length <= 1) continue;

        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line || line.startsWith("latitude")) continue;

          const cols = line.split(",");
          const lat = parseFloat(cols[0]);
          const lng = parseFloat(cols[1]);
          if (isNaN(lat) || isNaN(lng)) continue;

          const zone = checkHotspotZone(lat, lng);
          if (zone === "outside") continue;

          const rawConf = cols[8] || cols[9] || "50";
          let confidence = 50;
          if (rawConf === "h") confidence = 95;
          else if (rawConf === "n") confidence = 75;
          else if (rawConf === "l") confidence = 30;
          else if (!isNaN(parseInt(rawConf, 10))) confidence = parseInt(rawConf, 10);

          const acqDate = cols[5] || ""; // YYYY-MM-DD
          const acqTime = cols[6] || ""; // HHMM UTC

          let detectedAt = new Date();
          if (acqDate) {
            const parts = acqDate.split("-").map(Number);
            const hours = acqTime ? acqTime.padStart(4, "0").substring(0, 2) : "00";
            const mins = acqTime ? acqTime.padStart(4, "0").substring(2, 4) : "00";
            detectedAt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], parseInt(hours, 10), parseInt(mins, 10)));
          }

          const latStr = Math.abs(lat).toFixed(4).replace(".", "");
          const lngStr = Math.abs(lng).toFixed(4).replace(".", "");
          const timePart = `${acqDate.replace(/-/g, "").slice(4)}${acqTime || ""}`;
          const id = `HS-${latStr}-${lngStr}-${timePart}`;

          if (!seenIds.has(id)) {
            seenIds.add(id);
            detectedCandidates.push({
              id,
              lat,
              lng,
              confidence,
              detectedAt,
              zone
            });
          }
        }
      }

      // If first run ever, establish baseline so we don't spam historical hotspots
      if (isFirstRunEver) {
        console.log(`[AutoNotifier] 📋 Inisialisasi awal: Menemukan ${detectedCandidates.length} titik api saat ini. Ditandai sebagai baseline awal.`);
        for (const c of detectedCandidates) {
          storage.hotspots[c.id] = {
            id: c.id,
            lat: c.lat,
            lng: c.lng,
            detectedAt: c.detectedAt.toISOString(),
            notifiedAt: new Date().toISOString(),
            location: "Wilayah Operasional Adaro",
            zone: c.zone,
            status: "initial_baseline",
            telegramSent: false,
            waSent: false
          };
        }
        lastCheckStatus = `Inisialisasi berhasil: ${detectedCandidates.length} hotspot tercatat sebagai baseline.`;
        lastNewCount = 0;
        saveStorage(storage);
        return { checked: detectedCandidates.length, newHotspots: 0, notified: [] };
      }

      // Identify genuine new hotspots that are not in storage
      const newHotspots = detectedCandidates.filter((c) => !storage.hotspots[c.id]);
      const notifiedIds: string[] = [];

      if (newHotspots.length > 0) {
        console.log(`[AutoNotifier] 🚨 TERDETEKSI ${newHotspots.length} TITIK API BARU! Mengirim notifikasi otomatis...`);

        // Limit individual alert sends to at most 5 per cycle to prevent rate-limits and timeouts
        const alertsToSend = newHotspots.slice(0, 5);

        for (const h of alertsToSend) {
          const locationName = await reverseGeocode(h.lat, h.lng);
          const formattedDate = formatWITA(h.detectedAt);

          const tgSent = await sendTelegramAlert({
            id: h.id,
            lat: h.lat,
            lng: h.lng,
            location: locationName,
            date: formattedDate,
            zone: h.zone,
            confidence: h.confidence
          });

          const waSent = await sendWhatsAppAlert({
            id: h.id,
            lat: h.lat,
            lng: h.lng,
            location: locationName,
            date: formattedDate,
            zone: h.zone,
            confidence: h.confidence
          });

          storage.hotspots[h.id] = {
            id: h.id,
            lat: h.lat,
            lng: h.lng,
            detectedAt: h.detectedAt.toISOString(),
            notifiedAt: new Date().toISOString(),
            location: locationName,
            zone: h.zone,
            status: "notified",
            telegramSent: tgSent,
            waSent: waSent
          };

          notifiedIds.push(h.id);
        }

        // Record any remaining new hotspots as tracked
        for (let i = 5; i < newHotspots.length; i++) {
          const h = newHotspots[i];
          storage.hotspots[h.id] = {
            id: h.id,
            lat: h.lat,
            lng: h.lng,
            detectedAt: h.detectedAt.toISOString(),
            notifiedAt: new Date().toISOString(),
            location: "Wilayah Operasional Adaro",
            zone: h.zone,
            status: "notified",
            telegramSent: false,
            waSent: false
          };
        }

        lastCheckStatus = `Sukses: ${newHotspots.length} hotspot baru terdeteksi dan notifikasi otomatis dikirim.`;
        saveStorage(storage);
      } else {
        lastCheckStatus = `Pemeriksaan selesai: Tidak ada titik api baru di area konsesi (${detectedCandidates.length} hotspot aktif terpantau aman).`;
        saveStorage(storage);
      }

      lastNewCount = newHotspots.length;
      return {
        checked: detectedCandidates.length,
        newHotspots: newHotspots.length,
        notified: notifiedIds
      };
    } catch (err: any) {
      lastCheckStatus = `Error pemeriksaan: ${err?.message || err}`;
      console.error("[AutoNotifier] Error saat menjalankan siklus pemantauan:", err);
      return { checked: 0, newHotspots: 0, notified: [] };
    }
  })().finally(() => {
    activeCheckPromise = null;
  });

  return activeCheckPromise;
}

// Start autonomous background scheduler
export function startAutoNotifier(intervalMinutes = 5) {
  const envInterval = parseInt(process.env.AUTO_NOTIFY_INTERVAL_MINUTES || "", 10);
  const minutes = !isNaN(envInterval) && envInterval > 0 ? envInterval : intervalMinutes;
  const intervalMs = minutes * 60 * 1000;

  console.log(`[AutoNotifier] 🛡️ Memulai Layanan Pemantauan Otomatis Karhutla Adaro (Interval: setiap ${minutes} menit)...`);

  // Run initial check 5 seconds after server start
  setTimeout(() => {
    runHotspotCheckCycle()
      .then((res) => {
        console.log(`[AutoNotifier] Siklus pertama selesai (${res.checked} diperiksa, ${res.newHotspots} baru)`);
      })
      .catch((err) => {
        console.error("[AutoNotifier] Kesalahan siklus pertama:", err);
      });
  }, 5000);

  // Set recurring timer
  if (timerId) clearInterval(timerId);
  timerId = setInterval(() => {
    runHotspotCheckCycle()
      .then((res) => {
        if (res.newHotspots > 0) {
          console.log(`[AutoNotifier] Siklus selesai: ${res.newHotspots} hotspot baru telah dikirim.`);
        }
      })
      .catch((err) => {
        console.error("[AutoNotifier] Error siklus berkala:", err);
      });
  }, intervalMs);

  return timerId;
}

// Status query function for API
export function getAutoNotifierStatus(): AutoNotifierStatus {
  const storage = ensureStorage();
  const allList = Object.values(storage.hotspots);

  // Sort newest notified first
  allList.sort((a, b) => new Date(b.notifiedAt).getTime() - new Date(a.notifiedAt).getTime());

  const recent = allList.slice(0, 15).map((h) => ({
    id: h.id,
    lat: h.lat,
    lng: h.lng,
    detectedAt: h.detectedAt,
    notifiedAt: h.notifiedAt,
    location: h.location,
    zone: h.zone
  }));

  const envInterval = parseInt(process.env.AUTO_NOTIFY_INTERVAL_MINUTES || "", 10);
  const minutes = !isNaN(envInterval) && envInterval > 0 ? envInterval : 5;

  return {
    enabled: true,
    intervalMinutes: minutes,
    lastRunTime,
    lastCheckStatus,
    newHotspotsDetectedLastRun: lastNewCount,
    totalTrackedHotspots: allList.length,
    telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
    whatsappConfigured: Boolean(process.env.FONNTE_TOKEN),
    recentNotifications: recent
  };
}
