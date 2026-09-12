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
    status: string;
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
  source?: string;
  clusterWith?: string;
  status: "initial_baseline" | "notified" | "cluster_duplicate";
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

// In-memory cache of notified IDs for fast lookup
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

function calculateDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  // Equatorial approximation for South Kalimantan (lat ~ -2.2°)
  const dLat = (lat1 - lat2) * 111.0;
  const dLng = (lng1 - lng2) * 110.9;
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

// Find if hotspot belongs to an existing fire cluster notified within the last 24h & 1.5 km
function findExistingRecentCluster(
  lat: number,
  lng: number,
  detectedAt: Date,
  storage: StorageData,
  radiusKm = 1.5,
  windowHours = 24
): StoredHotspot | null {
  const candidateTime = detectedAt.getTime();

  for (const item of Object.values(storage.hotspots)) {
    const itemTime = new Date(item.detectedAt || item.notifiedAt).getTime();
    const diffHours = Math.abs(candidateTime - itemTime) / (1000 * 60 * 60);

    // Only compare against hotspots from the past 24 hours
    if (diffHours <= windowHours) {
      const dist = calculateDistanceKm(lat, lng, item.lat, item.lng);
      if (dist <= radiusKm) {
        return item;
      }
    }
  }

  return null;
}

// Parser for identifying satellite & agency source from row columns
function parseSourceFromRow(cols: string[]): { source: string; satellite: string; agency: string } {
  const sat = (cols[7] || cols[8] || "").trim();
  const inst = (cols[8] || "").trim();

  // Himawari-8 / Himawari-9 (JMA / JAXA Jepang & BMKG)
  if (sat.toLowerCase().includes("himawari") || sat === "H08" || sat === "H09" || inst.toLowerCase().includes("ahi")) {
    return {
      source: "Satelit Jepang: Himawari-9 (JMA & BMKG)",
      satellite: "Himawari-9 (Jepang)",
      agency: "JMA / BMKG",
    };
  }

  // Suomi-NPP (VIIRS) - digunakan SiPongi+ KLHK & NASA
  if (sat === "N" || sat.toLowerCase().includes("snpp") || sat.toLowerCase().includes("suomi")) {
    return {
      source: "SiPongi+ KLHK & NASA: Suomi-NPP (VIIRS)",
      satellite: "Suomi-NPP",
      agency: "SiPongi+ (KLHK) / NASA",
    };
  }

  // NOAA-20 / JPSS-1 (VIIRS) - digunakan BRIN INDOFIRMS & BMKG
  if (sat === "N20" || sat.toLowerCase().includes("noaa-20") || sat.toLowerCase().includes("j01")) {
    return {
      source: "BRIN INDOFIRMS & BMKG: NOAA-20 (VIIRS)",
      satellite: "NOAA-20",
      agency: "BRIN / BMKG",
    };
  }

  // NOAA-21 / JPSS-2 (VIIRS) - digunakan SiPongi+ KLHK & BRIN
  if (sat === "N21" || sat.toLowerCase().includes("noaa-21") || sat.toLowerCase().includes("j02")) {
    return {
      source: "SiPongi+ KLHK & BRIN: NOAA-21 (VIIRS)",
      satellite: "NOAA-21",
      agency: "SiPongi+ / BRIN",
    };
  }

  // MODIS Aqua (NASA & BMKG)
  if (sat.toLowerCase().includes("aqua") || (inst === "MODIS" && sat.toLowerCase().includes("a"))) {
    return {
      source: "BMKG & NASA: Aqua (MODIS)",
      satellite: "Aqua",
      agency: "BMKG / NASA",
    };
  }

  // MODIS Terra (SiPongi+ KLHK & NASA)
  if (sat.toLowerCase().includes("terra") || (inst === "MODIS" && sat.toLowerCase().includes("t"))) {
    return {
      source: "SiPongi+ KLHK & NASA: Terra (MODIS)",
      satellite: "Terra",
      agency: "SiPongi+ / NASA",
    };
  }

  // Landsat-8 / Landsat-9 (BRIN & USGS)
  if (sat.toLowerCase().includes("landsat") || sat === "L8" || sat === "L9" || inst.toLowerCase().includes("oli") || inst.toLowerCase().includes("tirs")) {
    return {
      source: "BRIN & USGS: Landsat-8/9 (TIRS)",
      satellite: "Landsat-8/9",
      agency: "BRIN / USGS",
    };
  }

  return {
    source: "Multi-Satelit Terintegrasi (Jepang Himawari / BRIN / SiPongi / BMKG)",
    satellite: "Multi-Satelit",
    agency: "Terintegrasi",
  };
}

