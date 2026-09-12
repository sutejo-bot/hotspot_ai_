import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { HotspotTimeRange } from "./types";
import { findNearestLocalVillage } from "./villageData";

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
const inFlightRequests = new Map<string, Promise<string>>();

export async function fetchAddressFromCoordinates(lat: number, lng: number): Promise<string> {
  const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  
  // 1. Return immediately if cached
  if (geocodeCache.has(cacheKey)) {
    return geocodeCache.get(cacheKey)!;
  }

  // 2. High-speed Local Village matching (<0.01ms, 0 network latency)
  const localMatch = findNearestLocalVillage(lat, lng);
  if (localMatch) {
    geocodeCache.set(cacheKey, localMatch);
    return localMatch;
  }

  // 3. Deduplicate in-flight network requests for the exact same coordinate
  if (inFlightRequests.has(cacheKey)) {
    return inFlightRequests.get(cacheKey)!;
  }

  const fetchPromise = (async () => {
    try {
      const url = `/api/geocode?lat=${lat}&lng=${lng}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        return "Detail lokasi tidak tersedia";
      }
      
      const data = await response.json();
      
      if (data && data.display_name && !data.address) {
        geocodeCache.set(cacheKey, data.display_name);
        return data.display_name;
      }

      if (data && data.address) {
        const { village, hamlet, suburb, quarter, town, city_district, city, county, state } = data.address;
        
        const parts: string[] = [];
        const ds = village || hamlet || suburb || quarter || town;
        const kec = city_district || city;
        const kab = county;
        
        if (ds) {
          if (ds.toLowerCase().includes('desa') || ds.toLowerCase().includes('kelurahan')) {
            parts.push(ds);
          } else {
            parts.push(`Desa/Kel. ${ds}`);
          }
        }
        if (kec) parts.push(`Kec. ${kec}`);
        if (kab) {
          if (kab.toLowerCase().includes('kabupaten') || kab.toLowerCase().includes('kota')) {
             parts.push(`${kab}`);
          } else {
             parts.push(`Kab. ${kab}`);
          }
        }
        if (state) parts.push(`${state}`);
        
        if (parts.length > 0) {
          const result = parts.join(", ");
          geocodeCache.set(cacheKey, result);
          return result;
        }
        
        if (data.display_name) {
          geocodeCache.set(cacheKey, data.display_name);
          return data.display_name;
        }
      }
      
      return "Detail lokasi tidak tersedia";
    } catch (error) {
      console.error("Error fetching reverse geocoding:", error);
      return "Detail lokasi tidak tersedia";
    } finally {
      inFlightRequests.delete(cacheKey);
    }
  })();

  inFlightRequests.set(cacheKey, fetchPromise);
  const result = await fetchPromise;
  geocodeCache.set(cacheKey, result);
  return result;
}

