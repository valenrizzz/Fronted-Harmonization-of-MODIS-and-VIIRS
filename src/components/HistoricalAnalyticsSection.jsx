import { useMemo, useState } from 'react';
import { TrendingUp, Flame, Calendar, BarChart3, Download } from 'lucide-react';
import { MONTH_NAMES } from '../data/mockFireService';

const fmt = (n) => (n >= 1e6 ? `${(n/1e6).toFixed(1)}M` : n >= 1e3 ? `${(n/1e3).toFixed(1)} mil` : n.toLocaleString('es-AR'));
const LEVELS = ['Día','Semana','Mes','Año','Total crudo'];
const SVG_W = 460, SVG_H = 180, PAD = 32;

export default function HistoricalAnalyticsSection({ data, region, year, downloadCSV }) {
  const [csvLevel, setCsvLevel] = useState('Día');

  const yearTotal = data.yearlyTotals[year] || 0;
  const median = data.medianYearly || 1;
  const anomalyPct = Math.round(((yearTotal - median) / median) * 100);
  const topYear = data.topYears[0] || { year: '-', total: 0 };

  // Monthly data for charts
  const monthly = useMemo(() => {
    const cur = data.monthlyTotals[year] || {};
    // Compute P25 and P75 per month across all years
    const byMonth = {};
    for (let m = 0; m < 12; m++) byMonth[m] = [];
    for (const [, months] of Object.entries(data.monthlyTotals)) {
      for (const [m, v] of Object.entries(months)) byMonth[m].push(v);
    }
    return Array.from({ length: 12 }, (_, m) => {
      const sorted = [...(byMonth[m] || [])].sort((a, b) => a - b);
      const len = sorted.length;
      const p25 = sorted[Math.floor(len * 0.25)] || 0;
      const p75 = sorted[Math.floor(len * 0.75)] || 0;
      return { m, label: MONTH_NAMES[m], current: cur[m] || 0, median: data.medianByMonth[m] || 0, p25, p75 };
    });
  }, [data, year]);

  const maxM = Math.max(...monthly.map(d => Math.max(d.current, d.p75, d.median)), 1);

  // Best month
  const bestMonth = monthly.reduce((a, b) => b.current > a.current ? b : a, monthly[0]);

  // Yearly anomalies for bar chart
  const anomalies = useMemo(() => {
    return Object.entries(data.yearlyTotals).map(([y, t]) => ({
      year: Number(y), pct: Math.round(((t - median) / median) * 100),
    })).sort((a, b) => a.year - b.year);
  }, [data, median]);

  const maxAnom = Math.max(...anomalies.map(a => Math.abs(a.pct)), 1);

  // SVG helpers
  const xM = (i) => PAD + (i / 11) * (SVG_W - PAD * 2);
  const yM = (v) => PAD + (1 - v / maxM) * (SVG_H - PAD * 2);
  const bandPath = monthly.map((d, i) => `${i === 0 ? 'M' : 'L'}${xM(i)},${yM(d.p75)}`).join('') +
    [...monthly].reverse().map((d, i) => `L${xM(11 - i)},${yM(d.p25)}`).join('') + 'Z';
  const medianLine = monthly.map((d, i) => `${i === 0 ? 'M' : 'L'}${xM(i)},${yM(d.median)}`).join('');
  const currentLine = monthly.map((d, i) => `${i === 0 ? 'M' : 'L'}${xM(i)},${yM(d.current)}`).join('');

  const barW = Math.max((SVG_W - PAD * 2) / anomalies.length - 2, 3);
  const midY = SVG_H / 2;

  return (
    <section className="max-w-7xl mx-auto px-4 pb-12">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Focos detectados', value: fmt(yearTotal), sub: String(year), icon: Flame, color: 'text-orange-600' },
          { label: 'vs Mediana histórica', value: `${anomalyPct >= 0 ? '+' : ''}${anomalyPct}%`, sub: `Med: ${fmt(median)}`, icon: TrendingUp, color: anomalyPct >= 0 ? 'text-orange-600' : 'text-blue-600' },
          { label: 'Año más activo', value: String(topYear.year), sub: fmt(topYear.total), icon: BarChart3, color: 'text-orange-600' },
          { label: 'Mes más activo', value: bestMonth.label, sub: `${fmt(bestMonth.current)} focos`, icon: Calendar, color: 'text-orange-600' },
        ].map((kpi, i) => (
          <div key={i} className="light-card p-4 flex flex-col items-center text-center">
            <kpi.icon className={`w-5 h-5 ${kpi.color} mb-1`} />
            <span className={`text-2xl font-bold font-mono ${kpi.color}`}>{kpi.value}</span>
            <span className="text-[10px] text-stone-400 mt-0.5">{kpi.label}</span>
            <span className="text-[10px] text-stone-300">{kpi.sub}</span>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Chart 1: Year vs Normal */}
        <div className="light-card p-4">
          <h3 className="text-sm font-semibold text-stone-700 mb-2">Año {year} frente a lo normal</h3>
          <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} className="w-full h-auto">
            <path d={bandPath} fill="#FDE68A" opacity="0.35" />
            <path d={medianLine} fill="none" stroke="#78716C" strokeWidth="1.5" strokeDasharray="4,3" />
            <path d={currentLine} fill="none" stroke="#EA580C" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            {monthly.map((d, i) => (
              <circle key={i} cx={xM(i)} cy={yM(d.current)} r="3" fill="#EA580C" />
            ))}
            {monthly.map((d, i) => (
              <text key={`l${i}`} x={xM(i)} y={SVG_H - 4} textAnchor="middle" fontSize="8" fill="#A8A29E">{d.label}</text>
            ))}
          </svg>
          <div className="flex gap-4 mt-1 text-[9px] text-stone-400">
            <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-[#EA580C] inline-block rounded" />{year}</span>
            <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-stone-400 inline-block rounded border-dashed" />Mediana</span>
            <span className="flex items-center gap-1"><span className="w-3 h-2 bg-[#FDE68A] opacity-50 inline-block rounded" />P25–P75</span>
          </div>
        </div>

        {/* Chart 2: Anomaly bars */}
        <div className="light-card p-4">
          <h3 className="text-sm font-semibold text-stone-700 mb-2">Anomalía por año</h3>
          <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} className="w-full h-auto">
            <line x1={PAD} x2={SVG_W - PAD} y1={midY} y2={midY} stroke="#E7E5E4" strokeWidth="1" />
            {anomalies.map((a, i) => {
              const x = PAD + (i / anomalies.length) * (SVG_W - PAD * 2);
              const h = (Math.abs(a.pct) / maxAnom) * (SVG_H / 2 - PAD);
              const isUp = a.pct >= 0;
              return (
                <g key={a.year}>
                  <rect x={x} y={isUp ? midY - h : midY} width={barW} height={h}
                    fill={isUp ? '#EA580C' : '#2563EB'} rx="1.5" opacity={a.year === year ? 1 : 0.55} />
                  {a.year % 5 === 0 && (
                    <text x={x + barW / 2} y={SVG_H - 2} textAnchor="middle" fontSize="7" fill="#A8A29E">
                      {a.year}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          <div className="flex gap-4 mt-1 text-[9px] text-stone-400">
            <span className="flex items-center gap-1"><span className="w-3 h-2 bg-[#EA580C] inline-block rounded" />Sobre mediana</span>
            <span className="flex items-center gap-1"><span className="w-3 h-2 bg-[#2563EB] inline-block rounded" />Bajo mediana</span>
          </div>
        </div>
      </div>

      {/* CSV export */}
      <div className="light-card p-4 flex flex-col sm:flex-row items-center gap-3">
        <div className="flex flex-wrap gap-1">
          {LEVELS.map((l) => (
            <button key={l} onClick={() => setCsvLevel(l)}
              className={`pill-btn text-[10px] ${csvLevel === l ? 'pill-active' : 'pill-inactive'}`}>{l}</button>
          ))}
        </div>
        <button onClick={() => downloadCSV(csvLevel)}
          className="ml-auto flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white text-sm font-semibold shadow-md shadow-orange-200/50 hover:from-amber-400 hover:to-orange-400 transition-all active:scale-[0.97]">
          <Download className="w-4 h-4" /> Descargar CSV
        </button>
      </div>
    </section>
  );
}
