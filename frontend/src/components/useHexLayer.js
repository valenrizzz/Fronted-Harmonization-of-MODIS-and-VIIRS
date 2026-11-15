import { useEffect, useRef, useState } from 'react';
import { api } from '../data/api';
import { emberColor, fmtCount, TIER_LABEL } from '../data/constants';

const MAX_CELLS = 4000; // tope de hexágonos SVG por vista para mantener fluido el mapa

function popupHtml(p) {
  const nrt = p.events_nrt > 0 ? `<br/><span style="color:#C2410C">${p.events_nrt} provisorios (NRT)</span>` : '';
  const frp = p.frp_max != null ? `<br/>FRP máx.: ${p.frp_max.toLocaleString('es-AR')} MW` : '';
  return `<div style="font-size:11px;color:#292524;line-height:1.45">
    <b>${fmtCount(p.weight)} focos armonizados</b><br/>
    ${p.events.toLocaleString('es-AR')} eventos celda-día${frp}<br/>
    Confiabilidad: ${TIER_LABEL[p.reliability_tier] || p.reliability_tier}${nrt}</div>`;
}

/**
 * Capa de hexágonos H3 con la actividad armonizada del año.
 * Se vuelve a pedir al mover/zoomear el mapa (bbox + zoom de la vista);
 * el backend elige la resolución H3 y limita la cantidad de celdas.
 */
export function useHexLayer(map, region, year) {
  const layerRef = useRef(null);
  const [state, setState] = useState({ loading: false, meta: null, error: null });

  useEffect(() => {
    if (!map || !region || !year) return undefined;
    let ctl = null;
    let timer = null;
    let L = null;

    const load = async () => {
      L = L || (await import('leaflet')).default;
      ctl?.abort();
      ctl = new AbortController();
      const b = map.getBounds();
      const bbox = [
        Math.max(b.getWest(), -180), Math.max(b.getSouth(), -90),
        Math.min(b.getEast(), 180), Math.min(b.getNorth(), 90),
      ].map((v) => v.toFixed(3)).join(',');
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const fc = await api.cellsGeojson(region, {
          start: `${year}-01-01`, end: `${year}-12-31`, bbox, zoom: map.getZoom(), limit: MAX_CELLS,
        }, { signal: ctl.signal });
        const max = Math.max(...fc.features.map((f) => f.properties.weight), 1);
        const layer = L.geoJSON(fc, {
          style: (f) => ({
            color: emberColor(f.properties.weight, max) || '#FEF3C7',
            weight: 0.4,
            fillColor: emberColor(f.properties.weight, max) || '#FEF3C7',
            fillOpacity: 0.75,
          }),
          onEachFeature: (f, l) => l.bindPopup(popupHtml(f.properties)),
        });
        layerRef.current?.remove();
        layerRef.current = layer.addTo(map);
        setState({ loading: false, meta: fc.metadata, error: null });
      } catch (e) {
        if (e.name !== 'AbortError') setState({ loading: false, meta: null, error: e.message });
      }
    };

    const onMove = () => { clearTimeout(timer); timer = setTimeout(load, 350); };
    map.on('moveend', onMove);
    load();
    return () => {
      map.off('moveend', onMove);
      clearTimeout(timer);
      ctl?.abort();
      layerRef.current?.remove();
      layerRef.current = null;
    };
  }, [map, region, year]);

  return state;
}
