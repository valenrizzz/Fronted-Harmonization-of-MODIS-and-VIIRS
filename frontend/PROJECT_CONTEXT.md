# Contexto del Proyecto: FireWatch · Plataforma de Monitoreo de Focos de Calor

> **Propósito de este documento:** Servir de contexto maestro para IAs de diseño, arquitectura y programación. Describe el estado actual del proyecto, la arquitectura modular, el sistema de diseño y las reglas de integración para nuevas pantallas y características.

---

## 1. Visión General del Producto

**FireWatch** es una plataforma analítica y geoespacial interactiva de alcance global diseñada para armonizar **26 años de registros históricos de focos de calor (2000–2026)** provenientes de las misiones **MODIS** (Terra, Aqua) y **VIIRS** (S-NPP, NOAA-20, NOAA-21) de NASA FIRMS en una única línea temporal continua y libre de sesgos.

* **Propuesta de Valor (Constelación Virtual Única):** Elimina la discontinuidad histórica y la inflación artificial de conteos entre sensores mediante discretización en grilla espacial fija (`0.01°` / ~1.1 km), corrección por hora solar local (`lon / 15`), colapso diario multi-satélite y calibración estacional ($\alpha_m$) sobre la ventana de solapamiento (2012–2022), logrando que los 5 satélites operen estadísticamente como un único sensor global.
* **Experiencia de Usuario (Flujo Vertical Único / Scrollytelling Analítico):** Diseño limpio, luminoso y de lectura inmediata organizado en tres bloques verticales secuenciales sin superposición invasiva:
  1. **Explorador Geoespacial (Vista Inicial / Hero):** Planisferio interactivo (vista satelital *Blue Marble / World Imagery* y mapa callejero) con bordes de países seleccionables al hacer clic y un panel flotante compacto a la izquierda para filtrar en cascada (`País` → `Provincia/Estado` → `Ciudad`) y configurar satélites/fechas.
  2. **Calendario Anual de Actividad de Fuego (Scroll Nivel 1):** Matriz de 12 meses con paleta cálida solar/terracota de alto contraste, conteo diario dentro de cada celda (celdas sin actividad en blanco) y selector rápido de años.
  3. **Comparativa Histórica y Anomalías (Scroll Nivel 2):** Tarjetas de resumen KPI, gráfico de línea/área comparando el año seleccionado frente a la mediana histórica y banda habitual (percentil 25–75), gráfico de barras divergentes de anomalía interanual y exportación granular en CSV.
* **Arquitectura Escalable:** Pipeline ETL en *streaming* (`DuckDB` + `Parquet`) optimizado para procesar volúmenes masivos (10 GB+) a escala mundial con bajo consumo de RAM, conectado mediante una API REST (`FastAPI`) a una interfaz reactiva (`React` + `Vite` + `Tailwind CSS`).

---

## 2. Stack Tecnológico & Dependencias
- **Runtime:** Node.js v26 LTS
- **Build tool:** Vite 6
- **Frontend Core:** React 18 (Functional Components + Custom Hooks)
- **Estilos:** Tailwind CSS 3.4 (con paleta cálida luminosa *Earth & Sunlit Ember*)
- **Iconografía:** `lucide-react`
- **Mapeo:** Leaflet 1.9 + `react-leaflet` 4
- **Tipografía:** Inter (UI) y JetBrains Mono (cifras y métricas)

---

## 3. Arquitectura del Código (`frontend/`)

El código sigue el principio de **componentes atómicos desacoplados**: ningún archivo supera las 150 líneas para optimizar mantenibilidad y lectura de contexto.

```text
frontend/
├── index.html
├── package.json
├── tailwind.config.js
├── vite.config.js
└── src/
    ├── main.jsx                          # Entry point
    ├── index.css                         # Clases utilitarias y overrides Leaflet
    ├── App.jsx                           # Orquestador principal (Flujo Vertical Único)
    │
    ├── hooks/
    │   └── useFireData.js                # Estado global: región, provincia, ciudad, año y métricas
    │
    ├── data/
    │   ├── mockFireService.js            # Servicio estocástico con estacionalidad real (2000-2026)
    │   └── worldCountries.geo.json       # Límites livianos de países para selección por clic
    │
    └── components/
        ├── Navbar.jsx                    # Header blanco translúcido: breadcrumb, satélites, rango temporal (107 lín.)
        ├── WorldMapHero.jsx              # Bloque 1: Planisferio Leaflet 72vh + panel flotante izquierdo (148 lín.)
        ├── FireCalendarSection.jsx       # Bloque 2: Grilla 3×4 + YearPills + ColorLegend (91 lín.)
        ├── DayCell.jsx                   # Celda diaria: escala Earth & Sunlit Ember, picos P90, tooltips
        ├── YearPills.jsx                 # Píldoras horizontales 2000–2026
        ├── ColorLegend.jsx               # Leyenda visual de intensidad
        └── HistoricalAnalyticsSection.jsx # Bloque 3: 4 KPIs + SVG línea/área P25-P75 + barras anomalía + CSV (132 lín.)
```

