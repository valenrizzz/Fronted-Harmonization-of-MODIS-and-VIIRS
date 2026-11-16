import { useMemo, useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceArea,
} from 'recharts';
import { fmtCount } from '../../data/constants';
import { ChartTooltip, yearTicks, tickLabel, isShort } from './SeriesTooltip';
import { endOfMonth, isoOf } from './seriesRows';

/**
 * Serie mensual completa con IC 95 %, tramos de baja confiabilidad y NRT.
 * Clic = ver ese año en todo el tablero · arrastre = ventana personalizada.
 */
export default function SeriesChart({ rows, lowSpans, nrtSpans, onPickYear, onPickRange }) {
  const [sel, setSel] = useState(null);
  const ticks = useMemo(() => yearTicks(rows), [rows]);

  const interactive = Boolean(onPickYear && onPickRange);
  const finish = () => {
    if (!sel || !interactive) return;
    const { a, b } = sel;
    setSel(null);
    if (a == null) return;
    if (b == null || a === b) {
      onPickYear(new Date(a).getUTCFullYear());
      return;
    }
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    onPickRange(isoOf(lo), endOfMonth(isoOf(hi)));
  };

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart
        data={rows}
        margin={{ top: 18, right: 12, bottom: 0, left: 0 }}
        onMouseDown={(e) => interactive && e?.activeLabel != null && setSel({ a: e.activeLabel, b: null })}
        onMouseMove={(e) => sel && e?.activeLabel != null && setSel((s) => ({ ...s, b: e.activeLabel }))}
        onMouseUp={finish}
        onMouseLeave={() => setSel(null)}
        style={{ cursor: interactive ? 'crosshair' : 'default', userSelect: 'none' }}
      >
        <defs>
          <linearGradient id="g-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#F97316" stopOpacity={0.22} />
            <stop offset="1" stopColor="#F97316" stopOpacity={0} />
          </linearGradient>
          <pattern id="hatch-low" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="7" height="7" fill="rgba(139,92,246,0.04)" />
            <line x1="0" y1="0" x2="0" y2="7" stroke="rgba(139,92,246,0.28)" strokeWidth="1.4" />
          </pattern>
          <pattern id="hatch-nrt" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
            <rect width="7" height="7" fill="rgba(220,38,38,0.04)" />
            <line x1="0" y1="0" x2="0" y2="7" stroke="rgba(220,38,38,0.3)" strokeWidth="1.4" />
          </pattern>
          <filter id="glow" x="-10%" y="-50%" width="120%" height="200%">
            <feGaussianBlur stdDeviation="2.4" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        <CartesianGrid stroke="rgba(15,23,42,0.06)" vertical={false} />
        <XAxis
          dataKey="ts" type="number" scale="time" domain={['dataMin', 'dataMax']} ticks={ticks}
          tickFormatter={tickLabel(isShort(rows))}
          tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'JetBrains Mono' }}
          axisLine={{ stroke: '#e2e8f0' }} tickLine={false}
        />
        <YAxis
          width={46} tickFormatter={fmtCount} tickCount={4}
          tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'JetBrains Mono' }}
          axisLine={false} tickLine={false}
        />

        {lowSpans.map((s) => (
          <ReferenceArea key={`low-${s.x1}`} x1={s.x1} x2={s.x2} fill="url(#hatch-low)" ifOverflow="hidden"
            label={s.label ? { value: s.label, position: 'insideTopLeft', fill: '#7c3aed', fontSize: 9, offset: -12 } : undefined} />
        ))}
        {nrtSpans.map((s) => (
          <ReferenceArea key={`nrt-${s.x1}`} x1={s.x1} x2={s.x2} fill="url(#hatch-nrt)" ifOverflow="hidden"
            label={{ value: 'NRT', position: 'insideTop', fill: '#dc2626', fontSize: 9, offset: -12 }} />
        ))}

        <Area dataKey="v" type="monotone" stroke="none" fill="url(#g-area)" isAnimationActive={false} activeDot={false} />
        <Area dataKey="band" type="monotone" stroke="none" fill="#FB923C" fillOpacity={0.22} isAnimationActive={false} activeDot={false} />
        <Line dataKey="sp" type="monotone" stroke="#F97316" strokeWidth={2} dot={false}
          activeDot={{ r: 4, fill: '#fff', stroke: '#F97316', strokeWidth: 2 }} isAnimationActive animationDuration={900} connectNulls={false} />
        <Line dataKey="raw" type="monotone" stroke="#8B5CF6" strokeWidth={1.6} dot={{ r: 1.6, fill: '#8B5CF6', strokeWidth: 0 }}
          activeDot={{ r: 4, fill: '#fff', stroke: '#8B5CF6', strokeWidth: 2 }} isAnimationActive={false} connectNulls={false} />
        <Line dataKey="nrt" type="monotone" stroke="#DC2626" strokeWidth={2} strokeDasharray="5 4" dot={false}
          activeDot={{ r: 4, fill: '#fff', stroke: '#DC2626', strokeWidth: 2 }} isAnimationActive={false} />

        <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'rgba(15,23,42,0.25)', strokeDasharray: '2 3' }} isAnimationActive={false} />

        {sel?.a != null && sel?.b != null && (
          <ReferenceArea x1={Math.min(sel.a, sel.b)} x2={Math.max(sel.a, sel.b)} fill="rgba(249,115,22,0.14)" stroke="#F97316" />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
