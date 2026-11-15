import { Flame } from 'lucide-react';
import { EMBER_SCALE } from '../data/constants';

export default function ColorLegend() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 mt-4 text-xs text-stone-400">
      <div className="flex items-center gap-2">
        <span className="font-medium">Menos</span>
        <div className="flex gap-[1px]">
          {EMBER_SCALE.map((c) => (
            <div key={c} className="w-5 h-3 first:rounded-l last:rounded-r" style={{ backgroundColor: c }} />
          ))}
        </div>
        <span className="font-medium">Más</span>
      </div>
      <span className="flex items-center gap-1.5">
        <span className="w-3 h-3 rounded-[3px] border border-stone-200" style={{ background: 'repeating-linear-gradient(45deg,#E7E5E4 0 2px,#F5F5F4 2px 5px)' }} />
        Sin dato satelital
      </span>
      <span className="flex items-center gap-1.5">
        <span className="w-3 h-3 rounded-[3px] bg-amber-100 outline outline-1 outline-dashed outline-orange-400" />
        Provisorio (NRT)
      </span>
      <span className="flex items-center gap-1.5">
        <Flame className="w-3 h-3 text-red-500" fill="currentColor" />
        Día pico (≥ P90 histórico)
      </span>
    </div>
  );
}
