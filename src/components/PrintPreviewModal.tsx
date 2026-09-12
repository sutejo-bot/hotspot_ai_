import { useState, useEffect } from "react";
import { X, Printer, Download } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Hotspot, HotspotTimeRange } from "../types";
import { getTimeRangeDescription, formatDateWITA, formatTimeWITA, fetchAddressFromCoordinates } from "../utils";

interface PrintPreviewModalProps {
  hotspots: Hotspot[];
  timeRange: HotspotTimeRange;
  onClose: () => void;
}

export default function PrintPreviewModal({ hotspots, timeRange, onClose }: PrintPreviewModalProps) {
  const [enrichedHotspots, setEnrichedHotspots] = useState<Hotspot[]>(hotspots);
  const [isEnriching, setIsEnriching] = useState(false);
  const newCount = hotspots.filter(h => h.status === "new").length;

  useEffect(() => {
    let isMounted = true;
    
    const enrichData = async () => {
      setIsEnriching(true);
      try {
        const enriched = await Promise.all(
          hotspots.map(async (h) => {
            if (h.address) return h;
            const addr = await fetchAddressFromCoordinates(h.location.lat, h.location.lng);
            return { ...h, address: addr };
          })
        );
        if (isMounted) {
          setEnrichedHotspots(enriched);
        }
      } catch (e) {
        console.error("Error enriching hotspots:", e);
      } finally {
        if (isMounted) {
          setIsEnriching(false);
        }
      }
    };
    
    enrichData();
    
    return () => {
      isMounted = false;
    };
  }, [hotspots]);

  const handleDownloadPDF = () => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    
    // Header
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text("Laporan Sebaran Hotspot Adaro Indonesia", pageWidth / 2, 20, { align: "center" });
    
    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    const periodText = `Periode: ${getTimeRangeDescription(timeRange)}`;
    doc.text(periodText, pageWidth / 2, 28, { align: "center" });
    
    const summaryText = `Total Titik Api: ${hotspots.length} | Titik Api Baru: ${newCount}`;
    doc.text(summaryText, pageWidth / 2, 34, { align: "center" });

    // Table Data
    const tableColumn = ["Waktu (WITA)", "Lokasi", "Koordinat", "Confidence", "Status"];
    const tableRows = enrichedHotspots.map(h => [
      `${formatDateWITA(new Date(h.detectedAt))} ${formatTimeWITA(new Date(h.detectedAt))}`,
      h.address || "Memuat lokasi...",
      `${h.location.lat.toFixed(5)}, ${h.location.lng.toFixed(5)}`,
      `${h.confidence}%`,
      h.status === "new" ? "Baru" : "Dikonfirmasi"
    ]);

    autoTable(doc, {
      head: [tableColumn],
      body: tableRows,
      startY: 45,
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255] },
      alternateRowStyles: { fillColor: [241, 245, 249] },
      columnStyles: {
        2: { textColor: [37, 99, 235] } // Blue text for coordinates to indicate link
      },
      didDrawCell: (data) => {
        if (data.column.index === 2 && data.cell.section === 'body') {
          const latLng = data.cell.text[0];
          const url = `https://www.google.com/maps?q=${latLng.replace(' ', '')}`;
          // Make the cell clickable in the PDF
          doc.link(data.cell.x, data.cell.y, data.cell.width, data.cell.height, { url });
        }
      }
    });
    
    // Footer
    const dateGenerated = new Date().toLocaleString("id-ID", { timeZone: "Asia/Makassar" });
    const pageCount = (doc as any).internal.getNumberOfPages();
    for(let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.text(`Dicetak pada: ${dateGenerated} WITA`, 14, doc.internal.pageSize.getHeight() - 10);
      doc.text(`Halaman ${i} dari ${pageCount}`, pageWidth - 20, doc.internal.pageSize.getHeight() - 10, { align: "right" });
    }

    doc.save(`Laporan_Hotspot_Adaro_${new Date().getTime()}.pdf`);
  };

  const handlePrint = () => {
    window.print();
  };

  const dateGenerated = new Date().toLocaleString("id-ID", { timeZone: "Asia/Makassar" });

  return (
    <div className="fixed inset-0 z-[100] bg-white flex flex-col overflow-hidden print:static print:inset-auto print:block print:bg-white">
      {/* Modal Container */}
      <div className="w-full h-full flex flex-col print:h-auto print:overflow-visible">
        
        {/* Modal Actions Header (Hidden when printing) */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200 bg-slate-50 print:hidden shrink-0 shadow-sm">
          <h2 className="font-bold text-lg text-slate-800">Print Review</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="flex items-center gap-2 px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg text-sm font-semibold transition-colors"
            >
              <span>Cancel</span>
            </button>
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm font-semibold transition-colors"
            >
              <Printer className="w-4 h-4" />
              <span>Print</span>
            </button>
            <button
              onClick={handleDownloadPDF}
              className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg text-sm font-semibold transition-colors"
            >
              <Download className="w-4 h-4" />
              <span>Download PDF</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-lg transition-colors ml-2"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable Content */}
        <div className="p-8 sm:p-10 overflow-y-auto print:p-0 print:overflow-visible flex-1">
          <div className="max-w-3xl mx-auto">
            {/* Header */}
            <div className="text-center mb-8 border-b pb-6 border-slate-200">
              <h1 className="text-2xl font-bold text-slate-900 mb-2">Laporan Sebaran Hotspot Adaro Indonesia</h1>
              <p className="text-slate-600 font-medium mb-1">Periode: {getTimeRangeDescription(timeRange)}</p>
              <p className="text-sm text-slate-500">Dicetak pada: {dateGenerated} WITA</p>
            </div>

            {/* Summary */}
            <div className="flex gap-6 mb-6">
              <div className="bg-slate-50 p-4 rounded-lg border border-slate-100 flex-1 text-center">
                <p className="text-sm text-slate-500 font-medium mb-1">Total Titik Api Terdeteksi</p>
                <p className="text-2xl font-bold text-slate-900">{hotspots.length}</p>
              </div>
              <div className="bg-red-50 p-4 rounded-lg border border-red-100 flex-1 text-center">
                <p className="text-sm text-red-600 font-medium mb-1">Titik Api Baru</p>
                <p className="text-2xl font-bold text-red-700">{newCount}</p>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto print:overflow-visible">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-800 text-white print:bg-slate-100 print:text-slate-900">
                    <th className="py-3 px-4 font-semibold border-b border-slate-700 print:border-slate-300">Waktu (WITA)</th>
                    <th className="py-3 px-4 font-semibold border-b border-slate-700 print:border-slate-300">Lokasi</th>
                    <th className="py-3 px-4 font-semibold border-b border-slate-700 print:border-slate-300">Koordinat</th>
                    <th className="py-3 px-4 font-semibold border-b border-slate-700 print:border-slate-300 text-center">Confidence</th>
                    <th className="py-3 px-4 font-semibold border-b border-slate-700 print:border-slate-300">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {enrichedHotspots.map((h, idx) => (
                    <tr key={idx} className="hover:bg-slate-50 print:hover:bg-transparent">
                      <td className="py-3 px-4 min-w-[130px]">
                        <div className="font-medium text-slate-900">{formatDateWITA(new Date(h.detectedAt))}</div>
                        <div className="text-slate-500">{formatTimeWITA(new Date(h.detectedAt))}</div>
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        {h.address ? h.address : (isEnriching ? "Memuat lokasi..." : "NASA FIRMS")}
                      </td>
                      <td className="py-3 px-4 min-w-[160px]">
                        <a 
                          href={`https://www.google.com/maps?q=${h.location.lat},${h.location.lng}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-600 hover:text-blue-800 hover:underline print:text-blue-600"
                        >
                          {h.location.lat.toFixed(5)}, {h.location.lng.toFixed(5)}
                        </a>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className="inline-block px-2 py-1 bg-slate-100 text-slate-700 rounded-md font-medium text-xs">
                          {h.confidence}%
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {h.status === "new" ? (
                          <span className="text-red-600 font-semibold print:text-red-700">Baru</span>
                        ) : (
                          <span className="text-emerald-600 font-medium print:text-emerald-700">Dikonfirmasi</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {enrichedHotspots.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-500 italic">
                        Tidak ada titik api yang terdeteksi pada periode ini.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            
          </div>
        </div>
      </div>
    </div>
  );
}
