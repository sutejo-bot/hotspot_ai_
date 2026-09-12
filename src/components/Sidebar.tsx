import { useState, useEffect } from "react";
import { Hotspot, HotspotTimeRange } from "../types";
import { Flame, CheckCircle, ShieldAlert, X, MapPin, Calendar, Clock, RefreshCw, Radio, MessageCircle, Loader2, Send, Satellite, ShieldCheck } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn, getTimeRangeLabel, getTimeRangeDescription, formatHotspotRelativeTime, formatDateWITA, formatTimeWITA, fetchAddressFromCoordinates } from "../utils";
import PrintPreviewModal from "./PrintPreviewModal";

interface SidebarProps {
  hotspots: Hotspot[];
  onAcknowledge: (id: string) => void;
  onSelectHotspot?: (hotspot: Hotspot) => void;
  selectedHotspotId?: string | null;
  onCloseMobile?: () => void;
  timeRange: HotspotTimeRange;
  onTimeRangeChange: (range: HotspotTimeRange) => void;
  isLoading?: boolean;
  onOpenPrintPreview: () => void;
}

const SidebarAddress = ({ lat, lng, initialAddress }: { lat: number, lng: number, initialAddress?: string }) => {
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
    <div className="text-[10px] text-slate-400 mt-1.5 p-1.5 bg-slate-900/60 rounded-md border border-slate-800 leading-tight">
      <span className="font-semibold text-slate-300">Lokasi:</span> {address}
    </div>
  );
};

