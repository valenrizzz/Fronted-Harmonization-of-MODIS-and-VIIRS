import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Pin } from 'lucide-react';
import { Skeleton } from '../ui/primitives';
import { useKpiItems } from './useKpiItems';

/**
 * Métricas del mapa como menús desplegables: al pasar el cursor se ve el
 * detalle; con un clic queda FIJADO abierto (aunque cambien país o años)
 * hasta volver a hacer clic.
 */
function KpiMenu({ item, loading, empty, delay }) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const timer = useRef(null);
  const show = () => { clearTimeout(timer.current); setHover(true); };
  const hide = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setHover(false), 120); };
  useEffect(() => () => clearTimeout(timer.current), []);
  const open = pinned || hover;

  const Icon = item.icon;
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="relative shrink-0"
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      <button
        onClick={() => setPinned((v) => !v)}
        aria-expanded={open}
        aria-pressed={pinned}
        title={pinned ? 'Clic para soltar' : 'Clic para dejarlo abierto'}
        className={`glass !rounded-xl w-full flex items-center gap-2.5 pl-3 pr-2.5 py-2 text-left transition-shadow ${
          pinned ? 'ring-2 ring-beam/80 shadow-night' : open ? 'ring-2 ring-white/25' : ''}`}
      >
        <Icon className={`w-4 h-4 shrink-0 ${item.accent || 'text-orange-400'}`} />
        <span className="min-w-0">
          <span className="block eyebrow !text-[9px] leading-none">{item.label}</span>
          {empty ? <Skeleton className="h-5 w-20 mt-1" /> : (
            <span className={`block mt-0.5 whitespace-nowrap transition-opacity ${loading ? 'opacity-50' : ''}`}>{item.value('text-lg')}</span>
          )}
        </span>
        {pinned
          ? <Pin className="w-3.5 h-3.5 text-beam fill-beam ml-auto" />
          : <ChevronDown className={`w-3.5 h-3.5 text-slate-500 ml-auto transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />}
      </button>

      <AnimatePresence>
        {open && !empty && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97, clipPath: 'inset(0 0 100% 0 round 14px)' }}
            animate={{ opacity: 1, y: 0, scale: 1, clipPath: 'inset(0 0 0% 0 round 14px)' }}
            exit={{ opacity: 0, y: -6, scale: 0.97, clipPath: 'inset(0 0 100% 0 round 14px)' }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-x-0 top-full mt-2 z-40 min-w-[200px] glass-strong p-3 origin-top"
          >
            <div className="eyebrow mb-1 flex items-center justify-between">
              {item.label}
              {pinned && <span className="normal-case tracking-normal font-medium text-beam">Fijado</span>}
            </div>
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
