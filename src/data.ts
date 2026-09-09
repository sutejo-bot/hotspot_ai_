import * as turf from "@turf/turf";
import { Coordinates } from "./types";

// IUPK Coordinates from ESDM Minerba Geoportal (PT Adaro Indonesia - Tabalong/Balangan) fallback
export const ADARO_IUPK_COORDINATES: Coordinates[] = [
  { lat: -2.282, lng: 115.475 },
  { lat: -2.321, lng: 115.475 },
  { lat: -2.321, lng: 115.516 },
  { lat: -2.255, lng: 115.516 },
  { lat: -2.246, lng: 115.566 },
  { lat: -2.213, lng: 115.566 },
  { lat: -2.213, lng: 115.593 },
  { lat: -2.150, lng: 115.593 },
  { lat: -2.150, lng: 115.530 },
  { lat: -2.200, lng: 115.530 },
  { lat: -2.200, lng: 115.475 },
  { lat: -2.282, lng: 115.475 }, // Close the polygon
];

// Convert to Turf Polygon (lng, lat format)
const iupkCoordsForTurf = ADARO_IUPK_COORDINATES.map(c => [c.lng, c.lat]);
export let iupkPolygon = turf.polygon([[...iupkCoordsForTurf]]);

// Calculate 1 km buffer
export let iupkBuffer = turf.buffer(iupkPolygon, 1.0, { units: 'kilometers' });

export function updateIupkBoundaries(geoJsonPolygon: any) {
  iupkPolygon = geoJsonPolygon;
  iupkBuffer = turf.buffer(iupkPolygon, 1.0, { units: 'kilometers' });
}

export async function fetchDynamicIUPKBoundary(): Promise<void> {
  try {
    const res = await fetch("/api/iupk");
    if (!res.ok) throw new Error("Failed to fetch ArcGIS REST API");
    const data = await res.json();
    
    // Look for a feature
    if (data && data.features && data.features.length > 0) {
      // Typically the geometry is a MultiPolygon or Polygon
      const feature = data.features[0];
      if (feature.geometry) {
        let polygonToUse = feature.geometry;
        
        // If it's a MultiPolygon, we can take the first polygon for simplicity or use the whole multipolygon
        // turf.buffer works with MultiPolygon too
        
        updateIupkBoundaries(feature);
        console.log("Successfully loaded IUPK boundary from ESDM ArcGIS REST API");
      }
    }
  } catch (error) {
    console.warn("Could not fetch dynamic IUPK boundary from ArcGIS API, using static fallback.");
  }
}

export function getIupkCoordinates(): Coordinates[][] {
  if (iupkPolygon.geometry.type === "Polygon") {
    return [iupkPolygon.geometry.coordinates[0].map(
      (coord: any) => ({ lat: coord[1], lng: coord[0] })
    )];
  } else if (iupkPolygon.geometry.type === "MultiPolygon") {
    return iupkPolygon.geometry.coordinates.map((poly: any) => 
      poly[0].map((coord: any) => ({ lat: coord[1], lng: coord[0] }))
    );
  }
  return [];
}

// Get buffer coordinates for Google Maps (deprecated/unused if we use GeoJSON directly, but kept for compat)
export function getBufferCoordinates(): Coordinates[][] {
  if (iupkBuffer.geometry.type === "Polygon") {
    return [iupkBuffer.geometry.coordinates[0].map(
      (coord: any) => ({ lat: coord[1], lng: coord[0] })
    )];
  } else if (iupkBuffer.geometry.type === "MultiPolygon") {
     return iupkBuffer.geometry.coordinates.map((poly: any) => 
      poly[0].map((coord: any) => ({ lat: coord[1], lng: coord[0] }))
    );
  }
  return [];
}

export function getHaulRoadBufferCoordinates(): Coordinates[][] {
  if (!haulRoadBuffer) return [];
  if (haulRoadBuffer.geometry.type === "Polygon") {
    return [haulRoadBuffer.geometry.coordinates[0].map(
      (coord: any) => ({ lat: coord[1], lng: coord[0] })
    )];
  } else if (haulRoadBuffer.geometry.type === "MultiPolygon") {
    return haulRoadBuffer.geometry.coordinates.map((poly: any) => 
      poly[0].map((coord: any) => ({ lat: coord[1], lng: coord[0] }))
    );
  }
  return [];
}

