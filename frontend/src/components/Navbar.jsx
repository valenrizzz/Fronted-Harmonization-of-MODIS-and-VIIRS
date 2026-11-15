import { useState, useRef, useEffect } from 'react';
import {
  Flame, Satellite, ChevronDown, CalendarDays, Plus, Check, MapPin,
} from 'lucide-react';

export default function Navbar({
  locationLabel,
  satellites, toggleSatellite,
  dateRange, setDateRange,
}) {
  const [satOpen, setSatOpen] = useState(false);
  const satRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (satRef.current && !satRef.current.contains(e.target)) setSatOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-stone-200">
      <div className="max-w-[1920px] mx-auto flex items-center justify-between px-5 py-2.5 gap-4">
        {/* Left: Logo + Breadcrumb */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center shadow-md shadow-orange-200/50">
              <Flame className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-bold tracking-tight hidden sm:block">
              <span className="text-orange-600">Fire</span>
              <span className="text-stone-700">Watch</span>
            </span>
          </div>

          <div className="hidden md:flex items-center gap-1.5 text-sm text-stone-500">
            <MapPin className="w-3.5 h-3.5 text-orange-400" />
            <span className="text-stone-700 font-medium truncate max-w-[280px]">
              {locationLabel}
            </span>
          </div>
        </div>

        {/* Right: Satellite source + Date range */}
        <div className="flex items-center gap-3 shrink-0">
          {/* Satellite source */}
          <div className="relative" ref={satRef}>
            <button
              onClick={() => setSatOpen(!satOpen)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-stone-50 border border-stone-200 hover:border-stone-300 transition-colors text-sm"
            >
              <Satellite className="w-4 h-4 text-orange-500" />
              <span className="text-stone-700 font-medium hidden lg:block max-w-[200px] truncate">
                {satellites.find((s) => s.active)?.label || 'Seleccionar'}
              </span>
              <Plus className="w-3.5 h-3.5 text-stone-400" />
            </button>

            {satOpen && (
              <div className="absolute top-full right-0 mt-1.5 w-64 bg-white border border-stone-200 rounded-xl shadow-xl overflow-hidden py-1 z-50">
                <div className="px-3 py-1.5 text-[10px] text-stone-400 font-semibold uppercase tracking-wider">
                  Fuentes Satelitales
                </div>
                {satellites.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => toggleSatellite(s.id)}
                    className="w-full text-left px-3 py-2 text-sm transition-colors flex items-center gap-2 hover:bg-stone-50"
                  >
                    <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                      s.active ? 'bg-orange-500 border-orange-500' : 'border-stone-300 bg-white'
                    }`}>
                      {s.active && <Check className="w-3 h-3 text-white" />}
                    </div>
                    <span className={s.active ? 'text-orange-700 font-medium' : 'text-stone-500'}>
                      {s.label}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Date range */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-stone-50 border border-stone-200 text-sm">
            <CalendarDays className="w-4 h-4 text-stone-400" />
            <input
              type="month"
              value={dateRange.from}
              onChange={(e) => setDateRange({ ...dateRange, from: e.target.value })}
              className="bg-transparent text-stone-600 w-[110px] focus:outline-none text-xs"
            />
            <span className="text-stone-300">–</span>
            <input
              type="month"
              value={dateRange.to}
              onChange={(e) => setDateRange({ ...dateRange, to: e.target.value })}
              className="bg-transparent text-stone-600 w-[110px] focus:outline-none text-xs"
            />
          </div>
        </div>
      </div>
    </header>
  );
}