---

## 4. Estado y Flujo de Datos (`useFireData`)
El estado principal se gestiona en `src/hooks/useFireData.js`. Cualquier nuevo componente que requiera datos o filtros debe consumir este hook o recibir sus variables:

| Variable | Tipo | Descripción |
| :--- | :--- | :--- |
| `region` | `string` | Región activa (`Global`, `Argentina`, `Brasil - Amazonia Sur`, etc.) |
| `setRegion` | `function` | Cambia la región activa (recalcula automáticamente todas las métricas) |
| `year` | `number` | Año seleccionado en el calendario (ej. `2025`) |
| `setYear` | `function` | Cambia el año del calendario |
| `data` | `object` | Objeto con: `daily`, `monthlyTotals`, `yearlyTotals`, `medianByMonth`, `medianYearly`, `percentiles`, `topYears`, `center`, `zoom`, `hotspots` |
| `downloadCSV` | `function(agg)` | Descarga un `.csv` según agregación: `'Día' \| 'Semana' \| 'Mes' \| 'Año' \| 'Total crudo'` |

---

## 5. Reglas de Diseño UI/UX (Nueva Paleta Luminosa "Earth & Sunlit Ember")
1. **Tema Claro, Cálido y Energético:** Fondo base alabastro cálido (`#FAF8F5`), tarjetas elevadas en blanco puro (`#FFFFFF`) con bordes suaves (`border-stone-200/80`) y sombras sutiles (`shadow-sm`), texto principal en carbón profundo (`#1C1917`).
2. **Escala de Calor del Calendario (Amigable y de Alto Contraste):**
   - **0 focos:** Cuadro vacío y limpio en gris arena muy suave (`#F5F5F4`) sin número.
   - **Actividad baja a moderada:** Crema solar a ámbar dorado (`#FEF3C7` → `#FCD34D` → `#FB923C`).
   - **Actividad alta y picos críticos (Percentil 90):** Naranja terracota intenso a carmesí cálido (`#EA580C` → `#9A3412`) con indicador visual de pico.
3. **Semántica de Anomalías en Gráficos:** Naranja vibrante (`#EA580C`) para valores por encima de la mediana histórica (`+ %`) y azul oceánico limpio (`#2563EB`) para valores por debajo de lo normal (`- %`).
4. **Métricas en Mono:** Todos los contadores, porcentajes y fechas clave usan `font-mono`.

---

## 6. Hoja de Ruta Actualizada
- [x] **Base Modular y Mock Service (`useFireData` + `mockFireService`):** Lógica de armonización, percentiles y exportación CSV funcionando.
- [x] **Refactorización a Flujo Vertical + Tema Luminoso (Completada):**
  - Bloque 1: Planisferio satelital interactivo (Esri World Imagery + toggle OSM) con panel flotante izquierdo (`País` / `Provincia` / `Ciudad`) y scroll CTA.
  - Bloque 2: Calendario anual de 12 meses con paleta Earth & Sunlit Ember (crema→terracota→carmesí), tooltips y alertas P90.
  - Bloque 3: 4 KPIs + gráfico de línea/área (año vs mediana con banda P25-P75) + barras divergentes de anomalía (naranja/azul) + exportación CSV granular.
- [ ] **Conexión con Backend Real (`FastAPI`):** Reemplazar `mockFireService.js` por endpoints reales de `http://localhost:8000/api/...`.

---

## 7. Instrucciones para la IA que genere nuevo código
1. **Protocolo Anti-Corte de Tokens (`AGENT_LOG.md`):** Trabajar de a **un solo archivo por vez** e inmediatamente después actualizar `AGENT_LOG.md` marcando el archivo como `[COMPLETADO]` y registrando el siguiente paso antes de continuar.
2. **No leer datos crudos:** Ignorar `Data_MODIS/`, `Data_VIIRS/` y `data_processed/`.
3. **Mantener archivos pequeños:** Menos de 150 líneas por archivo. Reemplazar los componentes legacy del tema oscuro por los definidos en la Sección 3.
4. **Consumir `useFireData`:** Utilizar los datos calculados por `mockFireService.js` (extendiendo el hook con `province`, `city` y `satelliteFilter`) para mantener coherencia entre el mapa, el calendario y los gráficos.
5. **Tailwind puro:** Usar `lucide-react` para iconos y clases utilitarias de Tailwind siguiendo la paleta *Earth & Sunlit Ember* (Sección 5).
