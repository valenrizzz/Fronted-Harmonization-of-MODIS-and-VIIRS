import { useMemo, useState } from 'react';
import { Flame } from 'lucide-react';
import { MONTH_NAMES, fmtCount } from '../data/constants';
import DayCell from './DayCell';
import YearPills from './YearPills';
import ColorLegend from './ColorLegend';

const WEEKDAY_LABELS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

function startDayOfMonth(y, m) {
  const d = new Date(y, m, 1).getDay();
  return d === 0 ? 6 : d - 1;
}

function Tooltip({ t }) {
  return (
    <div
      className="fixed z-[100] pointer-events-none px-3 py-2 rounded-xl bg-white border border-stone-200 shadow-xl text-xs"
      style={{ left: t.x + 12, top: t.y - 8 }}
    >
      <div className="font-semibold text-stone-700">{t.date}</div>
      {t.noData ? (
        <div className="text-stone-500">Sin dato: ningún satélite operativo ese día</div>
      ) : (
        <>
          <div className="text-orange-600 font-mono">{t.count.toLocaleString('es-AR')} focos armonizados</div>
          {t.ci && <div className="text-stone-500">{t.ci}</div>}
          <div className="text-stone-500">{t.observed?.toLocaleString('es-AR')} observados · confiabilidad {t.tier}</div>
          {t.pctMedian && <div className="text-stone-400">{t.pctMedian}</div>}
          {t.provisional && <div className="text-orange-700">Dato provisorio (NRT)</div>}
          {t.suspect && <div className="text-amber-700">Cero dudoso: posible falta de cobertura</div>}
        </>
      )}
    </div>
  );
}

export default function FireCalendarSection({ year, setYear, yearData, data, region }) {
  const [tooltip, setTooltip] = useState(null);

  const monthBlocks = useMemo(() => {
    if (!yearData) return [];
    return Array.from({ length: 12 }, (_, m) => {
      const days = yearData[m] || [];
      return { month: m, days, totalMonth: data.monthlyTotals[year]?.[m] || 0 };
    }).filter((mb) => mb.days.length > 0);
  }, [yearData, data, year]);

  const maxCount = data.percentiles.p95 || data.percentiles.max || 1;
  const p90 = data.percentiles.p90 || Infinity;
  const partialYears = data.years.filter((y) => !data.completeYears.includes(y));

  return (
    <section id="calendar-section" className="w-full max-w-7xl mx-auto px-4 py-8">
      <div className="light-card p-6">
        <div className="mb-4">
          <h2 className="text-xl font-bold text-stone-800 flex items-center gap-2">
            <Flame className="w-5 h-5 text-orange-500" />
            Calendario en llamas · {year}
          </h2>
          <p className="text-sm text-stone-400 mt-1">
            Focos de calor armonizados por día (celdas H3 de ~5 km² con fuego, en unidades de la constelación MODIS + VIIRS actual) — {region}
          </p>
        </div>

        <YearPills year={year} setYear={setYear} years={data.years} partialYears={partialYears} />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mt-4">
          {monthBlocks.map(({ month, days, totalMonth }) => {
            const offset = startDayOfMonth(year, month) + (days[0].day - 1);
            return (
              <div key={month} className="bg-stone-50/70 rounded-xl p-3 border border-stone-100">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-stone-600 uppercase tracking-wider">{MONTH_NAMES[month]}</span>
                  <span className="text-[10px] font-mono text-stone-400">{fmtCount(totalMonth)} focos</span>
                </div>
                <div className="grid grid-cols-7 gap-[2px] mb-[2px]">
                  {WEEKDAY_LABELS.map((l) => (
                    <div key={l} className="text-center text-[8px] text-stone-400 font-medium">{l}</div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-[2px]">
                  {Array.from({ length: offset }, (_, i) => <div key={`sp-${i}`} className="aspect-square" />)}
                  {days.map((d) => (
                    <DayCell key={d.day} day={d} maxCount={maxCount} p90={p90}
                      year={year} month={month} medianByMonth={data.medianByMonth} setTooltip={setTooltip} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {tooltip && <Tooltip t={tooltip} />}
        <ColorLegend />
        {partialYears.length > 0 && (
          <p className="text-[10px] text-stone-400 text-center mt-2">* Año con registro parcial</p>
        )}
      </div>
    </section>
  );
}
