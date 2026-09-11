import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { startAutoNotifier, getAutoNotifierStatus, runHotspotCheckCycle } from "./src/server/autoNotifier";

async function startServer() {
  const app = express();
  const PORT = 3000;
  
  app.use(express.json());

  // Simple in-memory cache for NASA FIRMS data (5 minutes TTL)
  const firmsCache = new Map<number, { data: string; timestamp: number }>();
  const CACHE_TTL_MS = 5 * 60 * 1000;

  // Helper to generate date chunks for NASA FIRMS (max 5 days per request)
  function getFirmsChunks(days: number) {
    const chunks: { date: string; range: number }[] = [];
    const today = new Date();
    const cur = new Date(today);
    cur.setDate(cur.getDate() - (days - 1));
    let remaining = days;
    while (remaining > 0) {
      const take = Math.min(remaining, 5);
      const dateStr = cur.toISOString().split("T")[0];
      chunks.push({ date: dateStr, range: take });
      cur.setDate(cur.getDate() + take);
      remaining -= take;
    }
    return chunks;
  }

  // API route for sending WhatsApp notifications via Fonnte
  app.post("/api/notify-wa", async (req, res) => {
    try {
      const { target, lat, lng, location, date, id, source, confidence, zone } = req.body;
      const token = process.env.FONNTE_TOKEN;
      
      if (!token) {
        return res.status(500).json({ error: "Token Fonnte belum dikonfigurasi. Harap tambahkan 'FONNTE_TOKEN' pada menu Environment Variables di pengaturan Netlify Anda." });
      }

      const isAuto = source === 'auto';
      const header = isAuto 
        ? `🚨 *DARURAT KARHUTLA - DETEKSI OTOMATIS* 🚨` 
        : `🚨 *DARURAT KARHUTLA - PENGIRIMAN MANUAL* 🚨`;

      const statusText = isAuto
        ? `🤖 *Status*: Notifikasi ini dikirim secara otomatis.`
        : `👤 *Status*: Notifikasi ini dikirim secara manual oleh operator.`;

      const zoneText = zone === 'iupk' 
        ? 'IUPK PT Adaro Indonesia' 
        : (zone === 'buffer' ? 'Buffer 1 KM' : 'Sekitar Wilayah Operasional');

      const pesan = `${header}\n\n` +
        `🔥 *ID*: ${id}\n` +
        `📍 *Koordinat*: ${lat}, ${lng}\n` +
        `🗺️ *Lokasi*: ${location || 'Sedang dimuat...'}\n` +
        `🕒 *Waktu*: ${date}\n` +
        `🛡️ *Zona*: ${zoneText}\n\n` +
        `${statusText}\n` +
        `Segera lakukan pengecekan ke lokasi!\n\n` +
        `📍 *Buka Peta:*\nhttps://maps.google.com/?q=${lat},${lng}`;

      const formData = new URLSearchParams();
      formData.append('target', target);
      formData.append('message', pesan);
      formData.append('countryCode', '62');

      const response = await fetch('https://api.fonnte.com/send', {
        method: 'POST',
        headers: {
          'Authorization': token,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: formData.toString()
      });

      if (!response.ok) {
        const errText = await response.text();
        return res.status(response.status).json({ error: errText });
      }

      const data = await response.json();
      
      // Fonnte sometimes returns HTTP 200 but status inside JSON is false
      if (data.status === false) {
        return res.status(400).json({ error: data.reason || "Fonnte API rejected the request." });
      }

      res.json(data);
    } catch (error: any) {
      console.error("Error sending WA:", error);
      res.status(500).json({ error: error.message || "Failed to send WhatsApp message" });
    }
  });

  // API route for sending Telegram notifications
  app.post("/api/notify-telegram", async (req, res) => {
    try {
      const { lat, lng, location, date, id, source, confidence, zone } = req.body;
      const token = process.env.TELEGRAM_BOT_TOKEN;
      const chatId = process.env.TELEGRAM_CHAT_ID;
      
      if (!token || !chatId) {
        return res.status(500).json({ error: "Token atau Chat ID Telegram belum dikonfigurasi. Harap tambahkan 'TELEGRAM_BOT_TOKEN' dan 'TELEGRAM_CHAT_ID' di menu Environment Variables." });
      }

      const isAuto = source === 'auto';
      const header = isAuto 
        ? `🚨 *PERINGATAN DINI KARHUTLA - DETEKSI OTOMATIS* 🚨` 
        : `🚨 *PERINGATAN DINI KARHUTLA - PENGIRIMAN MANUAL* 🚨`;

      const statusText = isAuto
        ? `🤖 *Status*: Notifikasi ini dikirim secara otomatis oleh server pemantau satelit 24/7.`
        : `👤 *Status*: Notifikasi ini dikirim secara manual oleh operator melalui dashboard aplikasi.`;

      const zoneText = zone === 'iupk' 
        ? 'IUPK PT Adaro Indonesia (Inti Tambang / Kelanis)' 
        : (zone === 'buffer' ? 'Buffer 1 KM (Konsesi / Hauling Road)' : 'Sekitar Wilayah Konsesi Adaro');

      const confText = confidence ? `\n🎯 *Keyakinan*: ${confidence}%` : '';

      const pesan = `${header}\n\n` +
        `🔥 *ID Hotspot*: \`${id}\`\n` +
        `📍 *Koordinat*: \`${lat}, ${lng}\`\n` +
        `🗺️ *Lokasi*: ${location || 'Sedang dimuat...'}\n` +
        `🕒 *Waktu Satelit*: ${date}${confText}\n` +
        `🛡️ *Kategori Wilayah*: ${zoneText}\n\n` +
        `${statusText}\n` +
        `⚠️ *Tindakan Petugas*: Segera koordinasikan dengan posko satgas terdekat untuk pengecekan lokasi!\n\n` +
        `📍 *Buka Titik di Google Maps:*\nhttps://maps.google.com/?q=${lat},${lng}`;

      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: pesan,
          parse_mode: 'Markdown'
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        return res.status(response.status).json({ error: errText });
      }

      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error("Error sending Telegram:", error);
      res.status(500).json({ error: error.message || "Failed to send Telegram message" });
    }
  });

  // API route to get auto-notifier status
  app.get("/api/auto-notify/status", (req, res) => {
    try {
      res.json(getAutoNotifierStatus());
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to get status" });
    }
  });

  // API route to manually trigger background check
  app.post("/api/auto-notify/run", async (req, res) => {
    try {
      const result = await runHotspotCheckCycle();
      res.json({ success: true, result, status: getAutoNotifierStatus() });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to run check cycle" });
    }
  });

  // API route to proxy NASA FIRMS
  app.get("/api/hotspots", async (req, res) => {
    try {
      const apiKey = process.env.NASA_API_KEY;
      if (!apiKey) {
        return res.status(401).json({ error: "NASA_API_KEY is not configured on the server." });
      }

      // Read days parameter: support 1, 2, 7, 30 (default: 1)
      let days = parseInt(req.query.days as string, 10);
      if (![1, 2, 7, 30].includes(days)) {
        days = 1;
      }

      // Check cache
      const cached = firmsCache.get(days);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        res.header('Content-Type', 'text/csv');
        return res.send(cached.data);
      }
      
      
      // Area bounding box covers Kelanis Port (114.85°E, -2.26°S) up to Mine Concessions (115.65°E, -2.05°S)
      const bbox = "114.85,-2.35,115.65,-2.05";
      const sources = ["VIIRS_SNPP_NRT", "MODIS_NRT", "VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT"];
      
      let header = "";
      const seen = new Set();
      const rows = [];

      if (days === 1) {
        const results = await Promise.all(sources.map(async (source) => {
          const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${apiKey}/${source}/${bbox}/1`;
          try {
            const r = await fetch(url);
            if (!r.ok) return "";
            return await r.text();
          } catch (e) {
            return "";
          }
        }));

        for (const text of results) {
          const lines = text.trim().split("\n");
          if (lines.length === 0) continue;
          if (!header && lines[0] && lines[0].includes("latitude")) {
            header = lines[0];
          }
          for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line || line.startsWith("latitude")) continue;
            // Generate a unique key for the hotspot based on lat/lng/time to deduplicate across sources
            const cols = line.split(",");
            const uniqueKey = `${cols[0]}-${cols[1]}-${cols[5]}-${cols[6]}`;
            if (!seen.has(uniqueKey)) {
              seen.add(uniqueKey);
              rows.push(line);
            }
          }
        }
      } else {
        const chunks = getFirmsChunks(days);
        const results = await Promise.all(chunks.flatMap(c => 
          sources.map(async (source) => {
            const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${apiKey}/${source}/${bbox}/${c.range}/${c.date}`;
            try {
              const r = await fetch(url);
              if (!r.ok) return "";
              return await r.text();
            } catch (e) {
              return "";
            }
          })
        ));

        for (const text of results) {
          const lines = text.trim().split("\n");
          if (lines.length === 0) continue;
          if (!header && lines[0] && lines[0].includes("latitude")) {
            header = lines[0];
          }
          for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line || line.startsWith("latitude")) continue;
            const cols = line.split(",");
            const uniqueKey = `${cols[0]}-${cols[1]}-${cols[5]}-${cols[6]}`;
            if (!seen.has(uniqueKey)) {
              seen.add(uniqueKey);
              rows.push(line);
            }
          }
        }
      }

      const csvCombined = [header, ...rows].join("\n");
      firmsCache.set(days, { data: csvCombined, timestamp: Date.now() });
      res.header('Content-Type', 'text/csv');
      res.send(csvCombined);
    } catch (error) {
      console.error("Error fetching NASA hotspots:", error);
      res.status(500).json({ error: "Failed to fetch hotspots" });
    }
  });

  // API route for OpenStreetMap Nominatim Geocoding Proxy
  app.get("/api/geocode", async (req, res) => {
    try {
      const { lat, lng } = req.query;
      
      if (!lat || !lng) {
        return res.status(400).json({ error: "Missing lat or lng" });
      }

      // OpenStreetMap Nominatim is free and does not require an API key, 
      // but requires a valid User-Agent to avoid being blocked.
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=id&email=namasayasutejo@gmail.com`;
      const response = await fetch(url, {
        headers: {
          "User-Agent": "AdaroHotspotMonitor/1.0 (namasayasutejo@gmail.com)"
        }
      });
      
      if (!response.ok) {
        return res.status(response.status).json({ error: "Failed to fetch from OpenStreetMap Nominatim" });
      }
      
      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error("Error fetching geocoding:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // API route to proxy ESDM ArcGIS REST API
  app.get("/api/iupk", async (req, res) => {
    try {
      // Target ArcGIS query endpoint on Geoportal ESDM
      const baseUrl = req.query.url || "https://geoportal.esdm.go.id/gis1/rest/services/Join_WIUP_vs_IPPKH/MapServer/0/query";
      
      const arcgisUrl = new URL(baseUrl as string);
      
      // Support flexible filter: default matches IUPK Adaro Indonesia in South Kalimantan
      let whereFilter = (req.query.where as string) || "UPPER(nama_usaha) LIKE '%ADARO INDONESIA%' OR UPPER(badan_usah) LIKE '%ADARO INDONESIA%'";
      if (req.query.where && (req.query.where as string).includes("NAMA_PERUSAHAAN")) {
        // Adapt NAMA_PERUSAHAAN parameter to actual field nama_usaha
        whereFilter = (req.query.where as string).replace(/NAMA_PERUSAHAAN/g, "nama_usaha");
      }

      arcgisUrl.searchParams.append("where", whereFilter);
      arcgisUrl.searchParams.append("outFields", "*");
      arcgisUrl.searchParams.append("f", "geojson");
      arcgisUrl.searchParams.append("returnGeometry", "true");

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(arcgisUrl.toString(), {
        headers: { 'Accept': 'application/json, text/plain' },
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const rawText = await response.text();

      // Ensure response is not an HTML error/login page
      if (rawText.trim().startsWith("<")) {
        console.warn("ArcGIS API returned HTML instead of JSON. Serving fallback.");
        return res.status(502).json({ error: "ArcGIS API returned HTML page" });
      }

      let data: any;
      try {
        data = JSON.parse(rawText);
      } catch {
        return res.status(502).json({ error: "Invalid JSON response from ArcGIS server" });
      }

      if (data && data.error) {
        return res.status(400).json({ error: data.error.message || "ArcGIS query error" });
      }

      res.json(data);
    } catch (error: any) {
      console.warn("Notice while fetching IUPK data via ArcGIS API:", error?.message || error);
      res.status(500).json({ error: "Failed to fetch IUPK data" });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    // Start 24/7 background hotspot monitor
    startAutoNotifier(5);
  });
}

startServer();