export default function Sidebar({ 
  hotspots, 
  onAcknowledge,
  onSelectHotspot,
  selectedHotspotId,
  onCloseMobile,
  timeRange,
  onTimeRangeChange,
  isLoading,
  onOpenPrintPreview
}: SidebarProps) {
  const newCount = hotspots.filter(h => h.status === "new").length;
  const [sendingWaId, setSendingWaId] = useState<string | null>(null);
  const [sendingTgId, setSendingTgId] = useState<string | null>(null);

  const handleSendTelegram = async (hotspot: Hotspot) => {
    setSendingTgId(hotspot.id);
    try {
      const address = await fetchAddressFromCoordinates(hotspot.location.lat, hotspot.location.lng);
      
      const response = await fetch('/api/notify-telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: hotspot.location.lat,
          lng: hotspot.location.lng,
          location: address,
          date: formatDateWITA(new Date(hotspot.detectedAt)) + ' ' + formatTimeWITA(new Date(hotspot.detectedAt)),
          id: hotspot.id,
          source: 'manual',
          hotspotSource: hotspot.source || 'Multi-Satelit Terintegrasi',
          confidence: hotspot.confidence,
          zone: hotspot.zone
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Gagal mengirim pesan Telegram");
      }
      
      alert("Peringatan Telegram (Manual) berhasil dikirim ke Chat ID terkonfigurasi!");
    } catch (error: any) {
      alert(`Terjadi kesalahan: ${error.message}`);
    } finally {
      setSendingTgId(null);
    }
  };

  const handleSendWA = async (hotspot: Hotspot) => {
    const target = window.prompt("Masukkan nomor WhatsApp tujuan (contoh: 081234567890):", "");
    if (!target) return;

    setSendingWaId(hotspot.id);
    try {
      const address = await fetchAddressFromCoordinates(hotspot.location.lat, hotspot.location.lng);
      
      const response = await fetch('/api/notify-wa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target,
          lat: hotspot.location.lat,
          lng: hotspot.location.lng,
          location: address,
          date: formatDateWITA(new Date(hotspot.detectedAt)) + ' ' + formatTimeWITA(new Date(hotspot.detectedAt)),
          id: hotspot.id,
          source: 'manual',
          hotspotSource: hotspot.source || 'Multi-Satelit Terintegrasi',
          confidence: hotspot.confidence,
          zone: hotspot.zone
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Gagal mengirim pesan");
      }
      
      alert("Peringatan WhatsApp (Manual) berhasil dikirim!");
    } catch (error: any) {
      alert(`Terjadi kesalahan: ${error.message}`);
    } finally {
      setSendingWaId(null);
    }
  };

  return (
    <>
    <div className="w-full h-full bg-[#111827] border-r border-slate-800 flex flex-col z-10 relative">
      {/* Sidebar Header - Slim & compact */}
      <div className="p-2.5 sm:p-3 border-b border-slate-800 bg-slate-900/70 shrink-0">
        <div className="flex items-center justify-between">
          <div className="w-full">
            <div className="flex items-center justify-between gap-1.5">
              <h2 className="text-[11px] font-bold text-slate-200 uppercase tracking-wider truncate">
                Monitoring Titik Api ({hotspots.length})
              </h2>
              {newCount > 0 && (
                <span className="px-1.5 py-0.5 text-[9px] font-bold bg-red-600 text-white rounded-full animate-pulse shrink-0">
                  {newCount} Baru
                </span>
              )}
            </div>
            
            {/* Integrated Satellite badges - compact flex wrap */}
            <div className="mt-1.5 text-[10px] text-slate-400">
              <div className="flex items-center gap-1 text-[10px] text-slate-300 font-medium mb-1">
                <Satellite className="w-3 h-3 text-blue-400 shrink-0" />
                <span>Data: Himawari-9, SiPongi+, BRIN, BMKG, NASA</span>
              </div>
              <div className="flex items-center gap-1 text-[9px] text-emerald-400/90 font-mono">
                <ShieldCheck className="w-2.5 h-2.5 shrink-0" />
                <span>Klaster Anti-Duplikasi 1.5 km</span>
              </div>
            </div>
          </div>

          {/* Mobile Close Button */}
          {onCloseMobile && (
            <button
              onClick={onCloseMobile}
              className="md:hidden p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center -mr-1"
              aria-label="Tutup panel"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Rentang Waktu (Saat Ini, 12 Jam Lalu, 1 Hari, 7 Hari, 30 Hari) */}
        <div className="mt-2 pt-2 border-t border-slate-800/80">
          <div className="flex items-center justify-between text-[9px] text-slate-400 font-semibold uppercase tracking-wider mb-1">
            <div className="flex items-center gap-1">
              <Clock className="w-2.5 h-2.5 text-orange-400" />
              <span>Rentang Waktu</span>
            </div>
            {isLoading && (
              <span className="text-[9px] text-orange-400 flex items-center gap-1">
                <RefreshCw className="w-2 h-2 animate-spin" />
                Memuat...
              </span>
            )}
          </div>
          
          <div className="space-y-1 bg-slate-950/90 p-1 rounded-lg border border-slate-800">
            {/* Real-time / Hourly row */}
            <div className="grid grid-cols-2 gap-1">
              <button
                onClick={() => onTimeRangeChange("now")}
                disabled={isLoading}
                className={cn(
                  "py-1 px-1.5 text-[11px] font-bold rounded-md transition-all text-center flex items-center justify-center gap-1 select-none min-h-[28px]",
                  timeRange === "now"
                    ? "bg-red-600 text-white shadow-sm"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/70"
                )}
                title="Deteksi Satelit Real-time / Saat Ini"
              >
                <Radio className={cn("w-2.5 h-2.5 shrink-0", timeRange === "now" ? "text-white animate-pulse" : "text-red-400")} />
                <span>Saat Ini</span>
                <span className="text-[8px] px-1 py-0.1 bg-red-950 text-red-200 rounded font-mono border border-red-500/30">LIVE</span>
              </button>

              <button
                onClick={() => onTimeRangeChange("12h")}
                disabled={isLoading}
                className={cn(
                  "py-1 px-1.5 text-[11px] font-bold rounded-md transition-all text-center flex items-center justify-center gap-1 select-none min-h-[28px]",
                  timeRange === "12h"
                    ? "bg-orange-600 text-white shadow-sm"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/70"
                )}
                title="Deteksi 12 Jam Terakhir"
              >
                <Clock className="w-2.5 h-2.5 text-orange-400 shrink-0" />
                <span>12 Jam Lalu</span>
              </button>
            </div>

            {/* Daily row */}
            <div className="grid grid-cols-3 gap-1">
              {([1, 7, 30] as const).map((days) => (
                <button
                  key={days}
                  onClick={() => onTimeRangeChange(days)}
                  disabled={isLoading}
                  className={cn(
                    "py-1 px-1 text-[10px] font-bold rounded-md transition-all text-center flex items-center justify-center gap-0.5 select-none min-h-[26px]",
                    timeRange === days
                      ? "bg-orange-600 text-white shadow-sm"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/70"
                  )}
                >
                  <span>{days} Hari</span>
                  {days === 1 && <span className="text-[8px] opacity-75 font-normal">lalu</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      
      {/* Hotspots List - Slim & Compact */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2 overscroll-contain">
        <AnimatePresence>
          {hotspots.length === 0 ? (
            <div className="text-center py-10 px-3 text-slate-500">
              <ShieldAlert className="w-10 h-10 mx-auto mb-2 opacity-25" />
              <p className="text-xs font-medium text-slate-400">Tidak ada titik api</p>
              <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                Area konsesi IUPK dan koridor pengamanan bebas dari anomali termal dalam rentang {getTimeRangeDescription(timeRange)}.
              </p>
            </div>
          ) : (
            hotspots.map(hotspot => {
              const isSelected = selectedHotspotId === hotspot.id;
              const isNew = hotspot.status === "new";
              const isToday = hotspot.daysAgo === 0;

              return (
                <motion.div
                  key={hotspot.id}
                  initial={{ opacity: 0, y: -8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  onClick={() => onSelectHotspot?.(hotspot)}
                  className={cn(
                    "p-2.5 rounded-lg relative overflow-hidden transition-all cursor-pointer select-none",
                    isToday 
                      ? "bg-red-500/10 border border-red-500/30 hover:border-red-500/60" 
                      : "bg-orange-500/10 border border-orange-500/30 hover:border-orange-500/60 opacity-90",
                    isSelected && "ring-2 ring-blue-500 border-transparent shadow-md bg-slate-800/80"
                  )}
                >
                  <div className="flex justify-between items-start mb-1">
                    <div className="flex items-center gap-1">
                      <span className={cn(
                        "text-[9px] font-bold px-1.5 py-0.5 rounded text-white uppercase tracking-wider",
                        isToday ? "bg-red-600" : "bg-orange-600"
                      )}>
                        {formatHotspotRelativeTime(hotspot.detectedAt, hotspot.daysAgo)}
                      </span>
                    </div>
                    <span className={cn(
                      "text-[11px] font-mono font-semibold",
                      isToday ? "text-red-400" : "text-orange-400"
                    )}>
                      {hotspot.confidence}% Conf.
                    </span>
                  </div>

                  {/* Date & Time display */}
                  <div className="flex items-center gap-1 text-[10px] text-slate-400 mb-1 font-mono">
                    <Clock className="w-2.5 h-2.5 text-slate-500 shrink-0" />
                    <span>
                      {formatDateWITA(new Date(hotspot.detectedAt))} • {formatTimeWITA(new Date(hotspot.detectedAt))}
                    </span>
                  </div>

                  <div className="text-xs font-semibold mb-1 flex items-center gap-1 text-slate-100">
                    <Flame className={cn("w-3.5 h-3.5 shrink-0", isToday ? "text-red-500" : "text-orange-500")} />
                    <span className="truncate">ID: {hotspot.id.toUpperCase()}</span>
                  </div>

                  {/* Satellite Source Indicator */}
                  <div className="flex items-center gap-1 text-[10px] text-slate-300 mb-1.5 bg-slate-900/90 border border-slate-800 px-1.5 py-1 rounded">
                    <Satellite className="w-3 h-3 text-cyan-400 shrink-0" />
                    <span className="text-slate-400 font-medium shrink-0">Sumber:</span>
                    <span className="text-slate-200 truncate" title={hotspot.source || "Multi-Satelit Terpadu"}>
                      {hotspot.source || "Multi-Satelit"}
                    </span>
                  </div>

                  <div className="text-[10px] font-mono mt-1 flex items-center justify-between">
                    <a 
                      href={`https://www.google.com/maps/search/?api=1&query=${hotspot.location.lat},${hotspot.location.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 px-1.5 py-0.5 rounded transition-colors inline-block"
                      title="Buka di Google Maps"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {hotspot.location.lat.toFixed(4)}, {hotspot.location.lng.toFixed(4)}
                    </a>
                    
                    <span className="text-[9px] text-slate-500 flex items-center gap-0.5">
                      <MapPin className="w-2.5 h-2.5 text-blue-400" />
                      Fokus
                    </span>
                  </div>

                  <SidebarAddress lat={hotspot.location.lat} lng={hotspot.location.lng} initialAddress={hotspot.address} />

                  <div className="mt-2 flex flex-col gap-1.5">
                    <div className="grid grid-cols-2 gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSendWA(hotspot);
                        }}
                        disabled={sendingWaId === hotspot.id}
                        className="py-1 px-1.5 bg-green-500/10 hover:bg-green-500/20 border border-green-500/30 rounded text-[10px] font-bold transition-colors flex items-center justify-center text-green-400 disabled:opacity-50 min-h-[30px]"
                      >
                        {sendingWaId === hotspot.id ? (
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        ) : (
                          <MessageCircle className="w-3 h-3 mr-1" />
                        )}
                        <span>Kirim WA</span>
                      </button>
                      
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSendTelegram(hotspot);
                        }}
                        disabled={sendingTgId === hotspot.id}
                        className="py-1 px-1.5 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 rounded text-[10px] font-bold transition-colors flex items-center justify-center text-blue-400 disabled:opacity-50 min-h-[30px]"
                      >
                        {sendingTgId === hotspot.id ? (
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        ) : (
                          <Send className="w-3 h-3 mr-1" />
                        )}
                        <span>Kirim TG</span>
                      </button>
                    </div>

                    {isNew && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onAcknowledge(hotspot.id);
                        }}
                        className="w-full py-1 px-2 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 border border-slate-700 rounded text-[10px] font-bold uppercase tracking-wider transition-colors flex items-center justify-center text-slate-200 group min-h-[28px]"
                      >
                        <CheckCircle className="w-3 h-3 mr-1.5 text-emerald-400 group-hover:scale-110 transition-transform" />
                        Konfirmasi Ancaman
                      </button>
                    )}
                  </div>
                </motion.div>
              );
            })
          )}
        </AnimatePresence>
      </div>
      
      {/* Sidebar Footer - Compact */}
      <div className="p-2 sm:p-2.5 bg-slate-900 border-t border-slate-800 shrink-0">
        <div className="text-[10px] text-slate-400 mb-1.5 flex items-center justify-between">
          <span>Status Sistem ({getTimeRangeLabel(timeRange)})</span>
          <span className="text-emerald-400 font-semibold flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            Terkoneksi
          </span>
        </div>
        <button 
          onClick={onOpenPrintPreview}
          className="w-full py-2 px-3 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 border border-slate-700 rounded-md text-[11px] font-bold uppercase tracking-wider transition-colors text-white flex items-center justify-center min-h-[36px]"
        >
          Cetak Ringkasan Sebaran
        </button>
      </div>
    </div>
    </>
  );
}
