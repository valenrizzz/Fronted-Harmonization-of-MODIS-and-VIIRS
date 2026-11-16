import { Loader2, AlertTriangle } from 'lucide-react';
import { FIRE_GRADIENT_CSS, fmtCount, fmtInt } from '../../data/constants';

export default function MapLegend({ hex, style }) {
  const m = hex.meta;
  return (
    <div className="absolute left-3 z-20 glass px-3 py-2 md:py-2.5 w-[200px] md:w-[236px] transition-[left,bottom] duration-500 ease-out" style={style}>
      <div className="flex items-center justify-between">
        <span className="eyebrow">Intensidad armonizada</span>
        {hex.loading && <Loader2 className="w-3 h-3 animate-spin text-beam" />}
      </div>
      <div className="h-2 rounded-full mt-2" style={{ background: FIRE_GRADIENT_CSS }} />
      <div className="flex justify-between text-[10px] text-slate-400 mt-1 font-mono">
        <span>baja</span>
        <span>{m ? `≥ ${fmtCount(m.ref)} focos/celda` : 'alta'}</span>
      </div>
      {m && (
        <div className="hidden md:block text-[10px] text-slate-400 mt-1.5 leading-snug">
          {fmtInt(m.n_cells)} celdas H3 · res {m.res}
          {m.coarsened && <span className="text-sky-300"> · resolución reducida</span>}
          {m.truncated && <span className="text-orange-400"> · solo las de mayor actividad</span>}
        </div>
      )}
      {hex.error && (
        <div className="flex items-center gap-1 text-[10px] text-orange-400 mt-1">
          <AlertTriangle className="w-3 h-3" /> {hex.error}
        </div>
      )}
    </div>
  );
}
