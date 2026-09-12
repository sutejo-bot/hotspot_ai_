import { useMemo, useEffect, useState, useRef, MutableRefObject } from "react";
import { 
  MapContainer, 
  TileLayer,
  Polygon, 
  Polyline,
  Marker, 
  Popup,
  Tooltip,
  useMap
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Hotspot } from "../types";
import { 
  getIupkCoordinates, 
  getBufferCoordinates, 
  getHaulRoadBufferCoordinates,
  ADARO_HAUL_ROAD_MILESTONES
} from "../data";
import { 
  ADARO_HAUL_ROAD_COORDINATES
} from "../adaroSecurityData";
import { formatDateWITA, formatTimeWITA, fetchAddressFromCoordinates } from "../utils";
import { 
  Flame, 
  Layers, 
  X, 
  Navigation, 
  Anchor, 
  MapPin,
  Compass,
  Maximize2
} from "lucide-react";
import { renderToString } from "react-dom/server";

interface MapComponentProps {
  hotspots: Hotspot[];
  boundaryLoaded: boolean;
  selectedHotspot?: Hotspot | null;
  onSelectHotspot?: (hotspot: Hotspot) => void;
}

// Controller component inside MapContainer to smoothly navigate
function MapController({ 
  selectedHotspot, 
  iupkPolygons,
  focusMode,
  onZoomChange,
  targetFly,
  markerRefs
}: { 
  selectedHotspot?: Hotspot | null,
  iupkPolygons: [number, number][][],
  focusMode: "full" | "mine" | "kelanis" | "none",
  onZoomChange?: (zoom: number) => void,
  targetFly?: { lat: number; lng: number; zoom: number; timestamp: number; hotspotId?: string } | null,
  markerRefs: MutableRefObject<Record<string, L.Marker>>
}) {
  const map = useMap();

  useEffect(() => {
    if (!onZoomChange) return;
    onZoomChange(map.getZoom());
    const handleZoom = () => onZoomChange(map.getZoom());
    map.on("zoomend", handleZoom);
    return () => {
      map.off("zoomend", handleZoom);
    };
  }, [map, onZoomChange]);

  // Priority 1: Direct trigger from clicking "Lihat" in notification banner
  useEffect(() => {
    if (targetFly) {
      map.flyTo([targetFly.lat, targetFly.lng], targetFly.zoom, {
        duration: 1.2,
      });
      if (targetFly.hotspotId) {
        const timer = setTimeout(() => {
          const marker = markerRefs.current[targetFly.hotspotId!];
          if (marker) {
            marker.openPopup();
          }
        }, 700);
        return () => clearTimeout(timer);
      }
    }
  }, [targetFly, map, markerRefs]);

  // Priority 2: When selectedHotspot or focusMode changes
  useEffect(() => {
    // If a hotspot is selected, zoom directly to it at close range (level 16)
    if (selectedHotspot) {
      map.flyTo([selectedHotspot.location.lat, selectedHotspot.location.lng], 16, {
        duration: 1.2,
      });
      const timer = setTimeout(() => {
        const marker = markerRefs.current[selectedHotspot.id];
        if (marker) {
          marker.openPopup();
        }
      }, 700);
      return () => clearTimeout(timer);
    } 
    else if (focusMode === "full") {
      // Bounds covering Kelanis Port (114.85) to East Mine Concession (115.62)
      const fullBounds = L.latLngBounds([[-2.34, 114.84], [-2.06, 115.62]]);
      map.fitBounds(fullBounds, { padding: [30, 30], duration: 1 });
    }
    else if (focusMode === "mine") {
      if (iupkPolygons && iupkPolygons.length > 0 && iupkPolygons[0].length > 0) {
        const allPoints = iupkPolygons.flat();
        if (allPoints.length > 0) {
          const bounds = L.latLngBounds(allPoints);
          map.fitBounds(bounds, { padding: [40, 40], duration: 1 });
        }
      }
    }
    else if (focusMode === "kelanis") {
      map.flyTo([-2.2602, 114.8780], 14, { duration: 1 });
    }
  }, [selectedHotspot, iupkPolygons, focusMode, map, markerRefs]);

  return null;
}

