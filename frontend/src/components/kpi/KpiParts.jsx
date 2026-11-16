import { motion } from 'framer-motion';
import { Skeleton } from '../ui/primitives';

const share = (v) => `${Math.round((v || 0) * 100)}%`;

export function Card({ icon: Icon, label, accent = 'text-orange-600', children, loading, empty, delay = 0 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="card relative overflow-hidden px-4 py-3.5"
    >
      <div className="flex items-center gap-1.5 eyebrow">
        <Icon className={`w-3.5 h-3.5 ${accent}`} />
        {label}
      </div>
      {empty ? (
        <div className="mt-2 space-y-1.5">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-3 w-36" />
        </div>
      ) : (
        <div className={`transition-opacity duration-300 ${loading ? 'opacity-50' : ''}`}>{children}</div>
      )}
      {loading && !empty && (
        <div className="absolute inset-x-0 bottom-0 h-px overflow-hidden">
          <div className="h-full w-1/3 bg-gradient-to-r from-transparent via-brand-400 to-transparent animate-progress" />
        </div>
      )}
    </motion.div>
  );
}

export function Sparkline({ values }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${28 - (v / max) * 26}`);
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="absolute right-3 bottom-3 w-24 h-8 opacity-80" aria-hidden="true">
      <defs>
        <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F97316" stopOpacity="0.45" />
          <stop offset="1" stopColor="#F97316" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,30 ${pts.join(' ')} 100,30`} fill="url(#spark)" />
      <polyline points={pts.join(' ')} fill="none" stroke="#F97316" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function QualityBar({ rs, nrt }) {
  const parts = [
    { k: 'high', c: 'bg-emerald-500', v: rs.high },
    { k: 'medium', c: 'bg-sky-500', v: rs.medium },
    { k: 'low', c: 'bg-violet-500', v: rs.low },
  ];
  return (
    <div className="mt-2">
      <div className="flex h-1.5 rounded-full overflow-hidden bg-slate-100">
        {parts.map((p) => <div key={p.k} className={`${p.c} transition-all duration-700`} style={{ width: share(p.v) }} />)}
      </div>
      <div className="flex gap-2.5 mt-1.5 text-[10px] text-slate-500">
        <span><i className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1" />alta {share(rs.high)}</span>
        <span><i className="inline-block w-1.5 h-1.5 rounded-full bg-violet-500 mr-1" />baja {share(rs.low)}</span>
        {nrt > 0 && <span className="text-orange-600">NRT {share(nrt)}</span>}
      </div>
    </div>
  );
}
