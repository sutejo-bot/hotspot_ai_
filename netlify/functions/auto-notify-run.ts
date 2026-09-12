// Netlify Serverless Function for manual auto-notify execution
// Replicates /api/auto-notify/run in serverless Netlify environment
import fs from "fs";
import { checkHotspotZone } from "../../src/data";
import { findNearestLocalVillage } from "../../src/villageData";

interface HandlerEvent {
  httpMethod: string;
  body: string | null;
}

interface HandlerResponse {
  statusCode: number;
  headers?: Record<string, string | boolean | number>;
  body: string;
}

const STORAGE_FILE = "/tmp/notified_hotspots.json";

function getStorage(): {
  createdAt: string;
  updatedAt: string;
  lastRunTime?: string | null;
  lastCheckStatus?: string;
  hotspots: Record<string, any>;
} {
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      return JSON.parse(fs.readFileSync(STORAGE_FILE, "utf-8"));
    }
  } catch {}
  return {
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastRunTime: null,
    lastCheckStatus: "Belum berjalan",
    hotspots: {}
  };
}

function saveStorage(data: any) {
  try {
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch {}
}

// Reverse geocode with local village database fallback to ArcGIS
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

    const parts: string[] = [];
    if (ds) parts.push(ds.toLowerCase().includes("desa") ? ds : `Desa ${ds}`);
    if (kec) parts.push(`Kec. ${kec}`);
    if (kab) parts.push(`Kab. ${kab}`);
    return parts.length > 0 ? parts.join(", ") : "Wilayah Konsesi PT Adaro Indonesia";
  } catch {
    return "Wilayah Konsesi PT Adaro Indonesia";
  }
}

function formatWITA(dateObj: Date): string {
  const days = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  const months = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
  ];
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
  if (!token || !chatId) return false;

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
    return res.ok;
  } catch {
    return false;
  }
}

export const handler = async (event: HandlerEvent): Promise<HandlerResponse> => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  const apiKey = process.env.NASA_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: "NASA_API_KEY belum dikonfigurasi pada Environment Variables di Netlify."
      })
    };
  }

  try {
    const bbox = "114.85,-2.35,115.65,-2.05";
    const sources = ["VIIRS_SNPP_NRT", "MODIS_NRT", "VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT"];

    const csvResults = await Promise.all(
      sources.map(async (src) => {
        const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${apiKey}/${src}/${bbox}/1`;
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
          if (!res.ok) return "";
          return await res.text();
        } catch {
          return "";
        }
      })
    );

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

        const acqDate = cols[5] || "";
        const acqTime = cols[6] || "";

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
          detectedCandidates.push({ id, lat, lng, confidence, detectedAt, zone });
        }
      }
    }

    const storage = getStorage();
    const isFirstRun = Object.keys(storage.hotspots).length === 0;

    if (isFirstRun) {
      for (const c of detectedCandidates) {
        const loc = findNearestLocalVillage(c.lat, c.lng) || "Wilayah Operasional Adaro";
        storage.hotspots[c.id] = {
          id: c.id,
          lat: c.lat,
          lng: c.lng,
          detectedAt: c.detectedAt.toISOString(),
          notifiedAt: new Date().toISOString(),
          location: loc,
          zone: c.zone,
          status: "initial_baseline"
        };
      }
      storage.lastRunTime = new Date().toISOString();
      storage.lastCheckStatus = `Inisialisasi berhasil: ${detectedCandidates.length} hotspot tercatat sebagai baseline.`;
      saveStorage(storage);

      const recent = Object.values(storage.hotspots).slice(0, 15);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          result: { checked: detectedCandidates.length, newHotspots: 0, notified: [] },
          status: {
            enabled: true,
            intervalMinutes: 10,
            lastRunTime: storage.lastRunTime,
            lastCheckStatus: storage.lastCheckStatus,
            newHotspotsDetectedLastRun: 0,
            totalTrackedHotspots: Object.keys(storage.hotspots).length,
            telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
            whatsappConfigured: Boolean(process.env.FONNTE_TOKEN),
            recentNotifications: recent
          }
        })
      };
    }

    const newHotspots = detectedCandidates.filter(c => !storage.hotspots[c.id]);
    const notifiedIds: string[] = [];

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
      storage.hotspots[h.id] = {
        id: h.id,
        lat: h.lat,
        lng: h.lng,
        detectedAt: h.detectedAt.toISOString(),
        notifiedAt: new Date().toISOString(),
        location: locationName,
        zone: h.zone,
        status: "notified"
      };
      if (tgSent) notifiedIds.push(h.id);
    }

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
        status: "notified"
      };
    }

    storage.lastRunTime = new Date().toISOString();
    storage.lastCheckStatus = newHotspots.length > 0
      ? `Sukses: ${newHotspots.length} hotspot baru terdeteksi dan notifikasi dikirim.`
      : `Pemeriksaan selesai: Tidak ada titik api baru (${detectedCandidates.length} terpantau aman).`;
    saveStorage(storage);

    const allList = Object.values(storage.hotspots) as any[];
    allList.sort((a, b) => new Date(b.notifiedAt).getTime() - new Date(a.notifiedAt).getTime());

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        result: {
          checked: detectedCandidates.length,
          newHotspots: newHotspots.length,
          notified: notifiedIds
        },
        status: {
          enabled: true,
          intervalMinutes: 10,
          lastRunTime: storage.lastRunTime,
          lastCheckStatus: storage.lastCheckStatus,
          newHotspotsDetectedLastRun: newHotspots.length,
          totalTrackedHotspots: allList.length,
          telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
          whatsappConfigured: Boolean(process.env.FONNTE_TOKEN),
          recentNotifications: allList.slice(0, 15)
        }
      })
    };
  } catch (err: any) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: err?.message || "Gagal memproses pemeriksaan hotspot di Netlify"
      })
    };
  }
};
