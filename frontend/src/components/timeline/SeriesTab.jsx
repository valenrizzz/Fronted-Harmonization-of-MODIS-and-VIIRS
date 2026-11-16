import { useMemo } from 'react';
import { AlertTriangle, MousePointerClick } from 'lucide-react';
import { fmtDate } from '../../data/constants';
import { NrtChip, Skeleton } from '../ui/primitives';
import SeriesChart from './SeriesChart';
import { buildRows, spans } from './seriesRows';

function Legend({ swatch, children, title }) {
  return <span className="flex items-center gap-1.5 text-[10px] text-slate-500" title={title}>{swatch}{children}</span>;
}

const AQUA_START = '2002-07-04'; // antes de Aqua solo operaba MODIS-Terra

export default function SeriesTab({ fd }) {
  const { data, loading, error } = fd.monthly;
  const { start, end } = fd.range || {};
  const rows = useMemo(() => buildRows((data?.points || []).filter(
    (p) => !start || (p.date.slice(0, 7) >= start.slice(0, 7) && p.date <= end),
  )), [data, start, end]);
  const lowSpans = useMemo(() => {
    const s = spans(rows, (r) => r.tier === 'low', 3);
    // Solo se rotula el tramo previo a Aqua (sensor único) para no saturar el eje
    const early = s.find((x) => x.first < AQUA_START);
    if (early) early.label = 'MODIS único';
    return s;
  }, [rows]);
  const nrtSpans = useMemo(() => spans(rows, (r) => r.layer !== 'SP'), [rows]);

  const nrtStart = fd.regionInfo?.sp_nrt?.nrt_start;
  const hasEarlyLow = lowSpans.some((s) => s.first < AQUA_START);
  const hasRaw = rows.some((r) => r.isRaw);

  return (
    <div className="h-full flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <Legend swatch={<span className="w-4 h-0.5 rounded bg-fire-500" />}>Focos armonizados / mes</Legend>
        <Legend swatch={<span className="w-4 h-2.5 rounded-sm bg-orange-300/40" />}>
          IC 95% {data?.ci_method === 'sum_of_event_ci' && <span className="text-slate-400">(aprox. por evento)</span>}
        </Legend>
        {hasRaw && (
          <Legend
            swatch={<span className="w-4 h-2.5 rounded-sm ring-1 ring-violet-400/40" style={{ background: 'repeating-linear-gradient(45deg, rgba(139,92,246,0.35) 0 1.5px, transparent 1.5px 4px)' }} />}
            title="En meses de confiabilidad baja se grafica el conteo original de NASA FIRMS, sin corrección."
          >
            Confiabilidad baja · <span className="text-violet-600">conteo NASA original</span>
          </Legend>
        )}
        <span className="flex-1" />
        {hasEarlyLow && (
          <span
            className="chip bg-violet-50 text-violet-700 ring-violet-200"
            title="Antes de Aqua (jul. 2002) solo operaba MODIS-Terra: la calibración entre sensores tiene mayor incertidumbre."
          >
            <AlertTriangle className="w-3 h-3" />
            Alta incertidumbre histórica · Sensor MODIS único
          </span>
        )}
        {nrtStart && nrtSpans.length > 0 && <NrtChip label={`Provisorio desde ${fmtDate(nrtStart)} · en revisión`} />}
      </div>

      <div className="relative flex-1 min-h-0">
        {!data && loading && <Skeleton className="absolute inset-0 !rounded-xl" />}
        {error && !data && <div className="text-xs text-orange-600 p-4">No se pudo cargar la serie: {error}</div>}
        {data && (
          <div className={`absolute inset-0 transition-opacity duration-300 ${loading ? 'opacity-50' : ''}`}>
            <SeriesChart
              rows={rows}
              lowSpans={lowSpans}
              nrtSpans={nrtSpans}
            />
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
        <MousePointerClick className="w-3 h-3" />
        Pasá el cursor para ver el detalle de cada mes. Se muestra solo el rango de años elegido en el mapa.
        {fd.scope === 'area' && <span className="ml-auto text-orange-600">Serie recortada al área visible del mapa</span>}
      </div>
    </div>
  );
}
