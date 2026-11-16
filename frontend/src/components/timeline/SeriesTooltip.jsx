import { fmtCount, fmtMonth, fmtInt, MONTH_NAMES } from '../../data/constants';
import { TierChip, NrtChip } from '../ui/primitives';

/** Ventanas de hasta 3 años: marcas trimestrales; si no, anuales. */
export const isShort = (rows) => rows.length <= 36;
export const tickLabel = (short) => (t) => {
  const d = new Date(t);
  return short ? `${MONTH_NAMES[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}` : d.getUTCFullYear();
};

export const yearTicks = (rows) => {
  if (!rows.length) return [];
  if (isShort(rows)) return rows.filter((r) => new Date(r.ts).getUTCMonth() % 3 === 0).map((r) => r.ts);
  const y0 = new Date(rows[0].ts).getUTCFullYear() + 1;
  const y1 = new Date(rows[rows.length - 1].ts).getUTCFullYear();
  const step = y1 - y0 > 14 ? 2 : 1;
  const out = [];
  for (let y = y0; y <= y1; y += step) out.push(Date.UTC(y, 0, 1));
  return out;
};

export function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="glass-strong px-3 py-2 text-[11px] min-w-[190px]">
      <div className="font-semibold text-white">{fmtMonth(r.date)}</div>
      {r.v == null ? (
        <div className="text-slate-400">Sin dato satelital</div>
      ) : (
        <>
          {r.isRaw ? (
            <>
              <div className="font-display text-lg text-violet-300 leading-tight mt-0.5">
                {fmtInt(r.v)} <span className="text-[10px] text-slate-400 font-sans">detecciones NASA originales</span>
              </div>
              <div className="text-[10px] text-slate-400">
                Sin armonizar: calibración poco confiable este mes
                <span className="block font-mono text-slate-500">(armonizado: {fmtCount(r.harmonized)})</span>
              </div>
            </>
          ) : (
            <>
              <div className="font-display text-lg text-orange-300 leading-tight mt-0.5">
                {fmtCount(r.v)} <span className="text-[10px] text-slate-400 font-sans">focos armonizados</span>
              </div>
              {r.band && <div className="font-mono text-[10px] text-slate-400">IC 95% {fmtCount(r.band[0])}–{fmtCount(r.band[1])}</div>}
              {r.nasa != null && <div className="font-mono text-[10px] text-slate-500">NASA FIRMS original: {fmtInt(r.nasa)}</div>}
            </>
          )}
          <div className="text-[10px] text-slate-400 mt-0.5">
            {fmtInt(r.observed)} observados
            {r.coverage != null && r.coverage < 1 && ` · cobertura ${Math.round(r.coverage * 100)}%`}
          </div>
          <div className="flex flex-wrap gap-1 mt-1.5">
            <TierChip tier={r.tier} />
            {r.layer !== 'SP' && <NrtChip label={r.layer === 'MIXED' ? 'Mixto SP/NRT' : 'Provisorio · NRT'} />}
          </div>
        </>
      )}
    </div>
  );
}
