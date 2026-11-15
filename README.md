# Armonización de hot-spots MODIS + VIIRS (NASA FIRMS)

Serie temporal única y comparable de actividad de incendios (2000-11 → presente),
agnóstica de región. Caso de prueba: **Argentina (`ARG`)**.

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python cli.py run --region ARG          # cualquier ISO3 funciona: CHL, BRA, ...
.venv/bin/python cli.py export-web --region ARG   # solo re-exporta Datos_Para_La_Web/ARG (run ya lo hace)
.venv/bin/python -m pytest -q tests
```

La MAP_KEY de FIRMS se lee de la variable `FIRMS_MAP_KEY` o del archivo `.env` (no versionado).

## Etapas

| # | Módulo | Qué hace |
|---|---|---|
| 1 | `catalog.py`, `ingest.py` | Descubre los CSV de FIRMS en las carpetas configuradas (lectura *in-place*, sin copiar), los clasifica (por país/año, descarga global SP/NRT, API) y con DuckDB escribe una copia Parquet **solo con las filas del bbox** de la región. Caché incremental por tamaño+mtime. |
| 1b | `firms_api.py` | Calcula los huecos de cobertura por familia de satélite y **solo** esos días los pide a la API de área (SP si existe, si no NRT). |
| 2 | `standardize.py` | Esquema canónico, filtro por polígono, duplicados entre archivos, NRT reemplazado por SP, confianza ordinal, solo vegetación (`type=0`) y máscara de fuentes estáticas para NRT, celda H3, día solar local, constelación activa. |
| 3 | `dedup.py` | Colapsa a **celda H3 res 7 × día solar** = 1 evento, con FRP máx./medio, conteos crudos y satélites que lo vieron. |
| 4 | `calibrate.py` | Corrección del sesgo de constelación (ver abajo). |
| 4b | `export_web.py` | Almacén autocontenido `Datos_Para_La_Web/<R>/` (capas SP/NRT, versión de calibración, calidad). Ver `Datos_Para_La_Web/README.md`. |

## Decisiones metodológicas

- **Región**: país por ISO3 (Natural Earth 1:10m v5.1.2, `ADM0_A3`), bbox o GeoJSON. No hace falta un YAML por país.
- **Día**: día *solar local* (`UTC + lon/15 h`), no requiere zona horaria y es igual en cualquier región.
- **Confianza**: MODIS <30 baja, 30–79 nominal, ≥80 alta; VIIRS l/n/h. **No se descarta nada por confianza**: los eventos `low` quedan en `events_daily` (útiles para alertas). La serie armonizada y la calibración usan confianza ≥ nominal.
- **FRP**: `frp_max` por celda-día como métrica principal (no depende del número de pasadas); `frp_mean` como complemento. FRP = 0 de FIRMS se publica como nulo (`frp_quality='missing'`); más de 5.000 MW se conserva marcado `extreme`. El FRP **no** está armonizado entre sensores.
- **Calibración (factor por mes del año, por defecto)**: en cada época se *simula* la constelación anterior quitando satélites (máscara de bits por evento). El cociente de totales `r = eventos(Y)/eventos(X)` sobre los mismos días mide la ganancia por revisita + resolución. Encadenando cocientes entre épocas consecutivas se obtiene `K` por constelación **y mes del año**, expresado en unidades de la constelación de referencia (la más completa). Los 12 cocientes de cada par se suavizan de forma circular (dic↔ene) en escala log, ponderando por eventos: ajuste armónico de 2 términos (`smoothing.method: harmonic`) o media móvil de 3 meses (`moving_average`), re-escalados para conservar el total de la ventana. `factor_scope: global` vuelve al factor único. IC 95% por bootstrap estratificado por mes del año (se repite el ajuste en cada réplica); validación cruzada temporal (estimar en la 1ª mitad de la ventana, predecir la 2ª).
- **Ventana de cada cociente**: los días en que el superconjunto del par es exactamente la constelación activa, limitados a los **2 años más cercanos** a la época que se calibra (`proximity_years`). La ganancia de sumar un satélite cambia con los años: Aqua aportó cerca de 15% más en 2002–2003 que el promedio 2002–2012.
- **Factor diario**: los 12 factores mensuales se interpolan de forma circular por día del año (`daily_interpolation`), sin escalones al cambiar de mes.

### Supuestos y límites (explícitos)
1. El factor supone que la ganancia relativa entre constelaciones depende del mes del año pero no del año ni de la zona dentro de la región. `calibration_report.md` muestra el cociente por año y la validación cruzada de los 4 métodos (global, mensual crudo, media móvil, armónico).
2. Los IC reflejan la incertidumbre de calibración, no la variabilidad del fuego.
3. La actividad diaria de cada satélite se infiere de los datos: un satélite que no aporta detecciones cuando se esperaban (por cociente con el resto o por climatología, y por rachas) se considera **caído** ese día (`availability` en `pipeline.yaml`; registro en `lineage/<R>/satellite_outages.csv`). Los días sin ningún satélite son *sin dato*, no 0. Una racha corta de ceros con pocas detecciones esperadas (por ejemplo, Terra en otoño de 2002) no se puede distinguir de una semana sin fuego y queda como observada.
4. Celdas excluidas: además del `type` de FIRMS (por píxel), se excluyen **celdas H3** en SP y NRT por igual con 5 reglas: `persistent`, `flare`, `typed`, `chronic` (mecheros, refinerías, industrias) y `modis_only` (falsa alarma persistente de MODIS que VIIRS, más sensible, nunca confirma). Parámetros en `filters.static_sources`; registro en `lineage/<R>/static_source_cells.parquet`.
5. La elección de la ventana de calibración pesa más que el IC del bootstrap en el tramo de solo Terra (2001 ±14%); en 2003–2026 el efecto es ±3%.

## Salidas (`data/`)

| Ruta | Contenido |
|---|---|
| `interim/<R>/rows/*.parquet` | Copia de trabajo por archivo fuente (solo bbox). |
| `interim/<R>/detections.parquet` | Detecciones canónicas (1 fila = 1 píxel detectado). |
| `processed/<R>/events_daily.{parquet,csv}` | 1 fila = celda H3 × día. `harmonized_weight` = K de su época y mes del año (0 si no entra en la serie): sumar pesos da conteos armonizados en cualquier agregación espacial. |
| `processed/<R>/timeseries_{daily,monthly}.{parquet,csv}` | `events_observed`, `k_factor`, `events_harmonized` + IC. |
| `processed/<R>/calibration_factors.{parquet,csv}` | K por constelación × mes del año, con IC 95%. |
| `lineage/<R>/` | `rejected_records.parquet` (cada fila descartada con motivo), `rejection_summary.csv`, `source_manifest.json` (sha256, cobertura), `static_source_mask_cells.parquet`, `calibration_report.{json,md}`, `run_metadata.json` (config + versiones). |

### Esquema canónico (`detections`)
`record_key, lat, lon, timestamp_utc, acq_date, acq_time, solar_date, frp, brightness, brightness_2, scan, track, pixel_area_km2, confidence_raw, confidence_level, confidence_rank, satellite, instrument, sat_bit, version, daynight, type, is_provisional, product, source_file, h3_cell, epoch_id`

### Extensión prevista
Tiempo real NOAA-21: los archivos NRT nuevos (descarga o API) se reconocen como `level=NRT`, se marcan `is_provisional` y se reemplazan automáticamente cuando aparece el SP.

## Frontend (app web)

| Carpeta | Qué es | Local |
|---|---|---|
| `frontend/` | React + Vite + Tailwind. Hoy usa datos simulados (`src/data/mockFireService.js`). | `cd frontend && npm install && npm run dev` → http://localhost:5173 |
| `backend/` | API FastAPI + DuckDB sobre `Datos_Para_La_Web` (ver [backend/README.md](backend/README.md)). | `cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000` → http://localhost:8000/api/v1/docs |

Despliegue: dos proyectos de Vercel sobre este repo, con Root Directory `frontend` y `backend`.
