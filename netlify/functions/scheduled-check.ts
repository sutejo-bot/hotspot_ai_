// Netlify Function / Scheduled Function for background hotspot monitoring
import { checkHotspotZone } from "../../src/data";

interface HandlerEvent {
  httpMethod: string;
  queryStringParameters?: Record<string, string | undefined>;
}

interface HandlerResponse {
  statusCode: number;
  headers?: Record<string, string | boolean | number>;
  body: string;
}

export const handler = async (event: HandlerEvent): Promise<HandlerResponse> => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  };

  const apiKey = process.env.NASA_API_KEY;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "NASA_API_KEY is not configured" })
    };
  }

  try {
    const bbox = "114.85,-2.35,115.65,-2.05";
    const sources = ["VIIRS_SNPP_NRT", "MODIS_NRT", "VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT"];

    const csvResults = await Promise.all(
      sources.map(async (src) => {
        const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${apiKey}/${src}/${bbox}/1`;
        try {
          const res = await fetch(url);
          if (!res.ok) return "";
          return await res.text();
        } catch {
          return "";
        }
      })
    );

    const candidates: Array<{
      id: string;
      lat: number;
      lng: number;
      zone: string;
      confidence: number;
      acqDate: string;
      acqTime: string;
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

        const latStr = Math.abs(lat).toFixed(4).replace(".", "");
        const lngStr = Math.abs(lng).toFixed(4).replace(".", "");
        const timePart = `${acqDate.replace(/-/g, "").slice(4)}${acqTime || ""}`;
        const id = `HS-${latStr}-${lngStr}-${timePart}`;

        if (!seenIds.has(id)) {
          seenIds.add(id);
          candidates.push({ id, lat, lng, zone, confidence, acqDate, acqTime });
        }
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: "ok",
        checkedAt: new Date().toISOString(),
        totalDetectedInZone: candidates.length,
        message: "Scheduled check executed successfully"
      })
    };
  } catch (err: any) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || "Failed check" })
    };
  }
};
