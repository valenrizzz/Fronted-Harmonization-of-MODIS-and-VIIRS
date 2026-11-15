import { useMemo, useState } from 'react';
import { Flame } from 'lucide-react';
import { MONTH_NAMES } from '../data/mockFireService';
import DayCell from './DayCell';
import YearPills from './YearPills';
import ColorLegend from './ColorLegend';

const WEEKDAY_LABELS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
function startDayOfMonth(y, m) {
  const d = new Date(y, m, 1).getDay();
  return d === 0 ? 6 : d - 1;
}
function formatCount(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} mil`;
  return n.toLocaleString('es-AR');
}

export default function FireCalendarSection({ year, setYear, yearData, data, region }) {
  const [tooltip, setTooltip] = useState(null);

  const monthBlocks = useMemo(() => {
    if (!yearData) return [];
    return Array.from({ length: 12 }, (_, m) => {
      const days = yearData[m] || [];
      const totalMonth = days.reduce((s, d) => s + d.count, 0);
      return { month: m, days, totalMonth };
    }).filter((mb) => mb.days.length > 0);
  }, [yearData]);

  const maxCount = useMemo(() => data?.percentiles?.p95 || data?.percentiles?.max || 1, [data]);
  const p90 = data?.percentiles?.p90 || Infinity;

  return (
    <section id="calendar-section" className="max-w-7xl mx-auto px-4 py-8">
      <div className="light-card p-6">
        {/* Header */}
        <div className="mb-4">
          <h2 className="text-xl font-bold text-stone-800 flex items-center gap-2">
            <Flame className="w-5 h-5 text-orange-500" />
            Calendario en llamas · {year}
          </h2>
          <p className="text-sm text-stone-400 mt-1">
            Focos de calor armonizados diarios — {region}
          </p>
        </div>

        <YearPills year={year} setYear={setYear} />

        {/* 3×4 month grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mt-4">
          {monthBlocks.map(({ month, days, totalMonth }) => {
            const offset = startDayOfMonth(year, month);
            return (
              <div key={month} className="bg-stone-50/70 rounded-xl p-3 border border-stone-100">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-stone-600 uppercase tracking-wider">
                    {MONTH_NAMES[month]}
                  </span>
                  <span className="text-[10px] font-mono text-stone-400">
                    {formatCount(totalMonth)} focos
                  </span>
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
                  {Array.from({ length: (7 - ((offset + days.length) % 7)) % 7 }, (_, i) => (
                    <div key={`end-${i}`} className="aspect-square" />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Tooltip */}
        {tooltip && (
          <div className="fixed z-[100] pointer-events-none px-3 py-2 rounded-xl bg-white border border-stone-200 shadow-xl text-xs"
            style={{ left: tooltip.x + 12, top: tooltip.y - 8 }}>
            <div className="font-semibold text-stone-700">{tooltip.date}</div>
            <div className="text-orange-600 font-mono">{tooltip.count.toLocaleString('es-AR')} focos</div>
            <div className="text-stone-500">FRP prom: {tooltip.frp} MW</div>
            <div className="text-stone-400">{tooltip.pctMedian}</div>
          </div>
        )}

        <ColorLegend />
      </div>
    </section>
  );
}
