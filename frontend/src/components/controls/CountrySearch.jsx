import { useState } from 'react';
import { motion } from 'framer-motion';
import { Search, Check, X } from 'lucide-react';
import { COUNTRY_ORDER, regionName } from '../../data/constants';

const FLAGS = { ARG: '🇦🇷', BOL: '🇧🇴', CHL: '🇨🇱', PRY: '🇵🇾', URY: '🇺🇾' };
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Búsqueda + lista de países. Elegir uno solo mueve el mapa: el panel sigue
 * abierto para que el usuario ajuste enseguida el rango de años.
 */
export default function CountrySearch({ regions, region, setRegion, autoFocus = false }) {
  const [q, setQ] = useState('');
  const order = (c) => (COUNTRY_ORDER.indexOf(c) + 1 || 99);
  const list = [...regions]
    .sort((a, b) => order(a.region) - order(b.region))
    .filter((r) => norm(`${regionName(r.region)} ${r.region}`).includes(norm(q)));

  const pick = (code) => { setRegion(code); setQ(''); };

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="relative shrink-0">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && list[0]) pick(list[0].region); if (e.key === 'Escape') setQ(''); }}
          placeholder="Buscar país…"
          autoFocus={autoFocus}
          aria-label="Buscar país"
          className="w-full pl-8 pr-8 h-9 bg-white/5 border border-white/10 rounded-xl text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-beam/60 focus:ring-2 focus:ring-beam/20 transition"
        />
        {q && (
          <button onClick={() => setQ('')} aria-label="Limpiar búsqueda" className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="mt-1.5 space-y-0.5 min-h-0 overflow-y-auto -mx-1 px-1" role="listbox" aria-label="Países">
        {list.map((r) => {
          const active = r.region === region;
          return (
            <button
              key={r.region}
              role="option"
              aria-selected={active}
              onClick={() => pick(r.region)}
              className={`relative w-full flex items-center gap-2 px-2.5 py-1 rounded-lg text-left text-[13px] transition-colors ${
                active ? 'text-white font-semibold' : 'text-slate-300 hover:bg-white/5 hover:text-white'
              }`}
            >
              {active && (
                <motion.span layoutId="country-row" className="absolute inset-0 rounded-lg bg-night-900/70 ring-1 ring-beam/50 shadow-night"
                  transition={{ type: 'spring', stiffness: 420, damping: 36 }} />
              )}
              <span className="relative text-base leading-none">{FLAGS[r.region] || '🏳️'}</span>
              <span className="relative">{regionName(r.region)}</span>
              <span className={`relative ml-auto text-[10px] font-mono ${active ? 'text-slate-600' : 'text-slate-500'}`}>
                {r.period.start.slice(0, 4)}–{r.period.end.slice(0, 4)}
              </span>
              <Check className={`relative w-3.5 h-3.5 text-beam transition-opacity ${active ? 'opacity-100' : 'opacity-0'}`} />
            </button>
          );
        })}
        {!regions.length && [0, 1, 2].map((i) => <div key={i} className="skeleton h-8" />)}
        {regions.length > 0 && !list.length && <p className="text-xs text-slate-500 px-2 py-1.5">Sin coincidencias para “{q}”.</p>}
      </div>
    </div>
  );
}
