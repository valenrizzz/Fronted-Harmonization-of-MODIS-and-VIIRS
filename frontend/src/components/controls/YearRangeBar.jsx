import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { fireColor, fmtCount } from '../../data/constants';

/**
 * Barra de rango de años: histograma de actividad anual + slider doble.
 * Al soltar el slider se aplica la ventana; clic en una barra = ese año.
 */
export default function YearRangeBar({ period, range, yearly, setYearWindow, setCustomWindow }) {
  const minY = Number(period.start.slice(0, 4));
  const maxY = Number(period.end.slice(0, 4));
  const [sel, setSel] = useState([Number(range.start.slice(0, 4)), Number(range.end.slice(0, 4))]);
  const timer = useRef(null);

  useEffect(() => {
    setSel([Number(range.start.slice(0, 4)), Number(range.end.slice(0, 4))]);
  }, [range.start, range.end]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const apply = ([a, b]) => {
    clearTimeout(timer.current);
    timer.current = null;
    if (a === b) setYearWindow(a);
    else setCustomWindow(`${a}-01-01`, `${b}-12-31`);
  };
  const commit = (next) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => apply(next), 220);
  };
  // Al soltar el control se aplica de inmediato: el CSV y las vistas nunca usan un rango viejo
  const flush = () => { if (timer.current) apply(sel); };
  const move = (i, v) => {
    const next = [...sel];
    next[i] = v;
    if (next[0] > next[1]) next[i === 0 ? 1 : 0] = v;
    setSel(next);
    commit(next);
  };

  const years = Array.from({ length: maxY - minY + 1 }, (_, i) => minY + i);
  const maxT = Math.max(...years.map((y) => yearly?.[y] || 0), 1);
  const pct = (y) => ((y - minY) / Math.max(maxY - minY, 1)) * 100;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <span className="font-display text-xl font-semibold text-white tabular-nums">
          {sel[0]}<span className="text-slate-600 mx-1">–</span>{sel[1]}
        </span>
        <span className="text-[11px] text-slate-500">{sel[1] - sel[0] + 1} año{sel[1] > sel[0] ? 's' : ''}</span>
      </div>

      {/* Histograma de actividad anual (región completa) */}
      <div className="flex items-end gap-[2px] h-12" aria-hidden={!yearly}>
        {years.map((y) => {
          const v = yearly?.[y] || 0;
          const inside = y >= sel[0] && y <= sel[1];
          return (
            <button
              key={y}
              onClick={() => setYearWindow(y)}
              title={`${y}: ${fmtCount(v)} focos armonizados`}
              className="flex-1 h-full flex items-end group"
            >
              <motion.span
                className={`w-full rounded-t-[2px] ${yearly ? '' : 'skeleton !rounded-t-[2px]'}`}
                initial={false}
                animate={{ height: `${yearly ? Math.max((v / maxT) * 100, 4) : 30 + ((y * 37) % 50)}%` }}
                transition={{ type: 'spring', stiffness: 200, damping: 26 }}
                style={{ background: yearly ? (inside ? fireColor(0.25 + 0.75 * (v / maxT), 1) : 'rgba(255,255,255,0.12)') : undefined }}
              />
            </button>
          );
        })}
      </div>

      {/* Slider doble */}
      <div className="relative h-5 mt-1">
        <div className="absolute top-1/2 -translate-y-1/2 inset-x-0 h-1.5 rounded-full bg-white/10" />
        <motion.div
          className="absolute top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-gradient-to-r from-brand-400 to-beam"
          animate={{ left: `${pct(sel[0])}%`, right: `${100 - pct(sel[1])}%` }}
          transition={{ type: 'spring', stiffness: 400, damping: 40 }}
        />
        {[0, 1].map((i) => (
          <input
            key={i}
            type="range"
            min={minY}
            max={maxY}
            step={1}
            value={sel[i]}
            aria-label={i === 0 ? 'Año inicial' : 'Año final'}
            onChange={(e) => move(i, Number(e.target.value))}
            onPointerUp={flush}
            onKeyUp={flush}
            onBlur={flush}
            className="range-thumb top-0"
            style={{ zIndex: i === 0 && sel[0] === maxY ? 3 : 2 }}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] font-mono text-slate-500 mt-0.5">
        <span>{minY}</span><span>{maxY}</span>
      </div>

    </div>
  );
}
