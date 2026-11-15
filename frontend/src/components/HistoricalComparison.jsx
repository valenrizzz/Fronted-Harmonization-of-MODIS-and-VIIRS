import { useState, useMemo } from 'react';
import {
  TrendingUp, TrendingDown, BarChart3, Flame, Calendar,
  ToggleLeft, ToggleRight,
} from 'lucide-react';
import { MONTH_NAMES } from '../data/mockFireService';

const GRANULARITIES = ['Años', 'Meses', 'Semanas', 'Días'];
const METRICS = ['Total de focos', 'Puntos críticos'];

function formatNum(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} mil`;
  return n.toLocaleString('es-AR');
}

export default function HistoricalComparison({ data, region, year }) {
  const [granularity, setGranularity] = useState('Años');
  const [metric, setMetric] = useState('Total de focos');

  const yearTotal = data.yearlyTotals[year] || 0;
  const median = data.medianYearly || 1;
  const anomaly = Math.round(((yearTotal - median) / median) * 100);
  const anomalyPositive = anomaly >= 0;

  // Critical points: days exceeding p90 in the selected year
  const criticalCount = useMemo(() => {
    const yearDays = data.daily[year];
    if (!yearDays) return 0;
    let count = 0;
    const p90 = data.percentiles.p90;
    Object.values(yearDays).forEach((month) =>
      month.forEach((d) => { if (d.count >= p90) count++; }),
    );
    return count;
  }, [data, year]);

  // Monthly comparison data for the mini chart
  const monthlyComparison = useMemo(() => {
    const currentMonthly = data.monthlyTotals[year] || {};
    return Array.from({ length: 12 }, (_, m) => ({
      month: MONTH_NAMES[m],
      current: currentMonthly[m] || 0,
      median: data.medianByMonth[m] || 0,
    })).filter((m) => m.current > 0 || m.median > 0);
  }, [data, year]);

  const maxBar = useMemo(() => {
    return Math.max(
      ...monthlyComparison.map((m) => Math.max(m.current, m.median)),
      1,
    );
  }, [monthlyComparison]);

  return (
    <div className="glass-card p-4">
      <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2 mb-3">
        <BarChart3 className="w-4 h-4 text-amber-400" />
        Comparativa vs Mediana Histórica
      </h3>

      {/* Controls */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {GRANULARITIES.map((g) => (
          <button
            key={g}
            onClick={() => setGranularity(g)}
            className={`pill-btn text-[10px] ${granularity === g ? 'pill-active' : 'pill-inactive'}`}
          >
            {g}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => setMetric(metric === METRICS[0] ? METRICS[1] : METRICS[0])}
          className="flex items-center gap-1.5 text-[10px] text-slate-400 hover:text-slate-300 transition-colors"
        >
          {metric === METRICS[0] ? (
            <ToggleLeft className="w-4 h-4 text-slate-500" />
          ) : (
            <ToggleRight className="w-4 h-4 text-amber-400" />
          )}
          {metric}
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="bg-slate-800/50 rounded-lg p-2 text-center">
          <div className={`text-lg font-bold font-mono ${
            anomalyPositive ? 'text-red-400' : 'text-emerald-400'
          }`}>
            {anomalyPositive ? '+' : ''}{anomaly}%
          </div>
          <div className="text-[9px] text-slate-500 flex items-center justify-center gap-0.5">
            {anomalyPositive ? (
              <TrendingUp className="w-3 h-3" />
            ) : (
              <TrendingDown className="w-3 h-3" />
            )}
            Anomalía
          </div>
        </div>
        <div className="bg-slate-800/50 rounded-lg p-2 text-center">
          <div className="text-lg font-bold font-mono text-amber-400">
            {formatNum(yearTotal)}
          </div>
          <div className="text-[9px] text-slate-500">Total {year}</div>
        </div>
        <div className="bg-slate-800/50 rounded-lg p-2 text-center">
          <div className="text-lg font-bold font-mono text-orange-400">
            {criticalCount}
          </div>
          <div className="text-[9px] text-slate-500 flex items-center justify-center gap-0.5">
            <Flame className="w-3 h-3" />
            P. Críticos
          </div>
        </div>
      </div>

      {/* Mini comparison chart */}
      <div className="space-y-1">
        {monthlyComparison.map((m) => (
          <div key={m.month} className="flex items-center gap-1.5 text-[10px]">
            <span className="w-7 text-right text-slate-500 font-medium shrink-0">
              {m.month}
            </span>
            <div className="flex-1 flex flex-col gap-[1px]">
              {/* Current year */}
              <div className="h-[5px] rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-500 to-red-500 transition-all duration-300"
                  style={{ width: `${(m.current / maxBar) * 100}%` }}
                />
              </div>
              {/* Median */}
              <div className="h-[3px] rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-slate-600 transition-all duration-300"
                  style={{ width: `${(m.median / maxBar) * 100}%` }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-2 text-[9px] text-slate-500">
        <span className="flex items-center gap-1">
          <span className="w-3 h-1.5 rounded-full bg-gradient-to-r from-amber-500 to-red-500 inline-block" />
          {year}
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-1.5 rounded-full bg-slate-600 inline-block" />
          Mediana
        </span>
      </div>
    </div>
  );
}
