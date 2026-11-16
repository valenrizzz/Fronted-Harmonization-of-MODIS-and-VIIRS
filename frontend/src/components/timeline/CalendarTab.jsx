import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { Flame } from 'lucide-react';
import { MONTH_NAMES, fmtCount, fmtInt, fireColor, FIRE_GRADIENT_CSS, TIER_LABEL } from '../../data/constants';
import { Skeleton } from '../ui/primitives';
import { inRange } from '../../data/presets';

const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const startDay = (y, m) => (new Date(y, m, 1).getDay() + 6) % 7;
const short = (n) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n);

function DayTooltip({ t }) {
  const d = t.day;
  const noData = d.status === 'no_data';
  return createPortal(
    <div className="fixed z-[100] pointer-events-none glass-strong px-3 py-2 text-[11px] min-w-[190px]"
      style={{ left: Math.min(t.x + 14, window.innerWidth - 230), top: t.y - 96 }}>
      <div className="font-semibold text-brand-950">{d.day} {MONTH_NAMES[t.month]} {t.year}</div>
      {noData ? (
        <div className="text-slate-500">Sin dato satelital ese día</div>
      ) : (
        <>
          {t.raw ? (
            <>
              <div className="font-display text-base text-violet-700">{fmtInt(d.nasa)} <span className="text-[10px] text-slate-500 font-sans">detecciones NASA originales</span></div>
              <div className="text-[10px] text-slate-500">Confiabilidad baja: conteo sin armonizar <span className="font-mono text-slate-400">(armonizado {fmtInt(d.harmonized)})</span></div>
            </>
          ) : (
            <div className="font-display text-base text-orange-700">{fmtInt(d.harmonized)} <span className="text-[10px] text-slate-500 font-sans">focos armonizados</span></div>
          )}
          {!t.raw && d.ciLow != null && d.ciHigh - d.ciLow >= 1 && (
            <div className="font-mono text-[10px] text-slate-500">IC 95% {fmtInt(d.ciLow)}–{fmtInt(d.ciHigh)}</div>
          )}
          <div className="text-[10px] text-slate-500">{fmtInt(d.observed)} observados · confiabilidad {TIER_LABEL[d.tier] || '–'}</div>
          {d.layer === 'NRT' && <div className="text-[10px] text-orange-600">Dato provisorio (NRT)</div>}
          {d.status === 'suspect_zero' && <div className="text-[10px] text-amber-600">Cero dudoso: posible falta de cobertura</div>}
        </>
      )}
    </div>,
    document.body,
  );
}

/** Calendario diario limitado a los años del rango del mapa; `year`/`onYear` eligen dentro de ese rango. */
export default function CalendarTab({ fd, year, onYear }) {
  const data = fd.daily.data;
  const [tip, setTip] = useState(null);

  const months = useMemo(() => {
    const yd = data?.daily[year];
    if (!yd) return [];
    return Array.from({ length: 12 }, (_, m) => ({ m, days: yd[m] || [], total: data.monthlyTotals[year]?.[m] || 0 }))
      .filter((b) => b.days.length);
  }, [data, year]);

  if (!data) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-44 !rounded-xl" />)}
      </div>
    );
  }

  const ref = data.percentiles.p95 || data.percentiles.max || 1;
  const p90 = data.percentiles.p90 || Infinity;
  const partial = new Set(data.years.filter((y) => !data.completeYears.includes(y)));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1">
        {data.years.filter((y) => inRange(y, fd.range)).map((y) => (
          <button key={y} onClick={() => onYear(y)}
            className={`relative pill-btn font-mono ${y === year ? 'text-brand-700' : 'pill-inactive'}`}
            title={partial.has(y) ? 'Año con registro parcial' : undefined}>
            {y === year && (
              <motion.span layoutId="year-pill" className="absolute inset-0 rounded-full bg-brand-50 ring-1 ring-brand-200"
                transition={{ type: 'spring', stiffness: 420, damping: 36 }} />
            )}
            <span className="relative">{y}{partial.has(y) ? '*' : ''}</span>
          </button>
        ))}
      </div>

      <motion.div key={`${fd.region}-${year}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {months.map(({ m, days, total }) => {
          const offset = startDay(year, m) + (days[0].day - 1);
          return (
            <div key={m} className="rounded-xl bg-slate-50/80 border border-slate-100 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-600">{MONTH_NAMES[m]}</span>
                <span className="text-[10px] font-mono text-slate-400">{fmtCount(total)} focos</span>
              </div>
              <div className="grid grid-cols-7 gap-[3px]">
                {WEEKDAYS.map((w) => <div key={w} className="text-center text-[8px] font-medium text-slate-400">{w}</div>)}
                {Array.from({ length: offset }, (_, i) => <div key={`e${i}`} />)}
                {days.map((d) => {
                  const noData = d.status === 'no_data';
                  const raw = d.tier === 'low' && d.nasa != null;
                  const shown = raw ? d.nasa : Math.round(d.harmonized || 0);
                  const t = Math.min(Math.pow(shown / ref, 0.55), 1);
                  const hot = !noData && !raw && shown > 0 && shown >= p90;
                  return (
                    <div
                      key={d.day}
                      onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, day: d, month: m, year, raw })}
                      onMouseLeave={() => setTip(null)}
                      className={`relative aspect-square rounded-[4px] flex items-center justify-center cursor-default transition-transform duration-100 hover:scale-125 hover:z-10 hover:shadow-md ${
                        noData ? 'hatch-nodata' : shown > 0 ? '' : 'bg-white border border-slate-200/70'
                      } ${raw ? 'ring-1 ring-inset ring-violet-500/70' : ''} ${
                        d.layer === 'NRT' ? 'outline outline-1 outline-dashed outline-orange-400 -outline-offset-1' : ''
                      } ${hot ? 'ring-1 ring-red-500/60 shadow-sm shadow-red-300/50' : ''}`}
                      style={!noData && shown > 0 ? { background: fireColor(t) } : undefined}
                    >
                      {!noData && shown > 0 && (
                        <span className="text-[7px] font-semibold font-mono leading-none select-none" style={{ color: t > 0.6 ? '#fff' : '#431407' }}>
                          {short(shown)}
                        </span>
                      )}
                      {hot && <Flame className="absolute -top-1 -right-1 w-2.5 h-2.5 text-red-500 drop-shadow-sm" fill="currentColor" />}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </motion.div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11px] text-slate-500">
        <span className="flex items-center gap-1.5">Menos <span className="w-24 h-2.5 rounded-full" style={{ background: FIRE_GRADIENT_CSS }} /> Más</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-[3px] hatch-nodata border border-slate-200" />Sin dato satelital</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-[3px] outline outline-1 outline-dashed outline-orange-400" />Provisorio (NRT)</span>
        <span className="flex items-center gap-1.5"><Flame className="w-3 h-3 text-red-500" fill="currentColor" />Día pico (≥ P90 histórico)</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-[3px] ring-1 ring-inset ring-violet-500/70" />Confiabilidad baja (conteo NASA)</span>
        {partial.size > 0 && <span className="text-slate-400">* Año con registro parcial</span>}
      </div>
      {tip && <DayTooltip t={tip} />}
    </div>
  );
}
