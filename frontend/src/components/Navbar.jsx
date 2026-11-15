import { Flame, Satellite, CalendarDays, MapPin } from 'lucide-react';
import { fmtDate } from '../data/constants';

export default function Navbar({ locationLabel, regionInfo, dateRange, setDateRange }) {
  const sp = regionInfo?.sp_nrt;
  const min = regionInfo?.period.start.slice(0, 7);
  const max = regionInfo?.period.end.slice(0, 7);

  return (
    <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-stone-200">
      <div className="max-w-[1920px] mx-auto flex items-center justify-between px-5 py-2.5 gap-4">
        {/* Logo + ubicación */}
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
          {locationLabel && (
            <div className="hidden md:flex items-center gap-1.5 text-sm text-stone-500">
              <MapPin className="w-3.5 h-3.5 text-orange-400" />
              <span className="text-stone-700 font-medium truncate max-w-[280px]">{locationLabel}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {/* Fuente: constelación virtual armonizada + corte SP/NRT */}
          <div
            className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-stone-50 border border-stone-200 text-sm"
            title="MODIS (Terra, Aqua) y VIIRS (S-NPP, NOAA-20, NOAA-21) calibrados como un único sensor"
          >
            <Satellite className="w-4 h-4 text-orange-500" />
            <span className="text-stone-700 font-medium">Satélite virtual armonizado</span>
            {sp && (
              <span className="text-[10px] text-stone-400 border-l border-stone-200 pl-2">
                definitivo hasta {fmtDate(sp.sp_cutoff)} · provisorio hasta {fmtDate(sp.data_end)}
              </span>
            )}
          </div>

          {/* Rango para la exportación CSV */}
          <div
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-stone-50 border border-stone-200 text-sm"
            title="Rango de fechas de la exportación CSV"
          >
            <CalendarDays className="w-4 h-4 text-stone-400" />
            <input
              type="month"
              value={dateRange.from}
              min={min}
              max={dateRange.to || max}
              onChange={(e) => setDateRange({ ...dateRange, from: e.target.value })}
              className="bg-transparent text-stone-600 w-[110px] focus:outline-none text-xs"
            />
            <span className="text-stone-300">–</span>
            <input
              type="month"
              value={dateRange.to}
              min={dateRange.from || min}
              max={max}
              onChange={(e) => setDateRange({ ...dateRange, to: e.target.value })}
              className="bg-transparent text-stone-600 w-[110px] focus:outline-none text-xs"
            />
          </div>
        </div>
      </div>
    </header>
  );
}
