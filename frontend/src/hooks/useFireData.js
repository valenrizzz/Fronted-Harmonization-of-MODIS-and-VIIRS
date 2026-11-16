import { useState, useMemo, useCallback } from 'react';
import { api } from '../data/api';
import { regionName } from '../data/constants';
import { buildRegionData } from '../data/transform';
import { buildCSV, downloadText } from '../data/csv';
import { resolveWindow } from '../data/presets';
import { useQuery } from './useQuery';

/**
 * Estado global del Command Center.
 *
 * - `range` (start/end/preset) es la ventana temporal única que alimenta mapa,
 *   KPIs, calendario y exportación.
 * - `viewport` lo reporta el mapa: si la vista contiene toda la región se piden
 *   las series precalculadas (IC exactos); si no, se recorta por `bbox`.
 */
export function useFireData() {
  const [reloadKey, setReloadKey] = useState(0);
  const [region, setRegionState] = useState(null);
  const [preset, setPreset] = useState('recent');
  const [custom, setCustom] = useState(null);
  const [viewport, setViewport] = useState(null);

  const regionsQ = useQuery(`regions:${reloadKey}`, (signal) => api.regions({ signal }));
  const regions = regionsQ.data || [];
  // Sin país predeterminado: el usuario elige el primero desde el mapa
  const activeRegion = region && regions.some((r) => r.region === region) ? region : null;
  const regionInfo = useMemo(() => regions.find((r) => r.region === activeRegion) || null, [regions, activeRegion]);

  const range = useMemo(
    () => (regionInfo ? resolveWindow(preset, regionInfo.period, custom) : null),
    [regionInfo, preset, custom],
  );

  // Recorte espacial: solo si la vista NO abarca la región entera
  const areaBbox = viewport && !viewport.containsRegion ? viewport.bbox.join(',') : undefined;

  const summaryQ = useQuery(
    range ? `summary:${activeRegion}:${range.start}:${range.end}:${areaBbox || ''}` : null,
    (signal) => api.summary(activeRegion, { start: range.start, end: range.end, bbox: areaBbox }, { signal }),
  );

  const monthlyQ = useQuery(
    activeRegion ? `monthly:${activeRegion}:${areaBbox || ''}` : null,
    (signal) => api.timeseries(activeRegion, 'monthly', { bbox: areaBbox }, { signal }),
  );

  // Serie diaria de la región completa (calendario, comparativa y CSV)
  const dailyQ = useQuery(
    activeRegion ? `daily:${activeRegion}` : null,
    (signal) => api.timeseries(activeRegion, 'daily', {}, { signal }).then((ts) => buildRegionData(ts.points)),
  );

  const setRegion = useCallback((code) => { setRegionState(code); setViewport(null); }, []);
  const setYearWindow = useCallback((y) => setPreset(`year:${y}`), []);
  const setCustomWindow = useCallback((start, end) => { setCustom({ start, end }); setPreset('custom'); }, []);

  const year = range
    ? Number(range.preset.startsWith('year:') ? range.preset.slice(5) : range.end.slice(0, 4))
    : null;

  const label = activeRegion ? regionName(activeRegion) : '';

  const downloadCSV = useCallback((level = 'Día') => {
    if (!dailyQ.data || !range) return;
    const csv = buildCSV(dailyQ.data, label, level, range);
    downloadText(csv, `focos_armonizados_${activeRegion}_${range.start}_${range.end}.csv`);
  }, [dailyQ.data, label, activeRegion, range]);

  return {
    status: regionsQ.error ? 'error' : regionsQ.data ? 'ready' : 'loading',
    error: regionsQ.error,
    retry: () => setReloadKey((k) => k + 1),
    regions,
    region: activeRegion,
    setRegion,
    regionInfo,
    locationLabel: label,
    range,
    setYearWindow,
    setCustomWindow,
    year,
    viewport,
    setViewport,
    scope: areaBbox ? 'area' : 'region',
    summary: summaryQ,
    monthly: monthlyQ,
    daily: dailyQ,
    downloadCSV,
  };
}
