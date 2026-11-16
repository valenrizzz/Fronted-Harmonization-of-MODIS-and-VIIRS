# Datos_Para_La_Web — almacén de focos de incendio armonizados (MODIS + VIIRS)

Carpeta **autocontenida** para alimentar el backend y el frontend. No requiere el pipeline de cálculo: alcanza con leer los archivos Parquet o JSON, por ejemplo con DuckDB.
Cada región vive en su propia subcarpeta (hoy `ARG/`, `BOL/`, `CHL/`, `PRY/` y `URY/`), con exactamente la misma estructura y esquemas, y se reemplaza de forma atómica en cada actualización.

## Regiones disponibles

Las cinco se procesan con el **mismo método** (corrida del 2026-11-15):
- factor por mes del año con suavizado armónico, **contraído hacia el factor anual** en los meses con pocos datos y **elegido por validación cruzada** en cada par de constelaciones;
- veto regional de caídas de satélites;
- referencia `Terra+Aqua+SNPP+NOAA20+NOAA21`;
- período 2000-11-01 → 2026-11-14.

| Región | `calibration_version` | Capa SP (días solares · eventos) | Capa NRT (días solares · eventos) |
|---|---|---|---|
| `ARG` | `ARG-cal-1a9cec898caf` | 2000-11-01 → 2026-07-30 · 2.559.422 | 2026-07-31 → 2026-11-14 · 48.166 |
| `BOL` | `BOL-cal-7f0886f53261` | 2000-11-01 → 2026-07-31 · 2.588.472 | 2026-08-01 → 2026-11-14 · 62.046 |
| `CHL` | `CHL-cal-29f092de68ea` | 2000-11-01 → 2026-07-31 · 264.316 | 2026-08-01 → 2026-11-14 · 3.036 |
| `PRY` | `PRY-cal-14ccff1819ab` | 2000-11-01 → 2026-07-31 · 1.630.619 | 2026-08-01 → 2026-11-14 · 25.114 |
| `URY` | `URY-cal-c203251357e9` | 2000-11-02 → 2026-07-31 · 61.438 | 2026-08-02 → 2026-11-12 · 1.522 |

> **Qué se corrigió respecto de la primera corrida**
> - **Caídas de satélites falsas.** En países chicos o húmedos, los días sin fuego se marcaban como "sin dato" y creaban épocas de calibración espurias. Con el veto regional, `PRY` bajó de 259 a 29 días *sin dato*, y el peso `low`, de 63% a 17%.
> - **Factores extremos en meses con pocos datos.** `URY`, época solo Terra: el factor de junio y julio era ×86, estimado con 12 eventos; ahora es ×38, y la amplitud estacional bajó de ×6,1 a ×1,6. `CHL`: septiembre de 2002–2012 bajó de ×9,5 a ×8,4.
> - **Método por par.** Cuando el factor anual único predice mejor que el estacional, se usa el anual (`selected_method` en `metadata/calibration_report.json`).
> - **`CHL` continental.** Se excluyen Isla de Pascua, Juan Fernández y Desventuradas (`clip_bbox` en `config/regions.yaml`).
>
> **Para tener en cuenta**
> - En `URY` (y en parte de `CHL`) la corrección de los años MODIS es grande: el factor Terra+Aqua es ≈ ×7. Por eso una parte importante del peso queda en confiabilidad `low`. Para esos días y meses, la app muestra el **conteo original de la NASA** (`nasa_detections`).
> - Los días *sin dato* que quedan coinciden con caídas reales de satélites; por ejemplo, Terra del 15-jun al 2-jul de 2001. La API de FIRMS tampoco tiene detecciones esos días, y se publican en `GET /api/v1/outages`.

> **Fuente de verdad de cada región: `<REGIÓN>/manifest.json`.** Contiene la versión de calibración, el corte SP/NRT, los conteos, el esquema de cada tabla y el sha256 de cada archivo. Leelo al iniciar el backend en lugar de fijar valores en el código.

## Detalle — `ARG`

