import { FIRE_STOPS, FIRE_OPACITY } from '../../data/constants';
import { firstSymbolId } from './basemaps';

/** Capas de actividad H3: halo, relleno 2D, borde de hover y extrusión 3D. */
const EMPTY = { type: 'FeatureCollection', features: [] };
const T = ['coalesce', ['get', 't'], 0];
const COLOR = ['interpolate', ['linear'], T, ...FIRE_STOPS.flat()];
const HOVER = ['boolean', ['feature-state', 'hover'], false];
export const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function addFireLayers(map) {
  const before = firstSymbolId(map);
  map.addSource('cells', { type: 'geojson', data: EMPTY, promoteId: 'h3' });
  map.addSource('cell-glow', { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: 'cells-glow', type: 'circle', source: 'cell-glow',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, ['*', ['get', 't'], 14], 6, ['*', ['get', 't'], 42], 10, ['*', ['get', 't'], 90]],
      'circle-color': '#FF3B1F',
      'circle-blur': 1,
      'circle-opacity': ['*', ['-', ['get', 't'], 0.6], 0.55],
    },
  }, before);
  map.addLayer({
    id: 'cells-fill', type: 'fill', source: 'cells',
    paint: {
      'fill-color': ['case', HOVER, '#FDBA74', COLOR],
      'fill-opacity': ['case', HOVER, 0.98, ['interpolate', ['linear'], T, 0, FIRE_OPACITY[0], 1, FIRE_OPACITY[1]]],
      'fill-outline-color': 'rgba(194, 65, 12, 0.22)',
    },
  }, before);
  map.addLayer({
    id: 'cells-line', type: 'line', source: 'cells',
    paint: { 'line-color': '#050077', 'line-width': ['case', HOVER, 2, 0], 'line-blur': 0.5 },
  }, before);
  map.addLayer({
    id: 'cells-extrusion', type: 'fill-extrusion', source: 'cells', layout: { visibility: 'none' },
    paint: {
      'fill-extrusion-color': ['case', HOVER, '#FDBA74', COLOR],
      'fill-extrusion-height': ['get', 'h'],
      'fill-extrusion-opacity': 0.9,
      'fill-extrusion-vertical-gradient': true,
    },
  }, before);
}

export const contains = (view, box, tol = 0.25) =>
  view[0] <= box[0] + tol && view[1] <= box[1] + tol && view[2] >= box[2] - tol && view[3] >= box[3] - tol;
