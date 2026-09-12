import React from "react";

interface CompassRoseProps {
  onResetOrientation?: () => void;
  className?: string;
}

export const CompassRose: React.FC<CompassRoseProps> = ({ onResetOrientation, className = "" }) => {
  return (
    <div
      className={`group relative flex flex-col items-center select-none ${className}`}
      title="Kompas Orientasi Peta (Utara Sejati). Klik untuk memusatkan tampilan koridor."
    >
      <button
        onClick={onResetOrientation}
        className="w-14 h-14 rounded-2xl bg-slate-900/95 hover:bg-slate-850 active:bg-slate-800 backdrop-blur-md border-2 border-slate-600 shadow-2xl flex flex-col items-center justify-center p-1 transition-all duration-200 active:scale-95 focus:outline-none focus:ring-2 focus:ring-red-500/50 cursor-pointer"
        aria-label="Kompas Arah Utara Sejati"
      >
        <svg
          viewBox="0 0 100 100"
          className="w-9 h-9 transform transition-transform duration-300 group-hover:scale-105"
        >
          {/* Outer dial ring */}
          <circle
            cx="50"
            cy="50"
            r="46"
            fill="#090d16"
            stroke="#475569"
            strokeWidth="2.5"
          />
          <circle
            cx="50"
            cy="50"
            r="41"
            fill="none"
            stroke="#334155"
            strokeWidth="1.5"
            strokeDasharray="2, 3"
          />

          {/* Cardinal tick marks */}
          <line x1="50" y1="5" x2="50" y2="13" stroke="#ef4444" strokeWidth="3.5" strokeLinecap="round" />
          <line x1="95" y1="50" x2="87" y2="50" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" />
          <line x1="50" y1="95" x2="50" y2="87" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" />
          <line x1="5" y1="50" x2="13" y2="50" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" />

          {/* West needle */}
          <polygon points="50,50 16,50 50,54" fill="#94a3b8" />
          <polygon points="50,50 16,50 50,46" fill="#475569" />

          {/* East needle */}
          <polygon points="50,50 84,50 50,46" fill="#94a3b8" />
          <polygon points="50,50 84,50 50,54" fill="#475569" />

          {/* South needle */}
          <polygon points="50,50 50,84 46,50" fill="#94a3b8" />
          <polygon points="50,50 50,84 54,50" fill="#475569" />

          {/* North needle - vibrant red pointer */}
          <polygon points="50,50 50,12 43,50" fill="#dc2626" />
          <polygon points="50,50 50,12 57,50" fill="#ef4444" />

          {/* Center Hub */}
          <circle cx="50" cy="50" r="5.5" fill="#f8fafc" stroke="#dc2626" strokeWidth="2" />
          <circle cx="50" cy="50" r="2.5" fill="#0f172a" />

          {/* Cardinal Labels */}
          {/* U (Utara) */}
          <text
            x="50"
            y="26"
            textAnchor="middle"
            fill="#ffffff"
            fontSize="11"
            fontWeight="900"
            fontFamily="system-ui, sans-serif"
          >
            U
          </text>
        </svg>

        {/* Small label indicator under the compass */}
        <span className="text-[9px] font-mono font-extrabold text-red-400 tracking-wider leading-none mt-0.5">
          UTARA
        </span>
      </button>

      {/* Degree badge */}
      <div className="mt-1 px-1.5 py-0.5 rounded bg-slate-900/90 backdrop-blur-sm border border-slate-700 shadow text-[9px] font-mono font-bold text-slate-300 flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block animate-pulse"></span>
        <span>0° U</span>
      </div>
    </div>
  );
};
