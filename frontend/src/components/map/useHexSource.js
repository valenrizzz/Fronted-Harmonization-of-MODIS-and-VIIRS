import { useEffect, useState } from 'react';
import { api } from '../../data/api';

const MAX_CELLS = 4000;
const EMPTY = { type: 'FeatureCollection', features: [] };
/** Altura de extrusión (m) para t = 1 según la resolución H3. */
const RES_HEIGHT = { 3: 400000, 5: 95000, 7: 21000 };
/** El backend calcula la resolución con zoom tipo Leaflet (tiles de 256 px) = zoom MapLibre + 1. */
const apiZoom = (map) => map.getZoom() + 1;
const resForZoom = (z) => (z <= 5 ? 3 : z <= 8 ? 5 : 7);

const inside = (a, b) => a[0] >= b[0] && a[1] >= b[1] && a[2] <= b[2] && a[3] <= b[3];

function decorate(fc) {
  const ws = fc.features.map((f) => f.properties.weight).sort((a, b) => a - b);
  // Referencia = P98 de la vista: un outlier no "apaga" al resto de las celdas
  const ref = ws.length ? Math.max(ws[Math.floor((ws.length - 1) * 0.98)], 1e-6) : 1;
  const height = RES_HEIGHT[fc.metadata.res] || 50000;
  const glow = [];
  for (const f of fc.features) {
    const p = f.properties;
    p.t = Math.min(1, Math.sqrt(p.weight / ref));
    p.h = p.t * height;
    if (p.t > 0.8) glow.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: { t: p.t } });
  }
  return { ref, glow: { type: 'FeatureCollection', features: glow } };
}

/**
 * Mantiene las fuentes `cells` y `cell-glow` del mapa con la actividad H3 de la
 * ventana temporal. Pide un bbox 30 % más amplio que la vista y no vuelve a
 * consultar mientras el usuario se mueva dentro de él a la misma resolución.
 */
export function useHexSource(map, region, range) {
  const [state, setState] = useState({ loading: false, meta: null, error: null });

  useEffect(() => {
    if (!map || !region || !range) return undefined;
    let ctl = null;
    let timer = null;
    let last = null;

    const load = async (force = false) => {
      const z = apiZoom(map);
      const res = resForZoom(z);
      const b = map.getBounds();
      const view = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
      if (!force && last && last.res === res && last.complete && inside(view, last.bbox)) return;

      const dx = (view[2] - view[0]) * 0.3;
      const dy = (view[3] - view[1]) * 0.3;
      const bbox = [
        Math.max(view[0] - dx, -180), Math.max(view[1] - dy, -85),
        Math.min(view[2] + dx, 180), Math.min(view[3] + dy, 85),
      ];
      ctl?.abort();
      ctl = new AbortController();
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const fc = await api.cellsGeojson(region, {
          start: range.start,
          end: range.end,
          bbox: bbox.map((v) => v.toFixed(3)).join(','),
          zoom: z.toFixed(2),
          limit: MAX_CELLS,
        }, { signal: ctl.signal });
        const { ref, glow } = decorate(fc);
        map.getSource('cells')?.setData(fc);
        map.getSource('cell-glow')?.setData(glow);
        last = { bbox, res, complete: !fc.metadata.truncated && !fc.metadata.coarsened };
        setState({ loading: false, meta: { ...fc.metadata, ref }, error: null });
      } catch (e) {
        if (e.name !== 'AbortError') setState((s) => ({ ...s, loading: false, error: e.message }));
      }
    };

    const onMove = () => { clearTimeout(timer); timer = setTimeout(() => load(false), 300); };
    map.on('moveend', onMove);
    load(true);
    return () => {
      map.off('moveend', onMove);
      clearTimeout(timer);
      ctl?.abort();
    };
  }, [map, region, range?.start, range?.end]); // eslint-disable-line react-hooks/exhaustive-deps

  // Al cambiar de región se vacía la capa para no mezclar países durante el vuelo
  useEffect(() => {
    if (!map) return;
    map.getSource('cells')?.setData(EMPTY);
    map.getSource('cell-glow')?.setData(EMPTY);
  }, [map, region]);

  return state;
}