| | |
|---|---|
| Periodo | 2000-11-01 → 2026-11-14 |
| `calibration_version` | `ARG-cal-1a9cec898caf` |
| Calibración | Factor por mes del año con suavizado armónico (2 términos), contraído hacia el factor anual (100 eventos de pseudo-observación por mes) y elegido por validación cruzada en cada par, **interpolado día a día**; cada cociente se estima con los 2 años más cercanos a la época que calibra; referencia `Terra+Aqua+SNPP+NOAA20+NOAA21` |
| Capa **SP** (definitiva) | 2000-11-01 → **2026-07-30** · 2.559.422 eventos |
| Capa **NRT** (provisoria) | **2026-07-31** → 2026-11-14 · 48.166 eventos |
| Filtros de calidad | 761 celdas excluidas (fuentes fijas y falsas alarmas MODIS, SP y NRT); 179 días-satélite con caída detectada (10 vetados por actividad regional); 27 días sin ningún satélite → *sin dato* |

El corte se calcula solo, en dos pasos:
1. **Fecha UTC (`sp_cutoff`)**: la última en que todos los satélites que siguen enviando datos tienen producto científico (SP). Hoy MODIS SP llega al 2026-08-31, pero S-NPP, NOAA-20 y NOAA-21 SP llegan al 2026-07-31.
2. **Día solar (`sp_cutoff_solar_day`)**: los eventos se fechan por día solar local, y en longitudes oeste un día solar incluye horas UTC del día siguiente. Por eso el último día solar 100% SP es el **2026-07-30**: el 31 de julio solar ya contiene detecciones NRT del 1 de agosto UTC.

## Estructura

```
Datos_Para_La_Web/
├── README.md
└── ARG/
    ├── manifest.json                  versión, corte SP/NRT, esquemas, sha256 y filas por archivo
    ├── events/                        eventos celda H3 × día (Parquet zstd, particionado hive)
    │   ├── layer=SP/year=2000 … 2026/part_0.parquet
    │   └── layer=NRT/year=2026/part_0.parquet
    ├── timeseries_daily.parquet       serie diaria observada y armonizada con IC 95%
    ├── timeseries_monthly.parquet     serie mensual (también en .json para el frontend)
    ├── timeseries_monthly.json
    ├── calibration_factors.parquet    K por constelación × mes, con IC y calidad (también .json)
    ├── calibration_factors.json
    ├── calibration_factors_daily.parquet  K por constelación × día del año (el que se aplica a cada evento)
    ├── h3_region_map.parquet          celda H3 res 7 → región (+ padres res 3 y 5, centroide)
    └── metadata/                      linaje: informe de calibración, descartes, fuentes, cobertura, configuración,
                                       satellite_outages.csv (caídas detectadas) y static_source_cells.parquet (fuentes fijas)
```

**Actualización.** La partición `layer=NRT` es provisoria y se reescribe completa en cada refresco. Cuando FIRMS publica el SP de un mes, esos eventos pasan a `layer=SP` y cambia el corte en `manifest.json`. Una consulta siempre lee las dos capas juntas; filtrá por `layer` solo si necesitás distinguir lo definitivo de lo provisorio.

## Conceptos clave

- **Evento**: una celda H3 de resolución 7 (~5 km²) con fuego en un **día solar local** (`solar_date` = UTC + longitud/15 h). Agrupa todas las detecciones de todos los satélites de ese día.
- **`harmonized_weight`**: cuánto vale el evento en unidades de la constelación moderna de 5 satélites. **Sumar `harmonized_weight` en cualquier recorte (región, polígono o período) da el conteo armonizado**, comparable entre 2000 y hoy. Vale 0 si el evento solo tiene detecciones de confianza baja (`in_series = false`): esos eventos se conservan para mapas y alertas, pero no entran en la serie.
- **`weight_ci_low` / `weight_ci_high`**: el intervalo de confianza del 95% del peso. Su suma da un intervalo conservador para un recorte arbitrario. Para la serie de toda la región, usá las columnas `events_harmonized_ci_*` de las series, que son exactas.
- **`reliability_tier`**: confiabilidad de la corrección para esa constelación y ese mes.

  | Valor | Condición | Épocas |
  |---|---|---|
  | `high` | K ≤ 1,5 y semiancho relativo del IC ≤ 5% | 2018 en adelante |
  | `medium` | K ≤ 5 y semiancho relativo del IC ≤ 10% | Terra+Aqua (2002–2012) en jul–mar, y toda la época con S-NPP (2012–2018) |
  | `low` | el resto | solo Terra (2000–2002), abril–junio de 2002–2012, y los días de caída en que solo operaba Aqua |

- **`layer`**: `SP` (científico, definitivo) o `NRT` (provisorio). En la serie mensual puede valer `MIXED` si el corte cae dentro de un mes.
- **El sensor queda abstraído**: `satellites`, `epoch_id` y las columnas `sat_mask*` son solo linaje. La app no necesita usarlos.

