import { useMemo, useState } from 'react';
import { Flame } from 'lucide-react';
import { MONTH_NAMES } from '../data/constants';
import DayCell from './DayCell';
import YearPills from './YearPills';
import ColorLegend from './ColorLegend';

const WEEKDAY_LABELS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

function daysInMonth(y, m) {
  return new Date(y, m + 1, 0).getDate();
}

function startDayOfMonth(y, m) {
  const d = new Date(y, m, 1).getDay();
  return d === 0 ? 6 : d - 1; // Monday = 0
}

function formatCount(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)} mil`;
  return n.toLocaleString('es-AR');
}

export default function FireCalendarGrid({ year, setYear, yearData, data, region }) {
  const [tooltip, setTooltip] = useState(null);

  const monthBlocks = useMemo(() => {
    if (!yearData) return [];
    return Array.from({ length: 12 }, (_, m) => {
      const days = yearData[m] || [];
      const totalMonth = days.reduce((s, d) => s + d.count, 0);
      return { month: m, days, totalMonth };
    }).filter((mb) => mb.days.length > 0);
  }, [yearData]);

  const maxCount = useMemo(() => {
    if (!data?.percentiles) return 1;
    return data.percentiles.p95 || data.percentiles.max || 1;
  }, [data]);

  const p90 = data?.percentiles?.p90 || Infinity;

  return (
    <div className="glass-card p-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-3">
        <div>
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <Flame className="w-5 h-5 text-amber-500" />
            Calendario en llamas · {year}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Focos de calor armonizados diarios — {region}
          </p>
        </div>
      </div>

      {/* Year pills */}
      <YearPills year={year} setYear={setYear} />

      {/* Month grid: 3 rows × 4 cols */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 mt-3">
        {monthBlocks.map(({ month, days, totalMonth }) => {
          const dim = daysInMonth(year, month);
          const offset = startDayOfMonth(year, month);

          return (
            <div
              key={month}
              className="bg-slate-800/40 rounded-lg p-2.5 border border-slate-800/50"
            >
              {/* Month header */}
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  {MONTH_NAMES[month]}
                </span>
                <span className="text-[10px] font-mono text-slate-500">
                  {formatCount(totalMonth)} focos
                </span>
              </div>

              {/* Weekday labels */}
              <div className="grid grid-cols-7 gap-[2px] mb-[2px]">
                {WEEKDAY_LABELS.map((l) => (
                  <div key={l} className="text-center text-[8px] text-slate-600 font-medium">
                    {l}
                  </div>
                ))}
              </div>

              {/* Day grid */}
              <div className="grid grid-cols-7 gap-[2px]">
                {/* Offset spacers */}
                {Array.from({ length: offset }, (_, i) => (
                  <div key={`sp-${i}`} className="aspect-square" />
                ))}

                {/* Days */}
                {days.map((d) => (
                  <DayCell
                    key={d.day}
                    day={d}
                    maxCount={maxCount}
                    p90={p90}
                    year={year}
                    month={month}
                    medianByMonth={data.medianByMonth}
                    setTooltip={setTooltip}
                  />
                ))}

                {/* Fill remaining if needed */}
                {Array.from(
                  { length: (7 - ((offset + days.length) % 7)) % 7 },
                  (_, i) => <div key={`end-${i}`} className="aspect-square" />,
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-[100] pointer-events-none px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 shadow-xl text-xs"
          style={{ left: tooltip.x + 12, top: tooltip.y - 8 }}
        >
          <div className="font-semibold text-slate-200">{tooltip.date}</div>
          <div className="text-amber-400 font-mono">{tooltip.count.toLocaleString('es-AR')} focos</div>
          <div className="text-slate-400">FRP prom: {tooltip.frp} MW</div>
          <div className="text-slate-500">{tooltip.pctMedian}</div>
        </div>
      )}

      {/* Color Legend */}
      <ColorLegend />
    </div>
  );
}