// Clean records older than 7 days to keep file size optimized
function pruneOldHotspots(storage: StorageData, maxAgeDays = 7) {
  const now = Date.now();
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  let pruned = 0;

  for (const [id, item] of Object.entries(storage.hotspots)) {
    const time = new Date(item.detectedAt || item.notifiedAt).getTime();
    if (now - time > maxAgeMs) {
      delete storage.hotspots[id];
      pruned++;
    }
  }

  if (pruned > 0) {
    console.log(`[AutoNotifier] 🧹 Membersihkan ${pruned} rekaman hotspot lama (> 7 hari).`);
  }
}

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
    pruneOldHotspots(data, 7);
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
      headers: { "User-Agent": "AdaroHotspotMonitor/1.0" },
      signal: AbortSignal.timeout(4000)
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
  source?: string;
}): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return false;
  }

  const zoneLabel =
    hotspot.zone === "iupk"
      ? "IUPK PT Adaro Indonesia (Area Inti Tambang / Pelabuhan Kelanis)"
      : "Buffer 1 KM (Konsesi / Koridor Hauling Road)";

  const sourceName = hotspot.source || "Multi-Satelit Terintegrasi (Jepang / BRIN / SiPongi / BMKG)";

  const pesan =
    `🚨 *PERINGATAN DINI KARHUTLA - DETEKSI OTOMATIS* 🚨\n\n` +
    `Sistem mendeteksi adanya anomali termal / titik api baru di area operasional Adaro Indonesia:\n\n` +
    `🔥 *ID Hotspot*: \`${hotspot.id}\`\n` +
    `🛰️ *Sumber Satelit*: ${sourceName}\n` +
    `📍 *Koordinat*: \`${hotspot.lat}, ${hotspot.lng}\`\n` +
    `🗺️ *Lokasi*: ${hotspot.location}\n` +
    `🕒 *Waktu Satelit*: ${hotspot.date}\n` +
    `🎯 *Tingkat Keyakinan*: ${hotspot.confidence}%\n` +
    `🛡️ *Kategori Wilayah*: ${zoneLabel}\n\n` +
    `🤖 *Status Sistem*: Notifikasi otomatis 24/7 (Fusi Klaster & Anti-Tumpang Tindih 1.5 km / 24 Jam Aktif).\n` +
    `⚠️ *Perhatian Petugas Satgas*: Harap segera lakukan verifikasi darat (ground check) di lokasi tersebut.\n\n` +
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
      const errBody = await res.text();
      console.error("[AutoNotifier] Telegram API error:", res.status, errBody);
      return false;
    }

    console.log(`[AutoNotifier] 📨 Peringatan Telegram terkirim untuk ${hotspot.id}`);
    return true;
  } catch (err: any) {
    console.error("[AutoNotifier] Gagal mengirim peringatan Telegram:", err?.message || err);
    return false;
  }
}

// Send alert to WhatsApp via Fonnte if token is present
async function sendWhatsAppAlert(hotspot: {
  id: string;
  lat: number;
  lng: number;
  location: string;
  date: string;
  zone: string;
  confidence: number;
  source?: string;
}): Promise<boolean> {
  const fonnteToken = process.env.FONNTE_TOKEN;
  const target = process.env.FONNTE_TARGET_PHONE;

  if (!fonnteToken || !target) {
    return false;
  }

  const zoneLabel =
    hotspot.zone === "iupk"
      ? "IUPK PT Adaro Indonesia (Area Inti)"
      : "Buffer 1 KM (Konsesi / Koridor Hauling)";

  const sourceName = hotspot.source || "Multi-Satelit Terintegrasi (Jepang / BRIN / SiPongi / BMKG)";

  const pesan =
    `🚨 *PERINGATAN DINI KARHUTLA - DETEKSI OTOMATIS* 🚨\n\n` +
    `Sistem mendeteksi adanya titik api baru di area operasional Adaro:\n\n` +
    `🔥 *ID*: ${hotspot.id}\n` +
    `🛰️ *Sumber Satelit*: ${sourceName}\n` +
    `📍 *Koordinat*: ${hotspot.lat}, ${hotspot.lng}\n` +
    `🗺️ *Lokasi*: ${hotspot.location}\n` +
    `🕒 *Waktu*: ${hotspot.date}\n` +
    `🎯 *Keyakinan*: ${hotspot.confidence}%\n` +
    `🛡️ *Zona*: ${zoneLabel}\n` +
    `⚡ *Anti-Duplikasi*: Klaster 1.5km/24h Aktif\n\n` +
    `📍 Google Maps: https://maps.google.com/?q=${hotspot.lat},${hotspot.lng}\n\n` +
    `Mohon satgas lapangan segera merespons.`;

  try {
    const res = await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: {
        Authorization: fonnteToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        target,
        message: pesan,
        countryCode: "62"
      }),
      signal: AbortSignal.timeout(6000)
    });

    if (res.ok) {
      console.log(`[AutoNotifier] 📱 Peringatan WhatsApp terkirim untuk ${hotspot.id}`);
      return true;
    }
    return false;
  } catch (err: any) {
    console.error("[AutoNotifier] Gagal mengirim WhatsApp:", err?.message || err);
    return false;
  }
}

