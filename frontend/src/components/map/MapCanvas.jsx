import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { animate } from 'framer-motion';
import { LIGHT_STYLE, installBasemaps, applyBasemap } from './basemaps';
import { addFireLayers, contains, reduceMotion } from './fireLayers';
import { useCellHover } from './useCellHover';
import { useHexSource } from './useHexSource';
import CellTooltip from './CellTooltip';
import MapLegend from './MapLegend';
import MapToolbar from './MapToolbar';
import { ProgressLine } from '../ui/primitives';

export default function MapCanvas({ region, regionInfo, range, insets, onViewport, busy }) {
  const containerRef = useRef(null);
  const cartoRef = useRef(null);
  const [map, setMap] = useState(null);
  const [bearing, setBearing] = useState(0);
  const [is3D, setIs3D] = useState(false);
  const [basemap, setBasemap] = useState('light');
  const viewportCb = useRef(onViewport);
  viewportCb.current = onViewport;
  const regionBox = useRef(null);
  regionBox.current = regionInfo?.bbox || null;

  // --- Inicialización
  useEffect(() => {
    const m = new maplibregl.Map({
      container: containerRef.current,
      style: LIGHT_STYLE,
      center: [-63, -30],
      zoom: 2.6,
      minZoom: 1.5,
      maxPitch: 70,
      attributionControl: false,
      fadeDuration: 150,
    });
    m.addControl(new maplibregl.AttributionControl({
      compact: true,
      customAttribution: 'Focos: NASA FIRMS · MODIS + VIIRS armonizados',
    }), 'bottom-right');
    m.on('load', () => {
      cartoRef.current = installBasemaps(m);
      addFireLayers(m);
      setMap(m);
    });
    m.on('rotate', () => setBearing(m.getBearing()));
    return () => m.remove();
  }, []);

  // --- Reporte del viewport (KPIs y serie siguen al mapa)
  useEffect(() => {
    if (!map) return undefined;
    let timer = null;
    const report = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const b = map.getBounds();
        const view = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((v) => Math.round(v * 100) / 100);
        const box = regionBox.current;
        viewportCb.current?.({ bbox: view, containsRegion: box ? contains(view, box) : true });
      }, 450);
    };
    map.on('moveend', report);
    return () => { map.off('moveend', report); clearTimeout(timer); };
  }, [map]);

  // --- Encuadre de la región
  const fitRegion = useCallback((animated = true) => {
    if (!map || !regionInfo) return;
    const [w, s, e, n] = regionInfo.bbox;
    const c = map.getContainer();
    const pad = {
      top: Math.min(insets.top, c.clientHeight * 0.45),
      bottom: Math.min(insets.bottom, c.clientHeight * 0.4),
      left: Math.min(insets.left, c.clientWidth * 0.45),
      right: Math.min(insets.right, c.clientWidth * 0.3),
    };
    map.fitBounds([[w, s], [e, n]], {
      padding: pad,
      pitch: is3D ? 55 : 0,
      bearing: is3D ? -18 : 0,
      duration: animated && !reduceMotion() ? 1800 : 0,
      essential: true,
    });
  }, [map, regionInfo, insets, is3D]);

  const framed = useRef(null);
  useEffect(() => {
    if (!map || !regionInfo || framed.current === regionInfo.region) return;
    fitRegion(framed.current !== null);
    framed.current = regionInfo.region;
  }, [map, regionInfo, fitRegion]);

  // --- Mapa base
  useEffect(() => {
    if (map && cartoRef.current) applyBasemap(map, cartoRef.current, basemap);
  }, [map, basemap]);

  // --- 2D / 3D (las columnas "crecen" al activar)
  const was3D = useRef(false);
  useEffect(() => {
    if (!map) return undefined;
    map.setLayoutProperty('cells-extrusion', 'visibility', is3D ? 'visible' : 'none');
    for (const id of ['cells-fill', 'cells-line', 'cells-glow']) map.setLayoutProperty(id, 'visibility', is3D ? 'none' : 'visible');
    if (was3D.current !== is3D) {
      // Al inclinar la cámara se acerca un poco para compensar el horizonte
      const dz = is3D ? 0.4 : -0.4;
      map.easeTo({ pitch: is3D ? 55 : 0, bearing: is3D ? -18 : 0, zoom: map.getZoom() + dz, duration: reduceMotion() ? 0 : 1200 });
      was3D.current = is3D;
    }
    if (!is3D || reduceMotion()) return undefined;
    const ctl = animate(0, 1, {
      duration: 1.1,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (k) => map.setPaintProperty('cells-extrusion', 'fill-extrusion-height', ['*', ['get', 'h'], k]),
    });
    return () => ctl.stop();
  }, [map, is3D]);

  const hover = useCellHover(map);

  const hex = useHexSource(map, region, range);
  const container = containerRef.current;

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="absolute inset-0 bg-night-900" />
      <ProgressLine active={hex.loading || busy} />
      <CellTooltip
        hover={hover}
        res={hex.meta?.res}
        bounds={{ width: container?.clientWidth || 0, height: container?.clientHeight || 0 }}
      />
      <MapLegend hex={hex} style={{ bottom: insets.bottom }} />
      <MapToolbar
        top={insets.top}
        map={map}
        bearing={bearing}
        onFit={() => fitRegion(true)}
        is3D={is3D}
        setIs3D={setIs3D}
        basemap={basemap}
        setBasemap={setBasemap}
      />
      <style>{`.maplibregl-ctrl-bottom-right{bottom:${Math.max(insets.bottom - 8, 0)}px}`}</style>
    </div>
  );
}