## Esquemas

### `events/` (1 fila = celda × día)
| Columna | Tipo | Descripción |
|---|---|---|
| `region` | str | Código de región (ISO3) |
| `layer` | str | `SP` / `NRT` (clave de partición) |
| `year` | int | Año de `solar_date` (clave de partición) |
| `solar_date` | date | Día solar local del evento |
| `month_of_year` | int8 | 1–12 |
| `doy` | int16 | Día del año (1–366), clave del factor diario |
| `h3_index` | str | Celda H3 res 7 en hexadecimal (para deck.gl `H3HexagonLayer`) |
| `h3_cell` | uint64 | La misma celda como entero (para extensiones H3 de DuckDB o PostGIS) |
| `h3_r3`, `h3_r5` | uint64 | Celdas padre de res 3 (orden físico, poda de lectura) y res 5 (mapa con zoom bajo) |
| `cell_lat`, `cell_lon` | float64 | Centroide de la celda |
| `epoch_id` | str | Constelación activa ese día |
| `in_series` | bool | Tiene alguna detección de confianza nominal o alta |
| `harmonized_weight` | float64 | Factor K de (constelación, mes) si `in_series`; si no, 0 |
| `weight_ci_low`, `weight_ci_high` | float64 | IC 95% del peso |
| `reliability_tier` | str | `high` / `medium` / `low` |
| `calibration_version` | str | Versión de los factores usados |
| `n_raw_detections` | uint32 | Detecciones crudas colapsadas en el evento |
| `n_satellites`, `satellites` | uint8, str | Satélites que lo vieron (linaje) |
| `n_modis_detections`, `n_viirs_detections` | uint32 | Detecciones por instrumento |
| `sat_mask`, `sat_mask_series` | int32 | Bits de satélites (todas las confianzas / confianza nominal o alta) |
| `frp_max`, `frp_mean` | float32 | Potencia radiativa del fuego en MW, calculada sobre detecciones con FRP válido; nulo si ninguna lo tiene. `frp_max` es la métrica principal. **No armonizada entre sensores.** |
| `frp_quality` | str | `ok`; `partial` (alguna detección sin FRP); `missing` (ninguna con FRP: FIRMS informó 0); `extreme` (alguna detección por encima de 5.000 MW: píxeles MODIS grandes de borde de barrido, se conserva pero es incierta) |
| `max_confidence`, `max_confidence_rank` | str, int8 | `low`/`nominal`/`high` (0/1/2): la mayor confianza de detección del evento |
| `first_detection_utc`, `last_detection_utc` | timestamp UTC | Primera y última detección |
| `is_provisional` | bool | Todas sus detecciones son NRT |
| `n_provisional_detections` | uint32 | Cuántas de sus detecciones son NRT (un evento NRT puede mezclar MODIS SP y VIIRS NRT) |

### `timeseries_daily` / `timeseries_monthly`
| Columna | Descripción |
|---|---|
| `date` (diaria) / `month` (mensual, primer día del mes) | Fecha |
| `layer` | `SP` / `NRT` (`MIXED` solo en la mensual) |
| `epoch_id` (diaria) / `epochs` (mensual) | Constelación activa ese día, ya descontadas las caídas de satélites detectadas |
| `observation_flag` (diaria) | `ok`; `no_satellite` (ningún satélite operativo: valores nulos); `suspect_zero` (racha de 3 días o más con 0 eventos y satélites activos que no alcanzó a clasificarse como caída: puede ser falta de fuego o una caída no confirmada) |
| `days_suspect_zero` (mensual) | Días del mes marcados `suspect_zero` |
| `events_observed` | Eventos crudos de la serie (confianza nominal o alta) |
| `events_all_confidence` | Eventos incluyendo confianza baja (sin armonizar) |
| `doy`, `k_factor`, `k_factor_ci_low`, `k_factor_ci_high` (diaria) | Factor aplicado ese día del año y su IC 95% |
| `events_harmonized`, `events_harmonized_ci_low`, `events_harmonized_ci_high` | **Serie armonizada** e IC 95%. La mensual usa el mismo bootstrap que la diaria, así que su IC es coherente. |
| `days_observed`, `days_in_month`, `coverage_frac` (mensual) | Días con al menos un satélite operativo / días del mes |
| `events_harmonized_gapfilled` (+ `_ci_low`, `_ci_high`) (mensual) | Serie armonizada re-escalada a mes completo (`× days_in_month / days_observed`). Usar para comparar meses con días sin dato. |
| `reliability_tier` | Diaria: la de ese día. Mensual: la peor del mes. |
| `calibration_version` | Versión de los factores |