export interface CheckCycleOptions {
  sendAlerts?: boolean; // If false, syncs baseline without sending any alerts
}

// Main hotspot check cycle logic
export async function runHotspotCheckCycle(options: CheckCycleOptions = { sendAlerts: true }): Promise<{
  checked: number;
  newHotspots: number;
  notified: string[];
}> {
  if (activeCheckPromise) {
    console.log("[AutoNotifier] Siklus pemantauan sedang berjalan, menggunakan hasil eksekusi aktif...");
    return activeCheckPromise;
  }

  const shouldSendAlerts = options.sendAlerts !== false;

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

    // NASA FIRMS & Multi-Satellite Sources for Adaro Concession + Kelanis Port + Hauling Road
    const bbox = "114.85,-2.35,115.65,-2.05";
    const sources = ["VIIRS_SNPP_NRT", "MODIS_NRT", "VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT", "LANDSAT_NRT"];

    try {
      let csvResults: string[] = [];
      if (cachedFirmsCsv && Date.now() - cachedFirmsCsv.timestamp < FIRMS_CACHE_TTL_MS) {
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
        if (csvResults.some((c) => c.length > 0)) {
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
        source: string;
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

          // Deterministic normalized ID
          const latKey = Math.abs(lat).toFixed(3).replace(".", "");
          const lngKey = Math.abs(lng).toFixed(3).replace(".", "");
          const paddedTime = (acqTime || "0000").padStart(4, "0");
          const dateKey = acqDate.replace(/-/g, "");
          const id = `HS-${latKey}-${lngKey}-${dateKey}-${paddedTime}`;

          const srcInfo = parseSourceFromRow(cols);

          if (!seenIds.has(id)) {
            seenIds.add(id);
            detectedCandidates.push({
              id,
              lat,
              lng,
              confidence,
              detectedAt,
              zone,
              source: srcInfo.source,
            });
          }
        }
      }

      // If initial baseline run OR first run ever OR shouldSendAlerts is false:
      // Record all existing visible hotspots silently WITHOUT sending any notification!
      if (!shouldSendAlerts || isFirstRunEver) {
        console.log(
          `[AutoNotifier] 📋 Sinkronisasi baseline: Menemukan ${detectedCandidates.length} titik api dari multi-satelit. Dicatat tanpa notifikasi.`
        );
        for (const c of detectedCandidates) {
          if (!storage.hotspots[c.id]) {
            storage.hotspots[c.id] = {
              id: c.id,
              lat: c.lat,
              lng: c.lng,
              detectedAt: c.detectedAt.toISOString(),
              notifiedAt: new Date().toISOString(),
              location: findNearestLocalVillage(c.lat, c.lng) || "Wilayah Operasional Adaro",
              zone: c.zone,
              source: c.source,
              status: "initial_baseline",
              telegramSent: false,
              waSent: false
            };
          }
        }
        lastCheckStatus = `Baseline aktif: ${detectedCandidates.length} hotspot tercatat aman tanpa kirim notifikasi.`;
        lastNewCount = 0;
        saveStorage(storage);
        return { checked: detectedCandidates.length, newHotspots: 0, notified: [] };
      }

      // FILTERING GENUINE NEW HOTSPOTS:
      // 1. Must not have been recorded before in storage
      // 2. Must NOT match any existing fire cluster notified within 1.5 km in the last 24 hours!
      const genuineNewHotspots: typeof detectedCandidates = [];

      for (const candidate of detectedCandidates) {
        // If exact ID is already known, skip
        if (storage.hotspots[candidate.id]) {
          continue;
        }

        // Check if this hotspot is within 1.5 km of a fire already notified in the last 24h
        const existingCluster = findExistingRecentCluster(
          candidate.lat,
          candidate.lng,
          candidate.detectedAt,
          storage,
          1.5,
          24
        );

        if (existingCluster) {
          // It's the same fire cluster detected across multiple satellites! Record as cluster_duplicate without sending repeated alert
          storage.hotspots[candidate.id] = {
            id: candidate.id,
            lat: candidate.lat,
            lng: candidate.lng,
            detectedAt: candidate.detectedAt.toISOString(),
            notifiedAt: new Date().toISOString(),
            location: existingCluster.location || "Wilayah Operasional Adaro",
            zone: candidate.zone,
            source: candidate.source,
            clusterWith: existingCluster.id,
            status: "cluster_duplicate",
            telegramSent: false,
            waSent: false
          };
          console.log(`[AutoNotifier] 🛡️ Anti-tumpang tindih: Hotspot ${candidate.id} (${candidate.source}) terfusi dengan klaster aktif ${existingCluster.id}. Notifikasi berulang dicegah.`);
          continue;
        }

        // GENUINE NEW HOTSPOT
        genuineNewHotspots.push(candidate);
      }

      const notifiedIds: string[] = [];

      if (genuineNewHotspots.length > 0) {
        console.log(
          `[AutoNotifier] 🚨 TERDETEKSI ${genuineNewHotspots.length} TITIK API BARU (DI LUAR KLASTER AKTIF)! Mengirim notifikasi otomatis...`
        );

        // Limit individual alert sends to at most 5 per cycle to prevent spamming/timeouts
        const alertsToSend = genuineNewHotspots.slice(0, 5);

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
            confidence: h.confidence,
            source: h.source
          });

          const waSent = await sendWhatsAppAlert({
            id: h.id,
            lat: h.lat,
            lng: h.lng,
            location: locationName,
            date: formattedDate,
            zone: h.zone,
            confidence: h.confidence,
            source: h.source
          });

          storage.hotspots[h.id] = {
            id: h.id,
            lat: h.lat,
            lng: h.lng,
            detectedAt: h.detectedAt.toISOString(),
            notifiedAt: new Date().toISOString(),
            location: locationName,
            zone: h.zone,
            source: h.source,
            status: "notified",
            telegramSent: tgSent,
            waSent: waSent
          };

          if (tgSent || waSent) {
            notifiedIds.push(h.id);
          }
        }

        // Record any remaining genuine new hotspots (> 5) as tracked
        for (let i = 5; i < genuineNewHotspots.length; i++) {
          const h = genuineNewHotspots[i];
          storage.hotspots[h.id] = {
            id: h.id,
            lat: h.lat,
            lng: h.lng,
            detectedAt: h.detectedAt.toISOString(),
            notifiedAt: new Date().toISOString(),
            location: "Wilayah Operasional Adaro",
            zone: h.zone,
            source: h.source,
            status: "notified",
            telegramSent: false,
            waSent: false
          };
        }

        lastCheckStatus = `Sukses: ${genuineNewHotspots.length} hotspot baru terdeteksi dan notifikasi otomatis dikirim.`;
        saveStorage(storage);
      } else {
        lastCheckStatus = `Pemeriksaan selesai: Tidak ada titik api baru di area konsesi (${detectedCandidates.length} hotspot aktif terpantau aman).`;
        saveStorage(storage);
      }

      lastNewCount = genuineNewHotspots.length;
      return {
        checked: detectedCandidates.length,
        newHotspots: genuineNewHotspots.length,
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
export function startAutoNotifier(intervalMinutes = 10) {
  const envInterval = parseInt(process.env.AUTO_NOTIFY_INTERVAL_MINUTES || "", 10);
  const minutes = !isNaN(envInterval) && envInterval > 0 ? envInterval : intervalMinutes;
  const intervalMs = minutes * 60 * 1000;

  console.log(
    `[AutoNotifier] 🛡️ Memulai Layanan Pemantauan Otomatis Karhutla Adaro (Interval: setiap ${minutes} menit)...`
  );

  // SILENT BASELINE SYNC ON STARTUP:
  // Catat semua hotspot yang sedang aktif saat ini tanpa mengirim notifikasi apapun.
  // Ini memastikan saat aplikasi dibuka / diakses / restart, TIDAK ADA spam notifikasi ke Telegram!
  setTimeout(() => {
    runHotspotCheckCycle({ sendAlerts: false })
      .then((res) => {
        console.log(
          `[AutoNotifier] Sinkronisasi baseline selesai (${res.checked} hotspot aktif dicatat aman, 0 notifikasi).`
        );
      })
      .catch((err) => {
        console.error("[AutoNotifier] Kesalahan sinkronisasi baseline:", err);
      });
  }, 3000);

  // Jadwalkan pengecekan otomatis mandiri 24/7 di latar belakang
  if (timerId) clearInterval(timerId);
  timerId = setInterval(() => {
    runHotspotCheckCycle({ sendAlerts: true })
      .then((res) => {
        if (res.newHotspots > 0) {
          console.log(`[AutoNotifier] 🚨 ${res.newHotspots} hotspot baru terdeteksi & notifikasi otomatis terkirim.`);
        }
      })
      .catch((err) => {
        console.error("[AutoNotifier] Error siklus berkala:", err);
      });
  }, intervalMs);

  return timerId;
}

// Stop autonomous background scheduler
export function stopAutoNotifier() {
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
    console.log("[AutoNotifier] Layanan pemantau latar belakang dihentikan.");
  }
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
    zone: h.zone,
    status: h.status
  }));

  const envInterval = parseInt(process.env.AUTO_NOTIFY_INTERVAL_MINUTES || "", 10);
  const minutes = !isNaN(envInterval) && envInterval > 0 ? envInterval : 10;

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