// Custom icon creator for Hotspots with recency indicator
const createHotspotIcon = (status: "new" | "acknowledged" | "resolved", daysAgo: number = 0) => {
  const isNew = status === "new" || daysAgo === 0;
  const isOlder = daysAgo > 7;
  
  let bgClasses = 'bg-amber-500 border-amber-700 shadow-amber-500/50';
  if (isNew) {
    bgClasses = 'bg-red-500 border-red-700 shadow-red-500/50';
  } else if (isOlder) {
    bgClasses = 'bg-orange-600 border-orange-800 shadow-orange-950/50';
  }

  const iconHtml = renderToString(
    <div className={`relative flex items-center justify-center ${isNew ? 'scale-125' : 'scale-100'}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 shadow-lg ${bgClasses}`}>
        <Flame className="w-4 h-4 text-white" />
      </div>
      {isNew && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 bg-red-500/40 rounded-full animate-ping pointer-events-none -z-10" />
      )}
      {daysAgo > 0 && (
        <div className="absolute -bottom-1 -right-1 px-1 py-0.2 bg-slate-900/90 border border-slate-700 rounded text-[9px] font-bold font-mono text-amber-300 shadow leading-none">
          {daysAgo}h
        </div>
      )}
    </div>
  );

  return L.divIcon({
    html: iconHtml,
    className: "custom-leaflet-icon",
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -16]
  });
};

// Custom icon creator for Haul Road Milestones (KM markers)
const createMilestoneIcon = (km: number | string, isMajor: boolean, isCompact: boolean) => {
  if (isCompact) {
    const iconHtml = renderToString(
      <div className="flex items-center justify-center cursor-pointer group">
        <div className={`w-3 h-3 rounded-full border flex items-center justify-center shadow-sm transition-transform group-hover:scale-150 ${
          isMajor 
            ? "bg-amber-400 border-amber-600 ring-2 ring-amber-400/40" 
            : "bg-slate-900 border-amber-400/80"
        }`}>
          <div className={`w-1 h-1 rounded-full ${isMajor ? "bg-slate-950" : "bg-amber-400"}`} />
        </div>
      </div>
    );

    return L.divIcon({
      html: iconHtml,
      className: "custom-km-dot-icon",
      iconSize: [12, 12],
      iconAnchor: [6, 6],
      popupAnchor: [0, -8]
    });
  }

  const isMajorOrEdge = isMajor;
  const iconHtml = renderToString(
    <div className={`px-1.5 py-0.5 rounded shadow-md flex items-center gap-1 font-mono text-[10px] font-bold border whitespace-nowrap cursor-pointer transition-all hover:scale-110 select-none ${
      isMajorOrEdge
        ? "bg-amber-500 text-slate-950 border-amber-300 font-extrabold shadow-amber-500/40"
        : "bg-slate-900/95 text-amber-300 border-amber-500/70 shadow-slate-950/60"
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isMajorOrEdge ? "bg-slate-950" : "bg-amber-400"}`} />
      <span>KM {km}</span>
    </div>
  );

  const width = isMajorOrEdge ? 52 : 46;
  return L.divIcon({
    html: iconHtml,
    className: "custom-km-icon",
    iconSize: [width, 20],
    iconAnchor: [width / 2, 10],
    popupAnchor: [0, -10]
  });
};

const PopupAddress = ({ lat, lng, initialAddress }: { lat: number, lng: number, initialAddress?: string }) => {
  const [address, setAddress] = useState<string>(() => initialAddress || "Memuat lokasi...");
  
  useEffect(() => {
    if (initialAddress) {
      setAddress(initialAddress);
      return;
    }
    let isMounted = true;
    fetchAddressFromCoordinates(lat, lng).then(res => {
      if (isMounted) setAddress(res);
    });
    return () => { isMounted = false; };
  }, [lat, lng, initialAddress]);

  return (
    <div className="text-[11px] mt-1.5 text-slate-700 leading-tight border-t border-slate-100 pt-1.5">
      <span className="font-semibold text-slate-800">Lokasi:</span> {address}
    </div>
  );
};

