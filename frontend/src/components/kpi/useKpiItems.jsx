import { useMemo } from 'react';
import { Flame, TrendingUp, TrendingDown, Zap, ShieldCheck } from 'lucide-react';
import { fmtCount, fmtDate, fmtMonth, fmtInt } from '../../data/constants';
import { AnimatedNumber } from '../ui/primitives';
import { Sparkline, QualityBar } from './KpiParts';

const pct = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
const big = 'font-display leading-tight font-semibold';

/**
 * Las 4 métricas clave como datos: `value` (cifra principal) y `detail`
 * (contexto). KpiStrip las muestra como tarjetas; KpiDropdowns, como menús.
 */
export function useKpiItems(fd) {
  const s = fd.summary.data;
  const spark = useMemo(() => {
    const pts = fd.monthly.data?.points || [];
    const from = fd.range?.start.slice(0, 7);
    const to = fd.range?.end.slice(0, 7);
    return pts.filter((p) => p.date.slice(0, 7) >= from && p.date.slice(0, 7) <= to)
      .map((p) => p.events_harmonized_gapfilled ?? p.events_harmonized ?? 0);
  }, [fd.monthly.data, fd.range]);

  const yoy = s?.yoy;
  const up = yoy?.change_pct > 0;
  const ci = s?.total_harmonized;
  const hasYoy = yoy?.available && yoy.change_pct != null;

  return [
    {
      id: 'total', icon: Flame, label: 'Focos armonizados',
      value: (cls) => <span className={`${big} ${cls} text-brand-950`}><AnimatedNumber value={ci?.value} format={fmtCount} /></span>,
      detail: (
        <>
          <div className="text-[10px] text-slate-500 font-mono">
            {ci && ci.ci_high - ci.ci_low >= 1 ? `IC 95% ${fmtCount(ci.ci_low)}–${fmtCount(ci.ci_high)}` : 'IC 95% exacto · calibración directa'}
          </div>
          {s?.total_nasa_detections != null && (
            <div className="text-[10px] text-slate-500">NASA FIRMS original: <span className="font-mono">{fmtCount(s.total_nasa_detections)}</span></div>
          )}
          <Sparkline values={spark} />
        </>
      ),
    },
    {
      id: 'yoy', icon: up ? TrendingUp : TrendingDown, label: 'Variación interanual', accent: up ? 'text-red-600' : 'text-brand-500',
      value: (cls) => (hasYoy
        ? <span className={`${big} ${cls} ${up ? 'text-red-600' : 'text-brand-500'}`}><AnimatedNumber value={yoy.change_pct} format={pct} /></span>
        : <span className={`${big} ${cls} text-slate-400`}>n/d</span>),
      detail: hasYoy
        ? <div className="text-[10px] text-slate-500">vs. {fmtDate(yoy.previous_start)} – {fmtDate(yoy.previous_end)} ({fmtCount(yoy.previous_value)} focos)</div>
        : <div className="text-[10px] text-slate-500">{yoy?.reason || 'Sin período comparable'}</div>,
    },
    {
      id: 'peak', icon: Zap, label: 'Pico diario',
      value: (cls) => (
        <span className={`${big} ${cls} text-brand-950`}>
          <AnimatedNumber value={s?.peak_day?.events_harmonized} format={fmtCount} />
          <span className="text-xs text-slate-500 font-sans font-normal ml-1">focos</span>
        </span>
      ),
      detail: (
        <div className="text-[10px] text-slate-500">
          {s?.peak_day ? fmtDate(s.peak_day.date) : '–'}
          {s?.peak_month && <> · mes pico {fmtMonth(s.peak_month.date)}</>}
        </div>
      ),
    },
    {
      id: 'quality', icon: ShieldCheck, label: 'Calidad del dato', accent: 'text-emerald-600',
      value: (cls) => (
        <span className={`${big} ${cls} text-brand-950`}>
          <AnimatedNumber value={(s?.reliability_share?.high || 0) * 100} format={(v) => `${Math.round(v)}%`} />
          <span className="text-[10px] text-slate-500 font-sans font-normal ml-1.5">alta confiabilidad</span>
        </span>
      ),
      detail: (
        <>
          {s && <QualityBar rs={s.reliability_share} nrt={s.layer_share?.NRT} />}
          {s?.days_no_data > 0 && <div className="text-[10px] text-slate-400 mt-0.5">{fmtInt(s.days_no_data)} días sin dato satelital</div>}
        </>
      ),
    },
  ];
}