### `calibration_factors` (por mes) y `calibration_factors_daily` (por día del año)
`calibration_factors_daily`: `active_mask`, `epoch_id`, `doy`, `k_factor`, `k_ci_low`, `k_ci_high`, `calibration_version`. Es el factor que realmente se aplica: la interpolación circular de los factores mensuales, exacta en el centro de cada mes y sin escalones entre meses.

`calibration_factors`: `epoch_id`, `month_of_year`, `k_factor`, `k_ci_low`, `k_ci_high`, `k_rel_ci_halfwidth`, `reliability_tier`, `calibration_path` (cadena de cocientes hasta la constelación de referencia), `n_days`, `calibration_version`.

## Consultas de ejemplo (DuckDB)

```sql
-- Vista sobre los eventos (las dos capas)
CREATE VIEW ev AS
SELECT * FROM read_parquet('Datos_Para_La_Web/ARG/events/*/*/*.parquet', hive_partitioning = true);

-- 1. Serie mensual para el gráfico
SELECT month, events_harmonized, events_harmonized_ci_low, events_harmonized_ci_high, layer, reliability_tier
FROM 'Datos_Para_La_Web/ARG/timeseries_monthly.parquet' ORDER BY month;

-- 2. Conteo armonizado en un rectángulo y período (filtrar por year poda particiones)
SELECT sum(harmonized_weight) AS armonizado, sum(weight_ci_low) AS ci_low, sum(weight_ci_high) AS ci_high
FROM ev
WHERE year = 2020 AND solar_date BETWEEN DATE '2020-08-01' AND DATE '2020-08-31'
  AND cell_lat BETWEEN -35 AND -29.5 AND cell_lon BETWEEN -65.8 AND -61.8;

-- 3. Hexágonos para el mapa de un día (deck.gl H3HexagonLayer usa h3_index)
SELECT h3_index, frp_max, max_confidence, harmonized_weight, layer
FROM ev WHERE solar_date = DATE '2026-11-10';

-- 4. Mapa agregado con zoom bajo (res 5), en hexadecimal para el frontend
SELECT printf('%x', h3_r5) AS h3_index_r5, sum(harmonized_weight) AS armonizado, max(frp_max) AS frp_max
FROM ev WHERE year = 2024 GROUP BY h3_r5;

-- 5. Solo lo definitivo (por ejemplo, para tendencias o anomalías publicadas)
SELECT year, sum(harmonized_weight) FROM ev WHERE layer = 'SP' GROUP BY year ORDER BY year;
```

Desde Python:

```python
import duckdb
con = duckdb.connect()
df = con.sql("SELECT * FROM 'Datos_Para_La_Web/ARG/timeseries_monthly.parquet'").pl()   # o .df()
```

El frontend puede cargar `timeseries_monthly.json` directamente: es un arreglo de registros con `month` en formato ISO `YYYY-MM-DD`.

## Advertencias para mostrar al usuario final

0. **Días sin dato ≠ días sin fuego.** Si no había ningún satélite operativo (por ejemplo, la caída de Terra entre 2001-06-15 y 2001-07-02), `events_observed` y `events_harmonized` son **nulos**, no 0. En la serie mensual, `coverage_frac < 1` marca esos meses: 7 meses de 2001–2002. Para comparar meses, usá `events_harmonized_gapfilled`.

1. **Incertidumbre estructural del tramo inicial.** Según la ventana de años con que se estime el aporte de Aqua, los totales de 2001 cambian un 14% y los de 2002 un 7% (2003–2026: ±3%). Ese rango supera el IC del bootstrap. El tramo **2000-11 → 2002-07** (solo Terra) y los meses de abril a junio de 2002–2012 tienen `reliability_tier = low`: correcciones grandes con más incertidumbre. Conviene mostrarlos con su banda de IC o atenuados.
2. La capa **NRT** es provisoria y puede cambiar cuando llegue el producto científico.
3. Los intervalos de confianza reflejan la incertidumbre de la calibración, no la variabilidad natural del fuego.
4. El FRP no está armonizado entre MODIS y VIIRS: comparar FRP antes y después de 2012 con cautela.
5. Los eventos `in_series = false` (solo confianza baja) aparecen en el mapa pero no en la serie: sirven como indicio temprano para alertas.