import {
  ADARO_HAUL_ROAD_COORDINATES,
  KELANIS_PORT_COORDINATES,
} from "./adaroSecurityData";
import { HaulRoadMilestone } from "./types";

// Haul road corridor buffer (1 kilometer along haul road)
const haulRoadLine = turf.lineString(ADARO_HAUL_ROAD_COORDINATES.map(([lat, lng]) => [lng, lat]));
export const haulRoadBuffer = turf.buffer(haulRoadLine, 1.0, { units: 'kilometers' });

// Pre-calculated milestone markers per 1 km along the hauling road
export const ADARO_HAUL_ROAD_MILESTONES: HaulRoadMilestone[] = (() => {
  const totalLength = turf.length(haulRoadLine, { units: "kilometers" });
  const milestones: HaulRoadMilestone[] = [];

  for (let km = 0; km <= Math.floor(totalLength); km++) {
    const pt = turf.along(haulRoadLine, km, { units: "kilometers" });
    const [lng, lat] = pt.geometry.coordinates;
    milestones.push({
      km,
      label: `KM ${km}`,
      lat: Number(lat.toFixed(5)),
      lng: Number(lng.toFixed(5)),
      isMajor: km % 5 === 0,
      description: km === 0 ? "Terminal Batubara Kelanis (KM 0)" : `Jalur Hauling PT Adaro Indonesia KM ${km}`
    });
  }

  // End point (coordinate: -2.248066, 115.451902)
  const lastCoord = ADARO_HAUL_ROAD_COORDINATES[ADARO_HAUL_ROAD_COORDINATES.length - 1];
  const finalKm = Number(totalLength.toFixed(1));
  if (totalLength - Math.floor(totalLength) > 0.05) {
    milestones.push({
      km: finalKm,
      label: `KM ${finalKm}`,
      lat: Number(lastCoord[0].toFixed(5)),
      lng: Number(lastCoord[1].toFixed(5)),
      isMajor: true,
      description: `Batas Akhir Segmen Hauling Road (KM ${finalKm})`
    });
  }

  return milestones;
})();

const kelanisPortPolygon = turf.polygon([[
  ...KELANIS_PORT_COORDINATES.map(([lt, lg]) => [lg, lt]),
  [KELANIS_PORT_COORDINATES[0][1], KELANIS_PORT_COORDINATES[0][0]]
]]);

export function checkHotspotZone(lat: number, lng: number): "iupk" | "buffer" | "outside" {
  const point = turf.point([lng, lat]);
  if (turf.booleanPointInPolygon(point, iupkPolygon)) {
    return "iupk";
  }
  // Check if in Kelanis Port area
  if (turf.booleanPointInPolygon(point, kelanisPortPolygon)) {
    return "iupk";
  }
  // Check 1 km buffer of IUPK or Haul Road
  if (turf.booleanPointInPolygon(point, iupkBuffer)) {
    return "buffer";
  }
  if (turf.booleanPointInPolygon(point, haulRoadBuffer)) {
    return "buffer";
  }
  return "outside";
}

// Generate some random initial hotspots for demonstration (fallback)
export function generateRandomHotspot() {
  // Generate random point near the IUPK
  const centerLat = -2.20;
  const centerLng = 115.47;
  
  const latOffset = (Math.random() - 0.5) * 0.15;
  const lngOffset = (Math.random() - 0.5) * 0.15;
  
  const lat = centerLat + latOffset;
  const lng = centerLng + lngOffset;
  
  return {
    lat,
    lng,
    confidence: Math.floor(Math.random() * 30) + 70, // 70 to 99%
  };
}

import Papa from "papaparse";
import { Hotspot, HotspotTimeRange } from "./types";

