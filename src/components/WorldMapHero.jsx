import { useEffect, useRef, useState, useCallback } from 'react';
import {
  ChevronDown, ChevronUp, Layers, Search, Check, MapPin, ArrowDown,
} from 'lucide-react';

const TILE_SATELLITE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const TILE_STREET = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTR_SAT = '© Esri, Maxar, Earthstar, USDA, USGS, AeroGRID';
const ATTR_STREET = '© OpenStreetMap contributors';

// Simplified country centroids for click-to-select
const COUNTRY_MAP = {
  'Argentina': [-34, -64],
  'Brasil - Amazonia Sur': [-8, -55],
  'Chile': [-35, -71],
  'California - EE.UU.': [37, -120],
  'Australia': [-28, 134],
};

export default function WorldMapHero({
  region, setRegion, regionKeys,
  province, setProvince,
  city, setCity,
  scrollToCalendar,
  hotspots,
}) {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const tileRef = useRef(null);
  const [isSatellite, setIsSatellite] = useState(true);
  const [panelOpen, setPanelOpen] = useState(true);
  const [search, setSearch] = useState('');
  const [mapReady, setMapReady] = useState(false);

  // Init map
  useEffect(() => {
    let cancelled = false;
    async function init() {
      const L = (await import('leaflet')).default;
      if (cancelled || !mapRef.current || mapInstance.current) return;

      const map = L.map(mapRef.current, {
        center: [20, 0],
        zoom: 2,
        zoomControl: false,
        scrollWheelZoom: false,
        attributionControl: true,
      });

      map.on('click', () => { map.scrollWheelZoom.enable(); });
      map.on('mouseout', () => { map.scrollWheelZoom.disable(); });

      L.control.zoom({ position: 'bottomright' }).addTo(map);

      tileRef.current = L.tileLayer(TILE_SATELLITE, {
        attribution: ATTR_SAT,
        maxZoom: 18,
      }).addTo(map);

      // Hotspot markers
      if (hotspots?.length) {
        hotspots.forEach(([lat, lng]) => {
          L.circleMarker([lat, lng], {
            radius: 5, color: '#EA580C', fillColor: '#FBBF24',
            fillOpacity: 0.7, weight: 1.5,
          }).addTo(map);
        });
      }

      mapInstance.current = map;
      setMapReady(true);
    }
    init();
    return () => { cancelled = true; if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null; } };
  }, []);

  // Update hotspots on region change
  useEffect(() => {
    if (!mapInstance.current || !mapReady) return;
    const coords = COUNTRY_MAP[region];
    if (coords) mapInstance.current.flyTo(coords, 5, { duration: 1.2 });
    else mapInstance.current.flyTo([20, 0], 2, { duration: 1.2 });
  }, [region, mapReady]);

  // Toggle tile layer
  const toggleTile = useCallback(async () => {
    const L = (await import('leaflet')).default;
    if (!mapInstance.current || !tileRef.current) return;
    mapInstance.current.removeLayer(tileRef.current);
    const next = isSatellite
      ? L.tileLayer(TILE_STREET, { attribution: ATTR_STREET, maxZoom: 18 })
      : L.tileLayer(TILE_SATELLITE, { attribution: ATTR_SAT, maxZoom: 18 });
    next.addTo(mapInstance.current);
    tileRef.current = next;
    setIsSatellite(!isSatellite);
  }, [isSatellite]);

  const filtered = regionKeys.filter((r) =>
    r.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <section className="relative w-full" style={{ height: '72vh', minHeight: 480 }}>
      {/* Map */}
      <div ref={mapRef} className="absolute inset-0 z-0 rounded-b-2xl overflow-hidden" />

      {/* Tile toggle */}
      <button
        onClick={toggleTile}
        className="absolute top-3 right-3 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/90 backdrop-blur border border-stone-200 text-xs font-medium text-stone-600 hover:bg-white shadow-sm transition-colors"
      >
        <Layers className="w-3.5 h-3.5" />
        {isSatellite ? 'Mapa Callejero' : 'Vista Satelital'}
      </button>

      {/* Floating left panel */}
      <div className="absolute top-3 left-3 z-20 w-72">
        <div className="bg-white/95 backdrop-blur-md rounded-2xl shadow-lg border border-stone-200 overflow-hidden">
          {/* Panel header */}
          <button
            onClick={() => setPanelOpen(!panelOpen)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-stone-700"
          >
            <span className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-orange-500" />
              Explorar Ubicación
            </span>
            {panelOpen ? <ChevronUp className="w-4 h-4 text-stone-400" /> : <ChevronDown className="w-4 h-4 text-stone-400" />}
          </button>

          {panelOpen && (
            <div className="px-4 pb-4 space-y-3">
              {/* Country search */}
              <div>
                <label className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider">País / Región</label>
                <div className="relative mt-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-400" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar…"
                    className="w-full pl-8 pr-3 py-1.5 bg-stone-50 border border-stone-200 rounded-lg text-sm text-stone-700 placeholder:text-stone-400 focus:outline-none focus:border-orange-400"
                  />
                </div>
                <div className="mt-1 max-h-36 overflow-y-auto space-y-0.5">
                  {filtered.map((r) => (
                    <button
                      key={r}
                      onClick={() => { setRegion(r); setSearch(''); }}
                      className={`w-full text-left px-2 py-1.5 rounded-lg text-xs transition-colors flex items-center gap-1.5 ${
                        region === r ? 'bg-orange-50 text-orange-700 font-medium' : 'text-stone-600 hover:bg-stone-50'
                      }`}
                    >
                      {region === r && <Check className="w-3 h-3 text-orange-500" />}
                      <span className={region === r ? '' : 'ml-[18px]'}>{r}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Scroll down CTA */}
              <button
                onClick={scrollToCalendar}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-semibold shadow-md shadow-orange-200/50 hover:from-amber-400 hover:to-orange-400 transition-all active:scale-[0.97]"
              >
                <ArrowDown className="w-3.5 h-3.5" />
                Ver calendario y estadísticas
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
