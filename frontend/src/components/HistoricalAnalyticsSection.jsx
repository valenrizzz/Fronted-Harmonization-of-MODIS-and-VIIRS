import { useMemo, useState } from 'react';
import { TrendingUp, Flame, Calendar, BarChart3, Download } from 'lucide-react';
import { MONTH_NAMES, fmtCount, fmtDate } from '../data/constants';
import { compareYear } from '../data/transform';

const LEVELS = ['Día', 'Semana', 'Mes', 'Año'];
const SVG_W = 460, SVG_H = 180, PAD = 32;
const mdLabel = (md) => { const [m, d] = md.split('-').map(Number); return `${d} ${MONTH_NAMES[m - 1]}`; };

function SummaryLine({ summary, year }) {
  if (!summary) return <p className="text-[11px] text-stone-400 text-center mb-6">Cargando resumen de {year}…</p>;
  const { yoy, layer_share: ls, reliability_share: rs, peak_day: pk, days_no_data: nd } = summary;
  const parts = [];
  if (yoy.available && yoy.change_pct != null) {
    const pct = Math.round(yoy.change_pct);
    parts.push(`${pct >= 0 ? '+' : ''}${pct}% vs. el mismo período de ${year - 1}`);
  }
  if (pk) parts.push(`pico diario: ${fmtDate(pk.date)} (${fmtCount(pk.events_harmonized)} focos)`);
  if (ls.NRT > 0) parts.push(`${Math.round(ls.NRT * 100)}% provisorio (NRT)`);
  const low = Math.round((rs.low || 0) * 100);
  if (low > 0) parts.push(`${low}% con confiabilidad baja de calibración`);
  if (nd > 0) parts.push(`${nd} días sin dato satelital`);
  return <p className="text-[11px] text-stone-500 text-center mb-6">{parts.join(' · ')}</p>;
}

