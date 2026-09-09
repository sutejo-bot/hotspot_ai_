import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { HotspotTimeRange } from "./types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getTimeRangeLabel(range: HotspotTimeRange): string {
  switch (range) {
    case "now":
      return "Saat Ini";
    case "12h":
      return "12 Jam Lalu";
    case 1:
      return "1 Hari";
    case 7:
      return "7 Hari";
    case 30:
      return "30 Hari";
    default:
      return `${range} Hari`;
  }
}

export function getTimeRangeDescription(range: HotspotTimeRange): string {
  switch (range) {
    case "now":
      return "Pass Satelit Terkini (Real-time)";
    case "12h":
      return "12 Jam Terakhir";
    case 1:
      return "24 Jam Terakhir";
    case 7:
      return "7 Hari Terakhir";
    case 30:
      return "30 Hari Terakhir";
    default:
      return `${range} Hari Terakhir`;
  }
}

export function formatDateWITA(date: Date): string {
  return date.toLocaleDateString("id-ID", {
    timeZone: "Asia/Makassar",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function formatTimeWITA(date: Date): string {
  return date.toLocaleTimeString("id-ID", {
    timeZone: "Asia/Makassar",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }) + " WITA";
}

export function formatHotspotRelativeTime(detectedAt: Date, daysAgo: number = 0): string {
  const diffMs = Date.now() - new Date(detectedAt).getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

  if (diffMinutes >= 0 && diffMinutes < 60) {
    return `${Math.max(1, diffMinutes)} Menit Lalu`;
  }
  if (diffHours >= 1 && diffHours <= 12) {
    return `${diffHours} Jam Lalu`;
  }
  if (daysAgo === 0 || diffHours < 24) {
    return "Hari Ini";
  }
  return `${daysAgo} Hari Lalu`;
}

const geocodeCache = new Map<string, string>();
let geocodeQueue: (() => Promise<void>)[] = [];
let isGeocoding = false;

async function processGeocodeQueue() {
  if (isGeocoding || geocodeQueue.length === 0) return;
  isGeocoding = true;
  
  while (geocodeQueue.length > 0) {
    const task = geocodeQueue.shift();
    if (task) {
      await task();
      // Wait 1.1 seconds between requests to respect Nominatim limits
      await new Promise(resolve => setTimeout(resolve, 1100));
    }
  }
  
  isGeocoding = false;
}

export function fetchAddressFromCoordinates(lat: number, lng: number): Promise<string> {
  const cacheKey = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  
  // Return immediately if cached
  if (geocodeCache.has(cacheKey)) {
    return Promise.resolve(geocodeCache.get(cacheKey)!);
  }

  return new Promise((resolve) => {
    geocodeQueue.push(async () => {
      // Check cache again right before making the request
      if (geocodeCache.has(cacheKey)) {
        resolve(geocodeCache.get(cacheKey)!);
        return;
      }
      
      try {
        const url = `/api/geocode?lat=${lat}&lng=${lng}`;
        const response = await fetch(url);
        
        if (!response.ok) {
          resolve("Detail lokasi tidak tersedia");
          return;
        }
        
        const data = await response.json();
        
        if (data && data.address) {
          const { village, town, city_district, county, state, city } = data.address;
          
          const parts = [];
          const ds = village || town;
          const kec = city_district || city;
          const kab = county;
          
          if (ds) parts.push(`Desa ${ds}`);
          if (kec) parts.push(`Kec. ${kec}`);
          if (kab) parts.push(`${kab}`);
          if (state) parts.push(`${state}`);
          
          if (parts.length > 0) {
            const result = parts.join(", ");
            geocodeCache.set(cacheKey, result);
            resolve(result);
            return;
          }
          
          if (data.display_name) {
            geocodeCache.set(cacheKey, data.display_name);
            resolve(data.display_name);
            return;
          }
        }
        
        resolve("Detail lokasi tidak tersedia");
      } catch (error) {
        console.error("Error fetching reverse geocoding:", error);
        resolve("Detail lokasi tidak tersedia");
      }
    });
    processGeocodeQueue();
  });
}

