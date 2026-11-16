import { useEffect, useState } from 'react';

/** Hover/clic sobre celdas H3: resalta con feature-state y devuelve datos para el tooltip. */
export function useCellHover(map) {
  const [hover, setHover] = useState(null);
  useEffect(() => {
    if (!map) return undefined;
    let hoverId = null;
    let raf = 0;
    const clear = () => {
      if (hoverId != null) map.setFeatureState({ source: 'cells', id: hoverId }, { hover: false });
      hoverId = null;
    };
    const onMove = (e) => {
      const f = e.features?.[0];
      if (!f) return;
      if (hoverId !== f.id) {
        clear();
        hoverId = f.id;
        map.setFeatureState({ source: 'cells', id: hoverId }, { hover: true });
      }
      map.getCanvas().style.cursor = 'pointer';
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setHover({ x: e.point.x, y: e.point.y, p: f.properties }));
    };
    const onLeave = () => {
      clear();
      cancelAnimationFrame(raf);
      map.getCanvas().style.cursor = '';
      setHover(null);
    };
    const layers = ['cells-fill', 'cells-extrusion'];
    for (const l of layers) {
      map.on('mousemove', l, onMove);
      map.on('click', l, onMove);
      map.on('mouseleave', l, onLeave);
    }
    map.on('movestart', onLeave);
    return () => {
      for (const l of layers) {
        map.off('mousemove', l, onMove);
        map.off('click', l, onMove);
        map.off('mouseleave', l, onLeave);
      }
      map.off('movestart', onLeave);
      cancelAnimationFrame(raf);
    };
  }, [map]);

  return hover;
}
