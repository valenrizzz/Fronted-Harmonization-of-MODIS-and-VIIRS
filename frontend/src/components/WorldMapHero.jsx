import { useEffect, useRef, useState, useCallback } from 'react';
import { ChevronDown, ChevronUp, Layers, Search, Check, MapPin, ArrowDown, Loader2 } from 'lucide-react';
import { regionName } from '../data/constants';
import { useHexLayer } from './useHexLayer';

const TILE_SATELLITE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const TILE_STREET = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTR_SAT = '© Esri, Maxar, Earthstar, USDA, USGS, AeroGRID';
const ATTR_STREET = '© OpenStreetMap contributors';

export default function WorldMapHero({ regions, region, setRegion, regionInfo, year, scrollToCalendar }) {
  const mapRef = useRef(null);
  const [map, setMap] = useState(null);
  const tileRef = useRef(null);
  const [isSatellite, setIsSatellite] = useState(true);
  const [panelOpen, setPanelOpen] = useState(true);
  const [search, setSearch] = useState('');

  // Inicializar Leaflet
  useEffect(() => {
    let cancelled = false;
    let instance = null;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !mapRef.current) return;
      instance = L.map(mapRef.current, {
        center: [-20, -60], zoom: 3, zoomControl: false, scrollWheelZoom: false,
      });
      instance.on('click', () => instance.scrollWheelZoom.enable());
      instance.on('mouseout', () => instance.scrollWheelZoom.disable());
      L.control.zoom({ position: 'bottomright' }).addTo(instance);
      tileRef.current = L.tileLayer(TILE_SATELLITE, { attribution: ATTR_SAT, maxZoom: 18 }).addTo(instance);
      setMap(instance);
    })();
    return () => { cancelled = true; instance?.remove(); };
  }, []);

  // Encuadrar la región: sin animación la primera vez, con vuelo al cambiar de región
  const framedOnce = useRef(false);
  useEffect(() => {
    if (!map || !regionInfo) return;
    const [w, s, e, n] = regionInfo.bbox;
    const bounds = [[s, w], [n, e]];
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!framedOnce.current || reduceMotion) map.fitBounds(bounds, { padding: [20, 20], animate: false });
    else map.flyToBounds(bounds, { duration: 1.2, padding: [20, 20] });
    framedOnce.current = true;
  }, [map, regionInfo]);

  const hex = useHexLayer(map, region, year);

  const toggleTile = useCallback(async () => {
    const L = (await import('leaflet')).default;
    if (!map || !tileRef.current) return;
    map.removeLayer(tileRef.current);
    tileRef.current = (isSatellite
      ? L.tileLayer(TILE_STREET, { attribution: ATTR_STREET, maxZoom: 18 })
      : L.tileLayer(TILE_SATELLITE, { attribution: ATTR_SAT, maxZoom: 18 })
    ).addTo(map);
    tileRef.current.bringToBack();
    setIsSatellite(!isSatellite);
  }, [map, isSatellite]);

  const filtered = regions.filter((r) =>
    `${regionName(r.region)} ${r.region}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <section className="relative w-full" style={{ height: '72vh', minHeight: 480 }}>
      <div ref={mapRef} className="absolute inset-0 z-0 rounded-b-2xl overflow-hidden" />

      <button
        onClick={toggleTile}
        className="absolute top-3 right-3 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/90 backdrop-blur border border-stone-200 text-xs font-medium text-stone-600 hover:bg-white shadow-sm transition-colors"
      >
        <Layers className="w-3.5 h-3.5" />
        {isSatellite ? 'Mapa Callejero' : 'Vista Satelital'}
      </button>

      {/* Leyenda del mapa */}
      {year && (
        <div className="absolute bottom-3 left-3 z-20 px-3 py-2 rounded-xl bg-white/90 backdrop-blur border border-stone-200 shadow-sm text-[11px] text-stone-600">
          <div className="font-semibold text-stone-700 flex items-center gap-1.5">
            Actividad armonizada {year}
            {hex.loading && <Loader2 className="w-3 h-3 animate-spin text-orange-500" />}
          </div>
          {hex.meta && (
            <div className="text-stone-400">
              {hex.meta.n_cells.toLocaleString('es-AR')} hexágonos H3 res {hex.meta.res}
              {hex.meta.truncated && ' (los de mayor actividad)'}
            </div>
          )}
          {hex.error && <div className="text-orange-600">{hex.error}</div>}
        </div>
      )}

      {/* Panel flotante */}
      <div className="absolute top-3 left-3 z-20 w-72">
        <div className="bg-white/95 backdrop-blur-md rounded-2xl shadow-lg border border-stone-200 overflow-hidden">
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
                      key={r.region}
                      onClick={() => { setRegion(r.region); setSearch(''); }}
                      className={`w-full text-left px-2 py-1.5 rounded-lg text-xs transition-colors flex items-center gap-1.5 ${
                        region === r.region ? 'bg-orange-50 text-orange-700 font-medium' : 'text-stone-600 hover:bg-stone-50'
                      }`}
                    >
                      {region === r.region && <Check className="w-3 h-3 text-orange-500" />}
                      <span className={region === r.region ? '' : 'ml-[18px]'}>{regionName(r.region)}</span>
                      <span className="ml-auto text-[10px] text-stone-400">
                        {r.period.start.slice(0, 4)}–{r.period.end.slice(0, 4)}
                      </span>
                    </button>
                  ))}
                  {!regions.length && <p className="text-xs text-stone-400 px-2 py-1">Cargando regiones…</p>}
                </div>
              </div>

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
