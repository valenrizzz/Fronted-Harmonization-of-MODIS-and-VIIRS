import { useMemo } from 'react';
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar, Cell, ReferenceLine,
} from 'recharts';
import { Trophy } from 'lucide-react';
import { MONTH_NAMES, fmtCount } from '../../data/constants';
import { compareYear } from '../../data/transform';
import { Skeleton } from '../ui/primitives';
import { inRange } from '../../data/presets';

const AXIS = { fill: '#94a3b8', fontSize: 10, fontFamily: 'JetBrains Mono' };

function Box({ title, sub, children, className = '' }) {
  return (
    <div className={`rounded-xl bg-white/5 ring-1 ring-white/10 p-3 flex flex-col min-h-0 ${className}`}>
      <div className="text-xs font-semibold text-slate-200">{title}</div>
      {sub && <div className="text-[10px] text-slate-400 mb-1">{sub}</div>}
      <div className="flex-1 min-h-[140px]">{children}</div>
    </div>
  );
}

function Tip({ active, payload, label, render }) {
  if (!active || !payload?.length) return null;
  return <div className="glass-strong px-2.5 py-1.5 text-[11px] text-slate-300">{render(payload[0].payload, label)}</div>;
}

export default function ComparisonTab({ fd, year, onYear }) {
  const data = fd.daily.data;

  const monthly = useMemo(() => {
    if (!data) return [];
    const cur = data.monthlyTotals[year] || {};
    return data.monthStats.map((s, m) => ({ label: MONTH_NAMES[m], current: cur[m] ?? null, band: [s.p25, s.p75], median: s.median }));
  }, [data, year]);

  const years = useMemo(() => (data ? data.years.filter((y) => inRange(y, fd.range)) : []), [data, fd.range]);
  const anomalies = useMemo(
    () => years.map((y) => ({ year: y, pct: compareYear(data, y)?.pct ?? 0 })),
    [data, years],
  );
  const top = useMemo(
    () => years.map((y) => ({ year: y, total: data.yearlyTotals[y], partial: !data.completeYears.includes(y) }))
      .sort((a, b) => b.total - a.total).slice(0, 5),
    [data, years],
  );

  if (!data) {
    return <div className="grid md:grid-cols-3 gap-3 h-full">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-full min-h-40 !rounded-xl" />)}</div>;
  }
  const cmp = compareYear(data, year);
  const maxTop = top[0]?.total || 1;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1.2fr_0.8fr] gap-3 h-full overflow-y-auto lg:overflow-hidden">
      <Box
        title={`${year} frente a lo normal`}
        sub={cmp?.pct != null ? `${cmp.pct >= 0 ? '+' : ''}${cmp.pct}% vs. mediana${cmp.partial ? ' (misma ventana de fechas)' : ''} · banda P25–P75 de meses completos` : 'Banda P25–P75 de meses completos'}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={monthly} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.07)" vertical={false} />
            <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} interval={1} />
            <YAxis width={42} tick={AXIS} tickFormatter={fmtCount} axisLine={false} tickLine={false} tickCount={4} />
            <Area dataKey="band" fill="#8B89E0" fillOpacity={0.22} stroke="none" isAnimationActive={false} />
            <Line dataKey="median" stroke="#B9B8EF" strokeDasharray="4 3" strokeWidth={1.3} dot={false} isAnimationActive={false} />
            <Line dataKey="current" stroke="#F97316" strokeWidth={2.2} dot={{ r: 2.5, fill: '#F97316', strokeWidth: 0 }} connectNulls={false} animationDuration={700} />
            <Tooltip cursor={{ stroke: 'rgba(255,255,255,0.2)' }} content={<Tip render={(r) => (
              <><b className="text-white">{r.label} {year}</b>: {fmtCount(r.current)} focos<br /><span className="text-slate-400">mediana {fmtCount(r.median)}</span></>
            )} />} />
          </ComposedChart>
        </ResponsiveContainer>
      </Box>

      <Box title="Anomalía anual vs. mediana" sub="Clic en una barra para analizar ese año · años parciales en la misma ventana">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={anomalies} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.07)" vertical={false} />
            <XAxis dataKey="year" tick={AXIS} axisLine={false} tickLine={false} interval={years.length > 12 ? 4 : 0} />
            <YAxis width={42} tick={AXIS} tickFormatter={(v) => `${v}%`} axisLine={false} tickLine={false} tickCount={4}
              domain={[(min) => Math.min(min, 0), (max) => Math.max(max, 0)]} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
            <Bar dataKey="pct" maxBarSize={36} radius={[2, 2, 2, 2]} onClick={(d) => onYear(d.year)} cursor="pointer" animationDuration={700}>
              {anomalies.map((a) => (
                <Cell key={a.year} fill={a.pct >= 0 ? '#EF4444' : '#1FACC7'} fillOpacity={a.year === year ? 1 : 0.45}
                  stroke={a.year === year ? '#ffffff' : 'none'} />
              ))}
            </Bar>
            <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} content={<Tip render={(r) => (
              <><b className="text-white">{r.year}</b>: {r.pct >= 0 ? '+' : ''}{r.pct}% vs. mediana</>
            )} />} />
          </BarChart>
        </ResponsiveContainer>
      </Box>

      <Box title="Años más activos" sub="Dentro del rango elegido · * año parcial">
        <div className="space-y-2 mt-1">
          {top.map((t, i) => (
            <button key={t.year} onClick={() => onYear(t.year)} className="w-full flex items-center gap-2 group">
              <span className={`w-5 text-[10px] font-mono ${i === 0 ? 'text-orange-400' : 'text-slate-400'}`}>
                {i === 0 ? <Trophy className="w-3.5 h-3.5" /> : `${i + 1}°`}
              </span>
              <span className={`text-xs font-mono w-9 ${t.year === year ? 'text-white' : 'text-slate-300'}`}>{t.year}{t.partial ? '*' : ''}</span>
              <span className="flex-1 h-4 rounded-full bg-white/10 overflow-hidden">
                <span className="block h-full rounded-full bg-gradient-to-r from-fire-300 to-fire-600 group-hover:brightness-125 transition"
                  style={{ width: `${(t.total / maxTop) * 100}%`, opacity: 1 - i * 0.13 }} />
              </span>
              <span className="text-[10px] font-mono text-slate-400 w-14 text-right">{fmtCount(t.total)}</span>
            </button>
          ))}
        </div>
      </Box>
    </div>
  );
}
