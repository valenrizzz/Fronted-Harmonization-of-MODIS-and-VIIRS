import { useEffect, useRef, useState } from 'react';
import { Map, Maximize2 } from 'lucide-react';

// We dynamically import leaflet to avoid SSR issues and reduce bundle
let L = null;

function FireDot({ map, lat, lng, radius = 4 }) {
  useEffect(() => {
    if (!map || !L) return;
    const circle = L.circleMarker([lat, lng], {
      radius,
      color: '#EF4444',
      fillColor: '#F59E0B',
      fillOpacity: 0.7,
      weight: 1,
    }).addTo(map);
    return () => { map.removeLayer(circle); };
  }, [map, lat, lng, radius]);
  return null;
}

export default function MiniMapCard({ center, zoom, hotspots, region, viewMode, setViewMode }) {
  const mapContainer = useRef(null);
  const mapInstance = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function initMap() {
      if (!mapContainer.current) return;

      // Dynamic import of leaflet
      const leaflet = await import('leaflet');
      L = leaflet.default || leaflet;

      if (cancelled || !mapContainer.current) return;

      // Clean up previous map
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }

      const map = L.map(mapContainer.current, {
        center,
        zoom: zoom || 3,
        zoomControl: false,
        attributionControl: true,
        dragging: true,
        scrollWheelZoom: false,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OSM',
        maxZoom: 18,
      }).addTo(map);

      // Add zoom control bottom-right
      L.control.zoom({ position: 'bottomright' }).addTo(map);

      // Add hotspot markers
      if (hotspots && hotspots.length > 0) {
        hotspots.forEach(([lat, lng]) => {
          // Pulsing circle marker
          L.circleMarker([lat, lng], {
            radius: 5 + Math.random() * 4,
            color: '#EF4444',
            fillColor: '#F59E0B',
            fillOpacity: 0.65,
            weight: 1.5,
          }).addTo(map).bindPopup(
            `<div style="font-size:11px;color:#333"><b>Foco activo</b><br/>${lat.toFixed(2)}°, ${lng.toFixed(2)}°</div>`,
          );
        });
      }

      mapInstance.current = map;
      setReady(true);
    }

    initMap();

    return () => {
      cancelled = true;
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, [center, zoom, hotspots]);

  return (
    <div className="glass-card p-4">
      <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2 mb-3">
        <Map className="w-4 h-4 text-amber-400" />
        Mapa de Focos Activos
      </h3>

      <div className="relative rounded-lg overflow-hidden border border-slate-800/50">
        <div
          ref={mapContainer}
          className="w-full h-44"
          style={{ background: '#0f172a' }}
        />

        {/* Overlay button */}
        <button
          onClick={() => setViewMode(viewMode === 'calendar' ? 'map' : 'calendar')}
          className="absolute bottom-2 right-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900/90 backdrop-blur border border-slate-700/60 text-xs text-amber-400 font-semibold hover:bg-slate-800 transition-colors shadow-lg"
        >
          <Maximize2 className="w-3.5 h-3.5" />
          Explorar Mapa Completo ⤢
        </button>
      </div>

      <p className="text-[9px] text-slate-600 mt-1.5 text-center">
        {region} — Puntos de calor representativos
      </p>
    </div>
  );
}
