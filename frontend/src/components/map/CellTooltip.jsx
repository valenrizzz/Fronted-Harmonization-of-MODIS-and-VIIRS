import { Flame, Hexagon, Activity, Gauge } from 'lucide-react';
import { fmtCount, fmtInt, fireColor } from '../../data/constants';
import { TierChip, NrtChip } from '../ui/primitives';

const AREA_KM2 = { 3: '12.400 km²', 5: '253 km²', 7: '5,2 km²' };

function Stat({ icon: Icon, label, value, unit }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="w-3.5 h-3.5 text-slate-500 shrink-0" />
      <span className="text-slate-500">{label}</span>
      <span className="ml-auto font-mono text-slate-800">
        {value}
        {unit && <span className="text-slate-500 text-[10px] ml-0.5">{unit}</span>}
      </span>
    </div>
  );
}

/** Tooltip enriquecido sobre una celda H3 (posición en px dentro del mapa). */
export default function CellTooltip({ hover, res, bounds }) {
  if (!hover) return null;
  const p = hover.p;
  const flipX = hover.x > bounds.width - 290;
  const flipY = hover.y > bounds.height - 230;
  const ciWide = p.weight_ci_high - p.weight_ci_low >= 1;

  return (
    <div
      className="absolute z-30 pointer-events-none w-[264px] glass-strong p-3 text-[11px]"
      style={{
        left: hover.x + (flipX ? -276 : 14),
        top: hover.y + (flipY ? -220 : 14),
      }}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="flex items-center gap-1.5 text-slate-500">
          <Hexagon className="w-3.5 h-3.5" />
          Celda H3 · res {res} <span className="text-slate-400">({AREA_KM2[res]})</span>
        </span>
      </div>

      <div className="flex items-end gap-2">
        <span className="font-display text-2xl font-semibold leading-none" style={{ color: fireColor(Math.max(p.t, 0.35), 1) }}>
          {fmtCount(p.weight)}
        </span>
        <span className="text-slate-500 pb-0.5">focos armonizados</span>
      </div>
      <div className="text-[10px] text-slate-500 mt-0.5 font-mono">
        {ciWide ? `IC 95%: ${fmtCount(p.weight_ci_low)} – ${fmtCount(p.weight_ci_high)}` : 'IC 95% despreciable (calibración exacta)'}
      </div>

      <div className="h-1 rounded-full bg-slate-100 mt-2 mb-2.5 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.max(p.t * 100, 4)}%`, background: fireColor(p.t, 1) }} />
      </div>

      <div className="space-y-1.5">
        <Stat icon={Activity} label="Eventos celda-día" value={fmtInt(p.events)} />
        <Stat icon={Gauge} label="FRP medio" value={p.frp_mean != null ? p.frp_mean.toLocaleString('es-AR', { maximumFractionDigits: 1 }) : '–'} unit="MW" />
        <Stat icon={Flame} label="FRP máximo" value={p.frp_max != null ? fmtInt(p.frp_max) : '–'} unit="MW" />
      </div>

      <div className="flex flex-wrap gap-1.5 mt-2.5 pt-2.5 border-t border-slate-100">
        <TierChip tier={p.reliability_tier} />
        {p.events_nrt > 0 && <NrtChip label={`${fmtInt(p.events_nrt)} provisorios (NRT)`} />}
      </div>
      <div className="text-[9px] text-slate-400 font-mono mt-2">
        {p.lat.toFixed(3)}°, {p.lon.toFixed(3)}°
      </div>
    </div>
  );
}