export default function HistoricalAnalyticsSection({ data, year, summary, downloadCSV }) {
  const [csvLevel, setCsvLevel] = useState('Día');

  const cmp = useMemo(() => compareYear(data, year), [data, year]);
  const topYear = data.topYears[0] || { year: '-', total: 0 };

  const monthly = useMemo(() => {
    const cur = data.monthlyTotals[year] || {};
    return data.monthStats.map((s, m) => ({ m, label: MONTH_NAMES[m], current: cur[m], ...s }));
  }, [data, year]);
  const present = monthly.filter((d) => d.current != null);
  const bestMonth = present.reduce((a, b) => (b.current > a.current ? b : a), present[0]);

  const anomalies = useMemo(
    () => data.years.map((y) => ({ year: y, pct: compareYear(data, y)?.pct ?? 0 })),
    [data],
  );
  const maxAnom = Math.max(...anomalies.map((a) => Math.abs(a.pct)), 1);
  const maxM = Math.max(...monthly.map((d) => Math.max(d.current || 0, d.p75, d.median)), 1);

  const xM = (i) => PAD + (i / 11) * (SVG_W - PAD * 2);
  const yM = (v) => PAD + (1 - v / maxM) * (SVG_H - PAD * 2);
  const bandPath = monthly.map((d, i) => `${i ? 'L' : 'M'}${xM(i)},${yM(d.p75)}`).join('')
    + [...monthly].reverse().map((d, i) => `L${xM(11 - i)},${yM(d.p25)}`).join('') + 'Z';
  const medianLine = monthly.map((d, i) => `${i ? 'L' : 'M'}${xM(i)},${yM(d.median)}`).join('');
  const currentLine = present.map((d, i) => `${i ? 'L' : 'M'}${xM(d.m)},${yM(d.current)}`).join('');
  const barW = Math.max((SVG_W - PAD * 2) / anomalies.length - 2, 3);
  const midY = SVG_H / 2;

  const total = summary?.total_harmonized;
  const kpis = [
    { label: `Focos armonizados ${year}`, value: fmtCount(total?.value ?? data.yearlyTotals[year]),
      sub: total && total.ci_high - total.ci_low >= 1 ? `IC 95%: ${fmtCount(total.ci_low)}–${fmtCount(total.ci_high)}` : 'calibración exacta', icon: Flame },
    { label: cmp?.partial ? `vs mediana (${mdLabel(cmp.window[0])}–${mdLabel(cmp.window[1])})` : 'vs mediana histórica',
      value: cmp?.pct == null ? '–' : `${cmp.pct >= 0 ? '+' : ''}${cmp.pct}%`, sub: `Mediana: ${fmtCount(cmp?.median)}`,
      icon: TrendingUp, color: cmp?.pct < 0 ? 'text-blue-600' : 'text-orange-600' },
    { label: 'Año más activo (completo)', value: String(topYear.year), sub: `${fmtCount(topYear.total)} focos`, icon: BarChart3 },
    { label: `Mes más activo de ${year}`, value: bestMonth?.label ?? '–', sub: `${fmtCount(bestMonth?.current)} focos`, icon: Calendar },
  ];

  return (
    <section className="w-full max-w-7xl mx-auto px-4 pb-12">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-2">
        {kpis.map((k) => (
          <div key={k.label} className="light-card p-4 flex flex-col items-center text-center">
            <k.icon className={`w-5 h-5 ${k.color || 'text-orange-600'} mb-1`} />
            <span className={`text-2xl font-bold font-mono ${k.color || 'text-orange-600'}`}>{k.value}</span>
            <span className="text-[10px] text-stone-500 mt-0.5">{k.label}</span>
            <span className="text-[10px] text-stone-400">{k.sub}</span>
          </div>
        ))}
      </div>
      <SummaryLine summary={summary} year={year} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="light-card p-4">
          <h3 className="text-sm font-semibold text-stone-700 mb-2">Año {year} frente a lo normal (focos por mes)</h3>
          <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} className="w-full h-auto" role="img" aria-label={`Focos mensuales de ${year} frente a la mediana histórica`}>
            <path d={bandPath} fill="#FDE68A" opacity="0.35" />
            <path d={medianLine} fill="none" stroke="#78716C" strokeWidth="1.5" strokeDasharray="4,3" />
            <path d={currentLine} fill="none" stroke="#EA580C" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            {present.map((d) => (
              <circle key={d.m} cx={xM(d.m)} cy={yM(d.current)} r="3" fill="#EA580C">
                <title>{`${d.label} ${year}: ${fmtCount(d.current)} focos (mediana ${fmtCount(d.median)})`}</title>
              </circle>
            ))}
            {monthly.map((d, i) => (
              <text key={`l${i}`} x={xM(i)} y={SVG_H - 4} textAnchor="middle" fontSize="8" fill="#A8A29E">{d.label}</text>
            ))}
          </svg>
          <div className="flex gap-4 mt-1 text-[9px] text-stone-400">
            <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-[#EA580C] inline-block rounded" />{year}</span>
            <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-stone-400 inline-block rounded" />Mediana</span>
            <span className="flex items-center gap-1"><span className="w-3 h-2 bg-[#FDE68A] opacity-50 inline-block rounded" />P25–P75 (meses completos)</span>
          </div>
        </div>

        <div className="light-card p-4">
          <h3 className="text-sm font-semibold text-stone-700 mb-2">Anomalía por año vs. mediana</h3>
          <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} className="w-full h-auto" role="img" aria-label="Anomalía anual de focos respecto de la mediana">
            <line x1={PAD} x2={SVG_W - PAD} y1={midY} y2={midY} stroke="#E7E5E4" strokeWidth="1" />
            {anomalies.map((a, i) => {
              const x = PAD + (i / anomalies.length) * (SVG_W - PAD * 2);
              const h = (Math.abs(a.pct) / maxAnom) * (SVG_H / 2 - PAD);
              const up = a.pct >= 0;
              return (
                <g key={a.year}>
                  <rect x={x} y={up ? midY - h : midY} width={barW} height={Math.max(h, 0.5)}
                    fill={up ? '#EA580C' : '#2563EB'} rx="1.5" opacity={a.year === year ? 1 : 0.5}>
                    <title>{`${a.year}: ${a.pct >= 0 ? '+' : ''}${a.pct}%`}</title>
                  </rect>
                  {a.year % 5 === 0 && (
                    <text x={x + barW / 2} y={SVG_H - 2} textAnchor="middle" fontSize="7" fill="#A8A29E">{a.year}</text>
                  )}
                </g>
              );
            })}
          </svg>
          <div className="flex gap-4 mt-1 text-[9px] text-stone-400">
            <span className="flex items-center gap-1"><span className="w-3 h-2 bg-[#EA580C] inline-block rounded" />Sobre la mediana</span>
            <span className="flex items-center gap-1"><span className="w-3 h-2 bg-[#2563EB] inline-block rounded" />Bajo la mediana</span>
            <span>Años parciales: comparados en la misma ventana de fechas</span>
          </div>
        </div>
      </div>

      <div className="light-card p-4 flex flex-col sm:flex-row items-center gap-3">
        <div>
          <div className="text-sm font-semibold text-stone-700">Descargar serie armonizada</div>
          <div className="text-[10px] text-stone-400">Usa el rango de fechas de la barra superior · incluye IC 95%, capa SP/NRT y confiabilidad</div>
        </div>
        <div className="flex flex-wrap gap-1 sm:ml-auto">
          {LEVELS.map((l) => (
            <button key={l} onClick={() => setCsvLevel(l)}
              className={`pill-btn text-[10px] ${csvLevel === l ? 'pill-active' : 'pill-inactive'}`}>{l}</button>
          ))}
        </div>
        <button onClick={() => downloadCSV(csvLevel)}
          className="flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white text-sm font-semibold shadow-md shadow-orange-200/50 hover:from-amber-400 hover:to-orange-400 transition-all active:scale-[0.97]">
          <Download className="w-4 h-4" /> Descargar CSV
        </button>
      </div>
    </section>
  );
}