export async function fetchNasaHotspots(range: HotspotTimeRange = 1): Promise<Hotspot[]> {
  try {
    const apiParam = range === "now" || range === "12h" || range === 1 ? 2 : range;
    const response = await fetch(`/api/hotspots?days=${apiParam}`);
    if (!response.ok) {
      if (response.status === 401) {
        throw new Error("NASA_API_KEY is missing or invalid");
      }
      throw new Error(`Server API error: ${response.status}`);
    }
    
    const csvData = await response.text();
    
    return new Promise((resolve, reject) => {
      Papa.parse(csvData, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const hotspots: Hotspot[] = [];
          const seenIds = new Set<string>();
          const nowD = new Date();
          const todayUTC = new Date(Date.UTC(nowD.getUTCFullYear(), nowD.getUTCMonth(), nowD.getUTCDate()));
          
          results.data.forEach((row: any) => {
            const lat = parseFloat(row.latitude);
            const lng = parseFloat(row.longitude);
            if (isNaN(lat) || isNaN(lng)) return;

            const zone = checkHotspotZone(lat, lng);
            if (zone === "outside") return;

            // VIIRS confidence is 'n' (nominal/medium), 'l' (low), 'h' (high)
            // MODIS confidence is 0-100
            let confidence = 50;
            if (row.confidence === 'h') confidence = 95;
            else if (row.confidence === 'n') confidence = 75;
            else if (row.confidence === 'l') confidence = 30;
            else if (!isNaN(parseInt(row.confidence))) confidence = parseInt(row.confidence);

            const acqDate = row.acq_date || ""; // YYYY-MM-DD
            const acqTime = row.acq_time || ""; // HHMM (UTC)
            
            let detectedAt = new Date();
            let daysAgo = 0;
            if (acqDate) {
              const parts = acqDate.split("-").map(Number);
              if (parts.length === 3) {
                const acqD = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
                daysAgo = Math.max(0, Math.floor((todayUTC.getTime() - acqD.getTime()) / (1000 * 60 * 60 * 24)));
              }
              if (acqTime) {
                const hours = acqTime.padStart(4, "0").substring(0, 2);
                const mins = acqTime.padStart(4, "0").substring(2, 4);
                detectedAt = new Date(`${acqDate}T${hours}:${mins}:00Z`);
              } else {
                detectedAt = new Date(`${acqDate}T00:00:00Z`);
              }
            }

            // Deterministic unique ID based on high-precision coordinates and timestamp
            const latStr = Math.abs(lat).toFixed(4).replace(".", "");
            const lngStr = Math.abs(lng).toFixed(4).replace(".", "");
            const timePart = `${acqDate.replace(/-/g, "").slice(4)}${acqTime || ""}`;
            const baseId = `HS-${latStr}-${lngStr}-${timePart}`;
            
            let id = baseId;
            let counter = 1;
            while (seenIds.has(id)) {
              counter++;
              id = `${baseId}-${counter}`;
            }
            seenIds.add(id);

            hotspots.push({
              id,
              location: { lat, lng },
              confidence,
              detectedAt,
              status: daysAgo === 0 ? "new" : "acknowledged", // Detections from today default to 'new'
              zone,
              acqDate,
              daysAgo,
            });
          });
          
          // Sort by newest detectedAt first
          hotspots.sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime());
          
          // Filter by time range if "now" or "12h"
          let filteredHotspots = hotspots;
          const nowMs = Date.now();

          if (range === "now") {
            // Hotspot saat ini: pass satelit terkini (toleransi 2 jam terakhir untuk "saat ini")
            filteredHotspots = hotspots.filter(h => nowMs - h.detectedAt.getTime() <= 2 * 60 * 60 * 1000 && nowMs >= h.detectedAt.getTime());
          } else if (range === "12h") {
            // Hotspot 12 jam yang lalu: strictly 12 jam terakhir dari saat ini
            const twelveHoursAgo = nowMs - 12 * 60 * 60 * 1000;
            filteredHotspots = hotspots.filter(h => h.detectedAt.getTime() >= twelveHoursAgo && h.detectedAt.getTime() <= nowMs);
          } else if (range === 1) {
            // Hotspot 1 hari yang lalu: strictly 24 jam terakhir dari saat ini
            const oneDayAgo = nowMs - 24 * 60 * 60 * 1000;
            filteredHotspots = hotspots.filter(h => h.detectedAt.getTime() >= oneDayAgo && h.detectedAt.getTime() <= nowMs);
          }

          resolve(filteredHotspots);
        },
        error: (err: any) => {
          reject(err);
        }
      });
    });
  } catch (error) {
    throw error;
  }
}
