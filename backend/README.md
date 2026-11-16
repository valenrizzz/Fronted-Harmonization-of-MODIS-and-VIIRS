# Backend — API de actividad de incendios armonizada

FastAPI + DuckDB sobre los Parquet de `../Datos_Para_La_Web`. No ejecuta el pipeline ni importa su código: solo lee el almacén precalculado.

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
cp .env.example .env            # opcional
.venv/bin/uvicorn app.main:app --reload --port 8000
.venv/bin/python -m pytest -q tests
```

Documentación interactiva: <http://localhost:8000/api/v1/docs>

## Endpoints (`/api/v1`)

| Endpoint | Para qué |
|---|---|
| `GET /health` | Estado, versión, regiones cargadas. |
| `GET /regions`, `GET /regions/{code}` | Regiones detectadas en `DATA_ROOT`: período, corte SP/NRT, bbox, versión de calibración. |
| `GET /timeseries` | Serie `daily` o `monthly`: observado, armonizado, IC 95 %, `reliability_tier`, capa y `status`. |
| `GET /spatial/cells` | Agregación por celda H3 (res 3/5/7) para el mapa. `format=geojson` devuelve polígonos. |
| `GET /summary` | KPIs: total con IC, variación interanual, picos, proporción SP/NRT y por confiabilidad. |

Parámetros comunes: `region` (obligatorio), `start`, `end` (día solar, inclusivos; por defecto, todo el período) y `bbox=oeste,sur,este,norte`.

## Reglas del contrato

- **Sensor abstraído**: ninguna respuesta expone satélites, épocas ni máscaras.
- **Sin dato ≠ 0**: los días sin ningún satélite tienen `status: "no_data"` y valores `null`.
- **`monthly` cubre meses completos**: `start`/`end` se extienden al mes entero y la respuesta devuelve la ventana efectiva.
- **Con `bbox`** la serie suma los pesos de los eventos cuyo centroide (H3 res 7) cae dentro del recorte (`ci_method: "sum_of_event_ci"`). Sin `bbox` se usan las series precalculadas (`"exact"`). Con un bbox que cubre toda la región, los dos caminos dan el mismo resultado (hay un test que lo verifica).
- **`status`**: `ok`, `partial` (mes con días sin dato), `suspect_zero` (cero dudoso) y `no_data`.
- **`layer`**: `SP` (definitivo), `NRT` (provisorio) o `MIXED` (mes que cruza el corte). El corte sale de `manifest.json` y se recarga solo.

## Mapa: protección de performance

- `zoom` → resolución: ≤5 → res 3, 6–8 → res 5, ≥9 → res 7. También se puede fijar `res`.
- Si la resolución pedida supera `FIRE_API_MAX_CELLS` (20.000 por defecto, o el `limit` del pedido), pasa a una más gruesa (`coarsened: true`). Si aun en res 3 se supera, devuelve las celdas de mayor peso (`truncated: true`).
- Para res 7, enviá el `bbox` de la vista.

## Solo lectura

1. Conexión DuckDB `read_only=True` sobre un catálogo de vistas en `backend/.cache/`, que se borra al apagar.
2. `allowed_directories=[DATA_ROOT]`, `enable_external_access=false` y `lock_configuration=true`: no se puede leer fuera de los datos ni instalar extensiones.
3. `ReadOnlyDB.query` solo acepta una sentencia `SELECT`/`WITH` por llamada. DuckDB permite `COPY … TO` incluso en modo `read_only`, así que esta capa es la que lo bloquea.

## Despliegue en Vercel

Proyecto aparte con **Root Directory = `backend`**. [vercel.json](vercel.json) reescribe todas las rutas hacia [api/index.py](api/index.py) e incluye `data_bundle/` en la función.

Vercel limita cada función a 225 MB y los datos completos de los 5 países (~200 MB) más DuckDB no entran. Por eso, **antes de cada deploy** hay que armar el paquete podado:

```bash
cd backend && .venv/bin/python scripts/build_data_bundle.py   # ~66 MB
cd .. && vercel deploy --prod --project fire-harmonized-api
```

[scripts/build_data_bundle.py](scripts/build_data_bundle.py) copia `Datos_Para_La_Web/` con los eventos reducidos a las columnas que consulta la API. Saca `cell_lat`, `cell_lon`, `h3_r5` y `h3_r3`, que dependen solo de `h3_cell`, y [app/db.py](app/db.py) los recupera de `h3_region_map.parquet`, después de validar que el mapa los reproduce exactamente. Las respuestas son idénticas a las de los datos completos. Si falta `data_bundle/`, el build de Vercel falla con un aviso. `Datos_Para_La_Web/` no se sube (ver `.vercelignore`). `requirements.txt` tiene solo las dependencias de runtime; las de desarrollo están en `requirements-dev.txt`. Las variables de entorno están en [.env.vercel.example](.env.vercel.example).

## Caché y actualización

- Cada respuesta de datos lleva un `ETag` derivado de `calibration_version` y `generated_utc`. Con `If-None-Match` se responde `304`.
- Cada `FIRE_API_RELOAD_CHECK_SECONDS` se revisan los `manifest.json`: las regiones nuevas o actualizadas se cargan sin reiniciar.
- El header `X-Process-Time-Ms` informa el tiempo de servidor de cada pedido.