export default function MapComponent({ 
  hotspots, 
  boundaryLoaded, 
  selectedHotspot,
  onSelectHotspot 
}: MapComponentProps) {
  const [showIupk, setShowIupk] = useState(true);
  const [showHaulRoad, setShowHaulRoad] = useState(true);
  const [showMilestones, setShowMilestones] = useState(true);
  const [showBuffer, setShowBuffer] = useState(true);
  const [showHotspots, setShowHotspots] = useState(true);
  const [showAdmin, setShowAdmin] = useState(true);
  const [mapType, setMapType] = useState<"street" | "satellite">("street");
  const [showLayerPanel, setShowLayerPanel] = useState(false);
  const [alertDismissed, setAlertDismissed] = useState(false);
  const [focusMode, setFocusMode] = useState<"full" | "mine" | "kelanis" | "none">("full");
  const [currentZoom, setCurrentZoom] = useState<number>(10);

  // Center between Kelanis and Tanjung Tambang
  const initialCenter: [number, number] = [-2.20, 115.20];
  
  const iupkMultiPolygons = useMemo(() => 
    getIupkCoordinates().map(ring => ring.map(c => [c.lat, c.lng] as [number, number])), 
  [boundaryLoaded]);
  
  const bufferMultiPolygons = useMemo(() => 
    getBufferCoordinates().map(ring => ring.map(c => [c.lat, c.lng] as [number, number])), 
  [boundaryLoaded]);

  const haulRoadBufferMultiPolygons = useMemo(() => 
    getHaulRoadBufferCoordinates().map(ring => ring.map(c => [c.lat, c.lng] as [number, number])), 
  []);

  const markerRefs = useRef<Record<string, L.Marker>>({});
  const [targetFly, setTargetFly] = useState<{ lat: number; lng: number; zoom: number; timestamp: number; hotspotId?: string } | null>(null);

  const newHotspots = hotspots.filter(h => h.status === 'new');
  const latestNewHotspot = newHotspots.length > 0 ? newHotspots[0] : null;

  // Direct zoom into hotspot location (e.g. from notification banner)
  const handleViewHotspot = (hotspot: Hotspot) => {
    setShowHotspots(true);
    setFocusMode("none");
    setTargetFly({
      lat: hotspot.location.lat,
      lng: hotspot.location.lng,
      zoom: 16,
      timestamp: Date.now(),
      hotspotId: hotspot.id,
    });
    onSelectHotspot?.(hotspot);
  };

  // Reset alert dismiss when new hotspot appears
  useEffect(() => {
    if (newHotspots.length > 0) {
      setAlertDismissed(false);
    }
  }, [newHotspots.length]);

  return (
    <div className="w-full h-full relative z-0">
      <MapContainer 
        center={initialCenter} 
        zoom={10} 
        scrollWheelZoom={true}
        className="w-full h-full"
      >
        <MapController 
          selectedHotspot={selectedHotspot} 
          iupkPolygons={iupkMultiPolygons}
          focusMode={focusMode}
          onZoomChange={setCurrentZoom}
          targetFly={targetFly}
          markerRefs={markerRefs}
        />

        {mapType === "street" ? (
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
        ) : (
          <>
            <TileLayer
              attribution='&copy; <a href="https://www.esri.com/">Esri</a> &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            />
            {/* CartoDB Voyager Label overlay for highly detailed OSM Indonesian village names */}
            <TileLayer
              attribution='&copy; <a href="https://carto.com/">CartoDB</a>'
              url="https://a.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png"
            />
          </>
        )}

        {/* Overlay Label & Batas Administrasi Wilayah (Desa, Kecamatan, Kabupaten) */}
        {showAdmin && mapType !== "satellite" && (
          <TileLayer
            attribution='&copy; <a href="https://carto.com/">CartoDB</a>'
            url="https://a.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png"
            opacity={0.9}
          />
        )}

        {/* 1. Main IUPK Concession Boundary (ESDM GeoJSON) */}
        {showIupk && (
          <Polygon 
            positions={iupkMultiPolygons} 
            pathOptions={{
              fillColor: "#000000",
              fillOpacity: 0.05,
              color: "#000000",
              weight: 2.5,
              dashArray: "6, 4",
            }} 
          >
            <Tooltip sticky>
              <span className="font-bold text-xs">Batas IUPK Produksi PT Adaro Indonesia (ESDM)</span>
            </Tooltip>
          </Polygon>
        )}

        {/* 2. 1 km Buffer Zone around Mining Concession and Haul Road Corridor */}
        {showBuffer && (
          <>
            <Polygon 
              positions={bufferMultiPolygons} 
              pathOptions={{
                fillColor: "#eab308",
                fillOpacity: 0.06,
                color: "#ca8a04",
                weight: 1.5,
                dashArray: "3, 3",
                interactive: false
              }} 
            />
            {haulRoadBufferMultiPolygons.length > 0 && (
              <Polygon 
                positions={haulRoadBufferMultiPolygons} 
                pathOptions={{
                  fillColor: "#eab308",
                  fillOpacity: 0.05,
                  color: "#ca8a04",
                  weight: 1.2,
                  dashArray: "3, 3",
                  interactive: false
                }} 
              />
            )}
          </>
        )}

        {/* 4. Dedicated Haul Road (Kelanis KM 0 to KM 71) */}
        {showHaulRoad && (
          <>
            {/* Outer casing */}
            <Polyline
              positions={ADARO_HAUL_ROAD_COORDINATES}
              pathOptions={{
                color: "#475569",
                weight: 6,
                opacity: 0.85
              }}
            />
            {/* Inner line */}
            <Polyline
              positions={ADARO_HAUL_ROAD_COORDINATES}
              pathOptions={{
                color: "#94a3b8",
                weight: 3.5,
                opacity: 1
              }}
            >
              <Tooltip sticky>
                <span className="font-bold text-xs">Jalur Hauling Road PT Adaro Indonesia (KM 0 - KM 71)</span>
              </Tooltip>
            </Polyline>
          </>
        )}

        {/* 5. Haul Road Milestones (KM Markers per 1 km) */}
        {showHaulRoad && showMilestones && ADARO_HAUL_ROAD_MILESTONES.map((m) => {
          const isCompact = currentZoom < 12 && !m.isMajor;
          return (
            <Marker
              key={`milestone-${m.label}`}
              position={[m.lat, m.lng]}
              icon={createMilestoneIcon(m.km, !!m.isMajor, isCompact)}
              zIndexOffset={m.isMajor ? 400 : 200}
            >
              <Tooltip direction="top" offset={[0, isCompact ? -6 : -10]} opacity={0.95}>
                <span className="font-mono font-bold text-xs">{m.label}</span>
              </Tooltip>
              <Popup className="custom-popup">
                <div className="text-xs font-sans p-1 min-w-[210px]">
                  <div className="font-bold text-slate-900 flex items-center justify-between pb-1.5 mb-1.5 border-b border-slate-200">
                    <span className="text-amber-700 flex items-center gap-1.5 font-mono text-sm">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block"></span>
                      {m.label}
                    </span>
                    <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-900">
                      Haul Road
                    </span>
                  </div>
                  <div className="text-slate-700 font-medium mb-1">
                    {m.description || `Jalur Hauling PT Adaro Indonesia`}
                  </div>
                  <div className="text-slate-500 text-[11px] mb-2">
                    Jarak dari Kelanis: <span className="font-semibold text-slate-800">{m.km} km</span>
                  </div>
                  <a 
                    href={`https://www.google.com/maps/search/?api=1&query=${m.lat},${m.lng}`} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="block text-[11px] font-mono text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 p-1.5 rounded transition-colors"
                    title="Buka titik koordinat KM ini di Google Maps"
                  >
                    Lat: {m.lat.toFixed(5)}<br/>
                    Lng: {m.lng.toFixed(5)}
                  </a>
                </div>
              </Popup>
            </Marker>
          );
        })}
        

        {/* 7. Thermal Hotspots */}
        {showHotspots && hotspots.map(hotspot => (
          <Marker
            key={hotspot.id}
            ref={(ref) => {
              if (ref) {
                markerRefs.current[hotspot.id] = ref;
              } else {
                delete markerRefs.current[hotspot.id];
              }
            }}
            position={[hotspot.location.lat, hotspot.location.lng]}
            icon={createHotspotIcon(hotspot.status, hotspot.daysAgo)}
            eventHandlers={{
              click: () => onSelectHotspot?.(hotspot)
            }}
          >
            <Popup className="custom-popup">
              <div className="text-sm font-sans p-0.5 min-w-[200px]">
                <div className="font-bold text-slate-800 mb-1 flex items-center justify-between">
                  <span>Hotspot {hotspot.id}</span>
                  <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded text-white ${
                    hotspot.daysAgo === 0 ? 'bg-red-600' : 'bg-orange-600'
                  }`}>
                    {hotspot.daysAgo === 0 ? 'Hari Ini' : `${hotspot.daysAgo} Hari Lalu`}
                  </span>
                </div>
                <div className="text-xs text-slate-600 mb-1">
                  Waktu: <span className="font-semibold text-slate-800">{new Date(hotspot.detectedAt).toLocaleDateString('id-ID', { timeZone: 'Asia/Makassar', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} {new Date(hotspot.detectedAt).toLocaleTimeString('id-ID', { timeZone: 'Asia/Makassar', hour: '2-digit', minute: '2-digit', second: '2-digit' })} WITA</span>
                </div>
                <div className="text-xs text-slate-600 mb-1">
                  Tingkat Keyakinan: <span className={hotspot.confidence > 80 ? 'text-red-600 font-bold' : 'text-orange-600 font-bold'}>{hotspot.confidence}%</span>
                </div>
                <a 
                  href={`https://www.google.com/maps/search/?api=1&query=${hotspot.location.lat},${hotspot.location.lng}`} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="block text-[11px] font-mono text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 p-1.5 rounded transition-colors mt-2"
                  title="Buka titik koordinat ini di Google Maps"
                >
                  Lat: {hotspot.location.lat.toFixed(5)}<br/>
                  Lng: {hotspot.location.lng.toFixed(5)}
                </a>
                <PopupAddress lat={hotspot.location.lat} lng={hotspot.location.lng} initialAddress={hotspot.address} />
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
      
      {/* Quick Focus Controls (Top Left under Zoom) */}
      <div className="absolute top-4 left-14 z-[1000] hidden sm:flex items-center gap-1.5 bg-slate-900/90 backdrop-blur-md p-1 rounded-xl border border-slate-700/80 shadow-lg text-xs">
        <button
          onClick={() => setFocusMode("full")}
          className={`px-2.5 py-1.5 rounded-lg font-semibold transition-colors flex items-center gap-1.5 ${
            focusMode === "full" ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-slate-800"
          }`}
          title="Fokus Seluruh Koridor Adaro (Kelanis Port s/d Tambang)"
        >
          <Maximize2 className="w-3.5 h-3.5" />
          <span>Seluruh Koridor</span>
        </button>
        <button
          onClick={() => setFocusMode("mine")}
          className={`px-2.5 py-1.5 rounded-lg font-semibold transition-colors flex items-center gap-1.5 ${
            focusMode === "mine" ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-slate-800"
          }`}
          title="Fokus Area Tambang IUPK (Tabalong & Balangan)"
        >
          <Compass className="w-3.5 h-3.5" />
          <span>IUPK Tambang</span>
        </button>
        <button
          onClick={() => setFocusMode("kelanis")}
          className={`px-2.5 py-1.5 rounded-lg font-semibold transition-colors flex items-center gap-1.5 ${
            focusMode === "kelanis" ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-slate-800"
          }`}
          title="Fokus Area Pelabuhan Kelanis (Sungai Barito)"
        >
          <Anchor className="w-3.5 h-3.5" />
          <span>Area Kelanis (Port)</span>
        </button>
      </div>

      {/* Floating Layer Controls (Mobile Friendly Toggle) */}
      <div className="absolute bottom-4 right-4 sm:bottom-6 sm:right-6 z-[1000] flex flex-col items-end">
        {/* Expanded Panel */}
        {showLayerPanel && (
          <div className="mb-3 bg-slate-900/95 backdrop-blur-md border border-slate-700 p-3.5 sm:p-4 rounded-2xl shadow-2xl w-[280px] sm:w-[310px] max-w-[calc(100vw-32px)] text-slate-100 animate-in fade-in zoom-in-95 duration-150 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-blue-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-slate-300">Peta Sebaran Hotspot</span>
              </div>
              <button 
                onClick={() => setShowLayerPanel(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 min-h-[32px] min-w-[32px] flex items-center justify-center"
                aria-label="Close layer panel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Quick Navigation on Mobile */}
            <div className="mb-3 sm:hidden">
              <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Fokus Wilayah</h4>
              <div className="grid grid-cols-3 gap-1">
                <button
                  onClick={() => setFocusMode("full")}
                  className="p-1.5 text-[11px] bg-slate-800 hover:bg-slate-700 rounded text-center text-slate-200"
                >
                  Semua
                </button>
                <button
                  onClick={() => setFocusMode("mine")}
                  className="p-1.5 text-[11px] bg-slate-800 hover:bg-slate-700 rounded text-center text-slate-200"
                >
                  Tambang
                </button>
                <button
                  onClick={() => setFocusMode("kelanis")}
                  className="p-1.5 text-[11px] bg-slate-800 hover:bg-slate-700 rounded text-center text-slate-200"
                >
                  Kelanis
                </button>
              </div>
            </div>

            {/* Basemap Options */}
            <div className="mb-3.5">
              <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Peta Dasar (Basemap)</h4>
              <div className="grid grid-cols-2 gap-2">
                <button 
                  onClick={() => setMapType('street')}
                  className={`min-h-[40px] px-3 py-1.5 text-xs font-semibold rounded-xl border transition-all flex items-center justify-center gap-1.5 ${
                    mapType === 'street' 
                      ? 'bg-blue-600 border-blue-500 text-white shadow-md' 
                      : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-750'
                  }`}
                >
                  Street
                </button>
                <button 
                  onClick={() => setMapType('satellite')}
                  className={`min-h-[40px] px-3 py-1.5 text-xs font-semibold rounded-xl border transition-all flex items-center justify-center gap-1.5 ${
                    mapType === 'satellite' 
                      ? 'bg-blue-600 border-blue-500 text-white shadow-md' 
                      : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-750'
                  }`}
                >
                  Satelit
                </button>
              </div>
            </div>

            {/* Layers Checklist Matching PDF */}
            <div>
              <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Layer Operasional & Pengamanan</h4>
              <div className="space-y-1">
                <label className="flex items-center gap-2.5 py-1.5 px-2 rounded-lg hover:bg-slate-800/60 text-xs text-slate-200 cursor-pointer min-h-[38px] select-none">
                  <input 
                    type="checkbox" 
                    checked={showIupk} 
                    onChange={(e) => setShowIupk(e.target.checked)} 
                    className="accent-blue-500 w-4 h-4 rounded cursor-pointer" 
                  /> 
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-0.5 bg-black inline-block"></span>
                    Batas IUPK Produksi AI (ESDM)
                  </span>
                </label>

                <label className="flex items-center gap-2.5 py-1.5 px-2 rounded-lg hover:bg-slate-800/60 text-xs text-slate-200 cursor-pointer min-h-[38px] select-none">
                  <input 
                    type="checkbox" 
                    checked={showHaulRoad} 
                    onChange={(e) => setShowHaulRoad(e.target.checked)} 
                    className="accent-amber-500 w-4 h-4 rounded cursor-pointer" 
                  /> 
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-1 rounded-sm bg-slate-400 inline-block"></span>
                    Jalan Hauling (KM 0 - KM 71)
                  </span>
                </label>

                {showHaulRoad && (
                  <label className="flex items-center gap-2.5 py-1.5 px-2 ml-4 rounded-lg hover:bg-slate-800/60 text-xs text-slate-200 cursor-pointer min-h-[34px] select-none">
                    <input 
                      type="checkbox" 
                      checked={showMilestones} 
                      onChange={(e) => setShowMilestones(e.target.checked)} 
                      className="accent-amber-500 w-3.5 h-3.5 rounded cursor-pointer" 
                    /> 
                    <span className="flex items-center gap-2 text-[11px] text-amber-200/90">
                      <span className="w-2 h-2 rounded-full border border-amber-400 bg-amber-400/80 inline-block"></span>
                      Penanda KM (Per 1 Km)
                    </span>
                  </label>
                )}

                <label className="flex items-center gap-2.5 py-1.5 px-2 rounded-lg hover:bg-slate-800/60 text-xs text-slate-200 cursor-pointer min-h-[38px] select-none">
                  <input 
                    type="checkbox" 
                    checked={showBuffer} 
                    onChange={(e) => setShowBuffer(e.target.checked)} 
                    className="accent-amber-500 w-4 h-4 rounded cursor-pointer" 
                  /> 
                  <span className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-yellow-400/80 inline-block"></span>
                    Buffer Zone 1 Km
                  </span>
                </label>

                <label className="flex items-center gap-2.5 py-1.5 px-2 rounded-lg hover:bg-slate-800/60 text-xs text-slate-200 cursor-pointer min-h-[38px] select-none">
                  <input 
                    type="checkbox" 
                    checked={showAdmin} 
                    onChange={(e) => setShowAdmin(e.target.checked)} 
                    className="accent-slate-500 w-4 h-4 rounded cursor-pointer" 
                  /> 
                  <span className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-sm border-2 border-white inline-block"></span>
                    Batas Wilayah Administrasi (BIG)
                  </span>
                </label>

                <label className="flex items-center gap-2.5 py-1.5 px-2 rounded-lg hover:bg-slate-800/60 text-xs text-slate-200 cursor-pointer min-h-[38px] select-none">
                  <input 
                    type="checkbox" 
                    checked={showHotspots} 
                    onChange={(e) => setShowHotspots(e.target.checked)} 
                    className="accent-red-500 w-4 h-4 rounded cursor-pointer" 
                  /> 
                  <span className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block"></span>
                    Titik Api (Thermal Hotspots)
                  </span>
                </label>
              </div>
            </div>
          </div>
        )}

        {/* Floating Toggle Button */}
        <button
          onClick={() => setShowLayerPanel(!showLayerPanel)}
          className={`h-12 w-12 sm:h-12 sm:w-auto sm:px-4 rounded-full border shadow-xl flex items-center justify-center gap-2 text-xs font-bold transition-all min-h-[44px] min-w-[44px] active:scale-95 ${
            showLayerPanel 
              ? 'bg-blue-600 border-blue-400 text-white' 
              : 'bg-slate-900/90 backdrop-blur-md border-slate-700 text-slate-200 hover:bg-slate-800'
          }`}
          title="Toggle Layers"
          aria-label="Toggle Layers"
        >
          <Layers className="w-5 h-5" />
          <span className="hidden sm:inline">Peta & Layer</span>
        </button>
      </div>

      {/* Emergency Alert Banner */}
      {showHotspots && newHotspots.length > 0 && !alertDismissed && (
        <div className="absolute top-3 inset-x-3 sm:inset-x-auto sm:right-4 sm:top-4 sm:max-w-sm bg-red-600/95 backdrop-blur-sm text-white p-3.5 sm:p-4 rounded-2xl shadow-2xl border border-red-400/50 flex items-center gap-3 z-[1000] animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
            <Flame className="w-6 h-6 text-white animate-pulse" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-black uppercase tracking-wider text-red-200">Peringatan Darurat</div>
            <div className="text-xs sm:text-sm font-bold truncate">Titik Api Baru Terdeteksi</div>
            <div className="text-[11px] opacity-90 font-mono">
              {newHotspots.length} hotspot baru terdeteksi
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {latestNewHotspot && (
              <button
                onClick={() => handleViewHotspot(latestNewHotspot)}
                className="px-2.5 py-1.5 bg-white text-red-700 text-xs font-bold rounded-lg hover:bg-red-50 active:scale-95 transition-all flex items-center gap-1 min-h-[36px] shadow-sm cursor-pointer"
                title="Langsung zoom in ke lokasi titik api"
              >
                <Navigation className="w-3.5 h-3.5" />
                <span>Lihat</span>
              </button>
            )}
            <button
              onClick={() => setAlertDismissed(true)}
              className="p-1.5 text-white/80 hover:text-white rounded-lg hover:bg-white/10 transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center cursor-pointer"
              aria-label="Dismiss alert"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
