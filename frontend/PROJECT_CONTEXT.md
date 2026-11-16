# Contexto del Proyecto: ViSU · Focos de calor armonizados del Cono Sur

> Contexto maestro del frontend para IAs de diseño y programación.

## 1. Producto

**ViSU** visualiza **26 años (2000–2026) de focos de calor armonizados** de NASA FIRMS. MODIS (Terra, Aqua) y VIIRS (S-NPP, NOAA-20, NOAA-21) se integran como una única constelación virtual. Cubre `ARG`, `BOL`, `CHL`, `PRY` y `URY`. Los datos llegan del backend FastAPI + DuckDB (`backend/`, rutas `/api/v1`).

La interfaz usa un tema claro con la paleta de fuego ámbar → rojo intenso y tiene dos rutas:

| Ruta | Contenido |
| :--- | :--- |
| `/` | Mapa MapLibre con hexágonos H3, tooltip, 3D y mapas base. **Panel fijo** (no colapsa): país → botón único de descarga CSV (diario, país + rango) → rango de años (histograma + slider doble) → botones **Calendario** y **Estadísticas** → mensaje *"Ventana activa, {País}: definitivo (SP) hasta …, provisorio (NRT) hasta …"*. KPIs como **menús desplegables animados** (hover / toque). Único lugar donde se cambian país y fechas. |
| `/Calender-Statistics?vista=calendario\|estadisticas` | Vista de **solo lectura** (una a la vez, con pestañas). Ambas **respetan el país y el rango de años del mapa**: el calendario ofrece solo los años del rango (año en foco local dentro de él); estadísticas muestran KPIs, serie y anomalías/ranking del rango (la banda "normal" de la comparativa sigue siendo histórica). CSV disponible en ambas, siempre filtrado por país + rango. |

El usuario final no ve satélites individuales: la armonización abstrae el sensor.

## 2. Stack

React 18 · Vite 6 · React Router 6 · Tailwind 3.4 · `maplibre-gl` 4 · `recharts` 2 · `framer-motion` 11 · `lucide-react`. Tipografías: Inter, Space Grotesk (cifras) y JetBrains Mono (métricas).

## 3. Arquitectura (`src/`)

```text
main.jsx            BrowserRouter
App.jsx             FireDataProvider + rutas animadas + splash
pages/              MapPage · CalendarStatsPage
hooks/              useFireData (estado) · FireDataContext (useFD) · useQuery (caché SWR)
data/               api.js · transform.js · csv.js · constants.js (rampa FIRE_*) · presets.js
components/
  layout/           Navbar · Brand
  controls/         ControlPanel · CountrySearch · YearRangeBar · CsvDownload
  map/              MapCanvas · fireLayers · useHexSource · useCellHover · CellTooltip · MapLegend · MapToolbar · basemaps
  kpi/              useKpiItems · KpiStrip (tarjetas) · KpiDropdowns (menús) · KpiParts
  timeline/         CalendarTab · SeriesTab · SeriesChart · SeriesTooltip · seriesRows · ComparisonTab
  ui/               primitives (Skeleton, AnimatedNumber, TierChip, NrtChip, ProgressLine)
```

## 4. Estado (`useFD()`)

- `region`, `setRegion`, `regionInfo`: **sin país predeterminado**; hasta que el usuario elige, no hay métricas ni rango y Calendario/Estadísticas muestran un aviso para volver al mapa.
- `range {start, end, preset}`: ventana temporal única, **siempre alineada a años completos** (1 Ene → 31 Dic, recortada a los datos). Arranca en `recent` (los 2 últimos años) y se cambia solo desde el mapa con `setYearWindow` / `setCustomWindow`. `rangeYears` / `inRange` (presets.js) filtran por años.
- `viewport` y `scope`: el mapa reporta su vista. La ruta de estadísticas lo resetea para trabajar con la región completa.
- `summary`, `monthly`, `daily`: consultas `{data, loading, error}`.
- `downloadCSV()`: un registro por día del país y rango de años elegidos en el mapa (sin selector de agregación); incluye `detecciones_nasa`.

## 5. Reglas de diseño

1. Fondo azul: `.bg-app` (azul noche `night-900` #0E1937, el del logo, con brillos de #050077 y del cian `beam` #1FACC7); navbar `night-900`. Tarjetas `.card` y paneles `.glass` en **azul noche translúcido** con texto claro (los gráficos y el calendario usan colores para fondo oscuro). Mapa base predeterminado: satélite. Logo: `public/logo.jpeg` (también favicon) junto al nombre ViSU.
   - **Interfaz = azul institucional `brand` (#050077) y azul noche `night`**: marca, fondo, recuadros y foco. **Botones blancos con texto azul noche** (`.btn-primary` / `.btn-secondary`, `.pill-active`, sección activa de la barra). Atribución del mapa plegada en un ícono ⓘ (obligatoria por licencia).
   - **Datos = fuego** (`fire-*`, `FIRE_STOPS`): hexágonos, calendario, serie, valores sobre lo normal. "Bajo lo normal" / descenso interanual en azul (`#2B27B0`).
2. Los focos siempre usan `FIRE_STOPS` / `fireColor()`. La confiabilidad baja va en violeta y el NRT en rojo/naranja punteado. Los días sin dato llevan rayado gris y nunca se muestran como cero.
3. Animaciones con framer-motion: pastillas con `layoutId`, números animados, revelado al hacer scroll y transición entre rutas. Respetar `prefers-reduced-motion`.
4. Archivos de menos de ~150 líneas. Consumir `useFD()`; los pedidos nuevos van por `api.js` + `useQuery`.
