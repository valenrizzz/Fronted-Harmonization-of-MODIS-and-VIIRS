import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { Skeleton } from '../ui/primitives';
import { useKpiItems } from './useKpiItems';

/**
 * Métricas del mapa como menús desplegables: el chip muestra la cifra y, al
 * pasar el cursor (o tocar en pantallas táctiles), se despliega el detalle.
 */
function KpiMenu({ item, loading, empty, delay }) {
  const [open, setOpen] = useState(false);
  const timer = useRef(null);
  const ref = useRef(null);
  const show = () => { clearTimeout(timer.current); setOpen(true); };
  const hide = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(false), 120); };

  useEffect(() => {
    if (!open) return undefined;
    const out = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', out);
    return () => document.removeEventListener('pointerdown', out);
  }, [open]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const Icon = item.icon;
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="relative shrink-0"
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`glass !rounded-xl flex items-center gap-2.5 pl-3 pr-2.5 py-2 text-left transition-shadow ${open ? 'ring-2 ring-brand-300 shadow-brand' : ''}`}
      >
        <Icon className={`w-4 h-4 shrink-0 ${item.accent || 'text-orange-600'}`} />
        <span className="min-w-0">
          <span className="block eyebrow !text-[9px] leading-none">{item.label}</span>
          {empty ? <Skeleton className="h-5 w-20 mt-1" /> : (
            <span className={`block mt-0.5 whitespace-nowrap transition-opacity ${loading ? 'opacity-50' : ''}`}>{item.value('text-lg')}</span>
          )}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {open && !empty && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97, clipPath: 'inset(0 0 100% 0 round 14px)' }}
            animate={{ opacity: 1, y: 0, scale: 1, clipPath: 'inset(0 0 0% 0 round 14px)' }}
            exit={{ opacity: 0, y: -6, scale: 0.97, clipPath: 'inset(0 0 100% 0 round 14px)' }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="absolute left-0 md:left-auto md:right-0 top-full mt-2 z-40 w-[250px] glass-strong p-3 origin-top"
          >
            <div className="eyebrow mb-1">{item.label}</div>
            <div className="mb-1">{item.value('text-2xl')}</div>
            <div className={`relative min-h-[34px] ${item.id === 'total' ? 'pb-10' : ''}`}>{item.detail}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function KpiDropdowns({ fd }) {
  const items = useKpiItems(fd);
  const { data, loading } = fd.summary;
  return (
    <div className="pointer-events-auto flex flex-wrap gap-2 md:gap-2.5 md:justify-end">
      {items.map((k, i) => <KpiMenu key={k.id} item={k} loading={loading} empty={!data} delay={i * 0.05} />)}
    </div>
  );
}
