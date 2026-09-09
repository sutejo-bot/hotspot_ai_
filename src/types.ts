export interface Coordinates {
  lat: number;
  lng: number;
}

export type HotspotTimeRange = "now" | "12h" | 1 | 7 | 30;

export interface Hotspot {
  id: string;
  location: Coordinates;
  confidence: number; // 0 to 100
  detectedAt: Date;
  status: "new" | "acknowledged" | "resolved";
  zone: "iupk" | "buffer" | "outside";
  acqDate?: string; // YYYY-MM-DD
  daysAgo?: number; // 0 = today, 1 = yesterday, etc.
  address?: string; // e.g. Desa, Kecamatan, Kabupaten, Provinsi
}

export interface GeoJsonPolygon {
  type: "Feature";
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: any;
  };
  properties: Record<string, any>;
}

export interface SecurityPost {
  id: string;
  name: string;
  kelas: 1 | 2 | 3 | 4 | 5;
  category: string;
  lat: number;
  lng: number;
  description?: string;
}

export interface HaulRoadMilestone {
  km: number;
  label: string;
  lat: number;
  lng: number;
  isMajor?: boolean;
  description?: string;
}
