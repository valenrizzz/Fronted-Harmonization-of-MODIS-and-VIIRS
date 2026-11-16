import { useEffect, useRef } from 'react';
import { animate } from 'framer-motion';
import { TIER_LABEL, TIER_STYLE } from '../../data/constants';

export function Skeleton({ className = '' }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

/** Número que interpola suavemente entre valores (respeta reduced-motion vía CSS/OS). */
export function AnimatedNumber({ value, format, className = '' }) {
  const ref = useRef(null);
  const prev = useRef(value ?? 0);

  useEffect(() => {
    if (value == null || !ref.current) return undefined;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      ref.current.textContent = format(value);
      prev.current = value;
      return undefined;
    }
    const ctl = animate(prev.current, value, {
      duration: 0.9,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => { if (ref.current) ref.current.textContent = format(v); },
    });
    prev.current = value;
    return () => ctl.stop();
  }, [value, format]);

  return <span ref={ref} className={className}>{value == null ? '–' : format(prev.current)}</span>;
}

export function TierChip({ tier, prefix = 'Confiabilidad' }) {
  if (!tier) return null;
  return (
    <span className={`chip ${TIER_STYLE[tier] || ''}`}>
      {prefix} {TIER_LABEL[tier] || tier}
    </span>
  );
}

export function NrtChip({ label = 'Provisorio · NRT' }) {
  return (
    <span className="chip bg-orange-400/10 text-orange-300 ring-orange-400/30">
      <span className="relative flex w-1.5 h-1.5">
        <span className="absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75 animate-ping" />
        <span className="relative inline-flex rounded-full w-1.5 h-1.5 bg-orange-500" />
      </span>
      {label}
    </span>
  );
}

/** Barra de progreso indeterminada muy fina (consultas en curso). */
export function ProgressLine({ active }) {
  return (
    <div className={`absolute inset-x-0 top-0 h-[2px] overflow-hidden z-50 transition-opacity duration-300 ${active ? 'opacity-100' : 'opacity-0'}`}>
      <div className="h-full w-1/3 bg-gradient-to-r from-transparent via-brand-500 to-transparent animate-progress" />
    </div>
  );
}
