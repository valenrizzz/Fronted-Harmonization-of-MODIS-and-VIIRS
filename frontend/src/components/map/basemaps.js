/**
 * Mapas base. El estilo vectorial claro de CARTO (Positron) siempre está cargado (aporta
 * etiquetas y límites); las capas raster se intercalan debajo y, cuando están
 * activas, se ocultan los rellenos de CARTO para dejar ver la imagen.
 */
export const LIGHT_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';

export const BASEMAPS = [
  {
    id: 'light',
    label: 'Claro',
    desc: 'Limpio, máximo contraste',
    thumb: 'https://basemaps.cartocdn.com/light_all/3/2/4.png',
  },
  {
    id: 'bluemarble',
    label: 'NASA Blue Marble',
    desc: 'Relieve y batimetría · MODIS',
    thumb: `${GIBS}/BlueMarble_ShadedRelief_Bathymetry/default/2004-08-01/GoogleMapsCompatible_Level8/3/4/2.jpeg`,
    tiles: [`${GIBS}/BlueMarble_ShadedRelief_Bathymetry/default/2004-08-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg`],
    maxzoom: 8,
    attribution: 'NASA Blue Marble (GIBS)',
    paint: { 'raster-saturation': -0.2 },
  },
  {
    id: 'satellite',
    label: 'Satélite',
    desc: 'Imagen de alta resolución',
    thumb: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/3/4/2',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    maxzoom: 18,
    attribution: '© Esri, Maxar, Earthstar Geographics',
    paint: { 'raster-brightness-max': 0.9, 'raster-saturation': -0.2 },
  },
];

/** Capas de CARTO que siguen visibles sobre una imagen raster (etiquetas y límites). */
const keepOverRaster = (layer) => layer.type === 'symbol' || /boundary|admin/i.test(layer.id);

export function installBasemaps(map) {
  const carto = map.getStyle().layers.map((l) => ({
    id: l.id,
    keep: keepOverRaster(l),
    vis: l.layout?.visibility || 'visible',
  }));
  const bottom = carto[0]?.id;
  for (const b of BASEMAPS) {
    if (!b.tiles) continue;
    map.addSource(`bm-${b.id}`, { type: 'raster', tiles: b.tiles, tileSize: 256, maxzoom: b.maxzoom, attribution: b.attribution });
    map.addLayer(
      { id: `bm-${b.id}`, type: 'raster', source: `bm-${b.id}`, layout: { visibility: 'none' }, paint: { ...b.paint, 'raster-fade-duration': 250 } },
      bottom,
    );
  }
  return carto;
}

export function applyBasemap(map, carto, id) {
  const raster = Boolean(BASEMAPS.find((b) => b.id === id)?.tiles);
  for (const b of BASEMAPS) {
    if (b.tiles) map.setLayoutProperty(`bm-${b.id}`, 'visibility', b.id === id ? 'visible' : 'none');
  }
  for (const l of carto) {
    if (!l.keep) map.setLayoutProperty(l.id, 'visibility', raster ? 'none' : l.vis);
  }
}

/** Primera capa de etiquetas: los hexágonos se dibujan debajo para no tapar nombres. */
export const firstSymbolId = (map) => map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
