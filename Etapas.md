# Etapas del proyecto — Armonización de focos MODIS + VIIRS

Este documento describe:

- **Parte A:** cómo fluye hoy cada detección de fuego por el pipeline, etapa por etapa, con las cifras reales de la corrida de **Argentina** (2000-11-01 → 2026-11-14).
- **Parte B:** las etapas que faltan hasta llegar a la aplicación web con alertas.

---

## Parte A — Flujo actual de los datos (implementado)

```
 CSV originales FIRMS (MODIS, S-NPP, NOAA-20, NOAA-21)        API FIRMS (solo huecos)
 ~/Proyecto_NASA/Data_*  (lectura, sin copiar)                      │
            │                                                      │
            ▼                                                      ▼
 ┌─────────────────────────────────────────────────────────────────────────┐
 │ 1. INGESTA         filtro rápido por bbox (rectángulo) de la región     │  146,3 M filas leídas
 │                    → copia Parquet de trabajo                           │  → 8,04 M dentro del bbox
 └─────────────────────────────────────────────────────────────────────────┘
            ▼
 ┌─────────────────────────────────────────────────────────────────────────┐
 │ 2. ESTANDARIZACIÓN esquema único + filtros con trazabilidad             │  → 6,86 M detecciones
 └─────────────────────────────────────────────────────────────────────────┘
            ▼
 ┌─────────────────────────────────────────────────────────────────────────┐
 │ 3. DEDUPLICACIÓN   celda H3 (~5 km²) × día = 1 evento                   │  → 2,67 M eventos
 └─────────────────────────────────────────────────────────────────────────┘
            ▼
 ┌─────────────────────────────────────────────────────────────────────────┐
 │ 4. CALIBRACIÓN     corrección por constelación y mes del año            │  → serie armonizada
 └─────────────────────────────────────────────────────────────────────────┘
            ▼
   data/processed/ARG/  (Parquet + CSV)        data/lineage/ARG/  (linaje e informes)
```

### Etapa 1 — Ingesta (`catalog.py`, `ingest.py`, `firms_api.py`)

| Paso             | Qué ocurre                                                                                                                                                                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Descubrimiento   | Se recorren las 4 carpetas de datos y cada CSV se clasifica por su nombre: archivo **por país y año**, **descarga global** (histórico SP o tiempo casi real NRT) o **bloque de la API**. Para Argentina se usaron 62 archivos. |
| Lectura          | DuckDB lee cada CSV en su carpeta original, sin copiarlo. Se descartan las filas fuera del rectángulo de la región (138,3 M filas; solo se guarda el conteo).                                                                                     |
| Copia de trabajo | Las filas dentro del rectángulo se guardan tipadas en `data/interim/ARG/rows/*.parquet`.                                                                                                                                                         |
| Caché           | Si un archivo no cambió (mismo tamaño y fecha de modificación), no se vuelve a leer. Por eso una nueva corrida tarda unos 30 s.                                                                                                                  |
| Cobertura y API  | Se calcula qué fechas cubre cada familia de satélite. Solo los días que faltan se piden a la API FIRMS. En esta corrida no faltó nada que la API tuviera: S-NPP no publica datos después del 2026-11-02.                                       |

### Etapa 2 — Estandarización (`standardize.py`)

Cada detección pasa por estas reglas, siempre en el mismo orden. Todo lo que se descarta queda en `lineage/ARG/rejected_records.parquet` con su motivo.

| #  | Regla                                                                                              |                                    Descartadas (ARG) |
| -- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------: |
| 1  | Valores no interpretables (coordenadas, fecha, hora, FRP)                                          |                                                    0 |
| 2  | Código de satélite desconocido                                                                   |                                                    0 |
| 3  | Fuera del **polígono** real de Argentina (Natural Earth)                                    |                                              694.486 |
| 4  | Fuera de la ventana operativa del satélite                                                        |                                                    0 |
| 5  | **Duplicado** entre archivos (archivo por país 2025 y descarga global 2025)                 |                                              267.103 |
| 6  | Dato NRT ya reemplazado por el producto científico (SP)                                           |                                                    0 |
| 7  | Confianza inválida                                                                                |                                                    0 |
| 8  | **No vegetación** (type 1 volcán, 2 industria, 3 mar adentro)                              |                                              211.100 |
| 9  | **Celda de fuente fija** (mechero, refinería o industria; SP y NRT, 4 reglas por celda)     | 109.635 *(corrida con correcciones de auditoría)* |
| 10 | Satélite inactivo o **caído** en el día solar asignado (caídas detectadas con los datos) |                                       22 *(ídem)* |
|    | **Detecciones conservadas**                                                                  |                                  **6.857.759** |

Cada detección conservada recibe además:

- **Confianza ordinal**: low / nominal / high. MODIS: menos de 30 = low, 30–79 = nominal, 80 o más = high. VIIRS: l / n / h.
- **Celda H3** de resolución 7 y **día solar local** (UTC + longitud/15 h).
- **Constelación activa** de ese día (`epoch_id`). Por ejemplo, `Terra+Aqua+SNPP`.

Salida: `data/interim/ARG/detections.parquet`, con una fila por píxel detectado.

> Corrección posterior a la auditoría de calidad (`audits/audit_web_store.py`): la constelación activa de cada día se ajusta con la **detección de caídas de satélites** (189 satélite-día). Los 33 días sin ningún satélite pasan a *sin dato* en lugar de 0. Las cifras de la tabla, salvo las filas 9 y 10, corresponden a la primera corrida.

### Etapa 3 — Deduplicación (`dedup.py`)

El mismo fuego puede verse varias veces en un día: Terra, Aqua, S-NPP, NOAA-20 y NOAA-21, de día y de noche. Todas esas detecciones se agrupan por **celda H3 × día** en un único **evento** que conserva:

- `n_raw_detections`, `n_satellites`, `satellites` (por ejemplo `Aqua+NOAA20`), detecciones MODIS y VIIRS.
- `frp_max` (métrica principal) y `frp_mean`.
- `max_confidence`, primera y última hora de detección, y si el evento es provisorio (NRT).
- Dos **máscaras de satélites**: una con todas las confianzas y otra solo con confianza nominal o alta. Sirven para la calibración.

Resultado: **2.670.327 eventos**. De ellos, 2.531.691 entran en la serie (confianza nominal o alta). Los demás son eventos solo de confianza baja: se conservan para las alertas.

### Etapa 4 — Calibración (`calibrate.py`)

**Problema.** Entre 2000 y 2026 se pasó de 1 a 5 satélites. Se detectan más fuegos porque hay más pasadas y mejor resolución, no porque haya más fuego.
















**Solución.**

1. **Épocas.** Cada día tiene una constelación activa. Para Argentina hay 6 épocas: solo Terra → +Aqua → +S-NPP → +NOAA-20 → +NOAA-21 → sin S-NPP.
2. **Cociente entre épocas.** En cada época se *simula* la anterior quitando satélites. Sobre los mismos fuegos y días se mide cuántos eventos más ve la constelación grande. Esto se hace **por mes del año**, porque la ganancia cambia con la estación.
3. **Suavizado.** Los 12 cocientes se suavizan con un ajuste armónico circular (diciembre empalma con enero), en escala logarítmica y ponderado por la cantidad de eventos.
4. **Encadenado.** Los cocientes se multiplican hasta la constelación de referencia (la de 5 satélites). Así se obtiene un factor **K** por época y mes.
5. **Incertidumbre.** Intervalo de confianza del 95% por bootstrap estratificado por mes del año.
6. **Validación.** Se calibra con la primera mitad de cada ventana y se predice la segunda. El error mensual de la época anterior a 2012 bajó de 27,7% a 10,1% respecto del factor único.

`serie_armonizada(día) = eventos_observados(día) × K[constelación del día][mes]`

### Etapa 4b — Exportación al almacén web (`export_web.py`)

Empaqueta los productos en `Datos_Para_La_Web/<REGIÓN>/`, una carpeta autocontenida que la web consume sin ejecutar el pipeline:

- **Eventos** en Parquet particionado `layer=SP|NRT / year=AAAA`, ordenados por celda H3 gruesa (res 3) y fecha para que DuckDB descarte bloques al filtrar por zona.
- **Corte SP/NRT automático**: el último día en que todos los satélites vigentes tienen producto científico. Lo anterior es `layer=SP` (definitivo); lo posterior es `layer=NRT` (provisorio, se reemplaza completo en cada refresco).
- **Por registro**: `harmonized_weight`, `calibration_version` (hash de los factores y de la configuración) y `calibration_quality` (high / medium / low según la magnitud de K y el ancho de su intervalo de confianza).
- **Series** diaria y mensual con intervalo de confianza del 95%, factores K, mapa celda → región, `manifest.json` con sha256 de cada archivo, y metadatos de calibración y descartes.
- **Publicación atómica**: se arma en una carpeta temporal y se reemplaza de una vez, así la web nunca lee un almacén a medio escribir.

### Etapa 4c — Auditoría de calidad y corrección de errores (`audits/audit_web_store.py`)

Objetivo: **intentar romper los resultados** antes de darlos por definitivos. La auditoría es un script independiente: no importa nada del pipeline, lee solo los Parquet publicados con DuckDB y Polars, y los contrasta con fuentes independientes (polígono Natural Earth, detecciones crudas). Escribe un tablero PASS / WARN / FAIL en `audits/audit_<R>.json`.

**Cómo se organiza el ciclo**

1. Correr la auditoría sobre `Datos_Para_La_Web/<R>/`.
2. Investigar cada FAIL o WARN con consultas puntuales hasta separar un **defecto real** de un **falso positivo del propio test**. Cuando es lo segundo, se corrige el test y se documenta.
3. Corregir en el pipeline (nunca a mano sobre los datos), con umbrales **medidos en los datos** y parametrizados en `config/pipeline.yaml`.
4. Agregar un test unitario sintético por cada corrección (`tests/`).
5. Volver a correr pipeline y auditoría, y comparar antes y después. Cada corrida genera una `calibration_version` nueva.

**Los 4 ejes que verifica**

| Eje                          | Qué verifica                                                                                                                                                                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Esquema y nulos           | Nulos, NaN e inf; pesos negativos o incoherentes con su IC; FRP inválido; trazabilidad (versión, `reliability_tier`, capa SP/NRT); peso == K de la tabla diaria                                                                                |
| 2. Espacial y deduplicación | Detecciones fuera del polígono; unicidad celda × día; recurrencia anómala de celdas (fuentes fijas); web == `processed`                                                                                                                      |
| 3. Transiciones y corte      | **Salto artificial local** en cada cambio de constelación (armonizado de la constelación grande vs la chica simulada sobre los mismos días); escalones del factor; caídas silenciosas; rachas de ceros; corte SP/NRT sin solape ni hueco |
| 4. Coherencia                | Σ pesos de eventos == series diaria y mensual; IC coherentes; total histórico                                                                                                                                                                    |

**Errores encontrados y corregidos (ARG, 2026-11-15)**

| # | Error                                                                                                                                                             | Corrección                                                                                                                                                                                             | Resultado                                                                           |
| - | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1 | Caídas de satélites tratadas como "sin fuego": bloques de 18 y 10 días con 0 eventos en 2001–2002, y caídas parciales no vistas (S-NPP 2022, Terra 2022, …) | Detección de caídas por satélite y día (por cociente con el resto, climatología o rachas). Los días sin satélites pasan a *sin dato*; marca `observation_flag` y serie mensual `gapfilled` | 189 días-satélite con caída; 33 días nulos; 20 días `suspect_zero`           |
| 2 | Mecheros y refinerías filtrados en SP (hasta 332 días de fuego por año en una celda); máscara NRT que descartaba de más                                      | Reglas por celda para SP y NRT: `persistent`, `flare`, `typed`, `chronic`                                                                                                                       | 0 celdas por encima de 150 días/año (antes 17); 1.410 detecciones NRT recuperadas |
| 3 | Falsas alarmas diurnas de MODIS que VIIRS nunca confirma (pesan con K hasta 24)                                                                                   | Regla `modis_only` (control: el 99,74% de las celdas comparables sí tiene VIIRS)                                                                                                                     | 173 celdas                                                                          |
| 4 | Escalones del factor K de hasta ×1,54 al cambiar de mes                                                                                                          | Interpolación circular diaria de K                                                                                                                                                                     | Escalón máximo ×1,014                                                            |
| 5 | FRP = 0 publicado como valor real; FRP > 5.000 MW sin marca                                                                                                       | FRP 0 → nulo; marca `frp_quality`                                                                                                                                                                    | 129 eventos `missing`, 84 `extreme`                                             |
| 6 | Salto artificial de +43% a 28 días (+23% a 90 días) en la entrada de Aqua: la ganancia de Aqua cambió con los años                                            | Ventana de calibración por proximidad (2 años)                                                                                                                                                        | +14% a 90 días; totales 2003–2026 ±3%; 2001 +14%                                 |
| 7 | Evento con detección NRT dentro de la capa SP (día solar vs fecha UTC)                                                                                          | Corte SP/NRT en día solar + `n_provisional_detections`                                                                                                                                               | 0 casos                                                                             |
| 8 | Nombre del flag de confiabilidad distinto del acordado                                                                                                            | `calibration_quality` → `reliability_tier`                                                                                                                                                         | —                                                                                  |
| 9 | Falsos positivos de la propia auditoría (tolerancia absoluta en floats; PASS fijado a mano; test de transiciones confundido por años atípicos)                 | Se corrigieron los tests y se agregó el test de consistencia local                                                                                                                                     | —                                                                                  |

**Estado final:** 19 PASS, 26 WARN, **0 FAIL**. Los WARN son, en su mayoría, comportamientos por diseño que la web tiene que conocer (pesos 0 de eventos de baja confianza, centros H3 en la costa, eventos NRT que mezclan MODIS SP) o informativos (transiciones contra la estacionalidad de otros años).

**Pendiente o aceptado con justificación**

- 2 rachas de 5–6 días con 0 eventos en otoño de 2002 (solo Terra): no se distingue una caída de una semana sin fuego. Quedan marcadas `suspect_zero`.
- Terra con 0 detecciones en 54 días de la era VIIRS que no alcanzan el umbral de caída. Impacto menor al 3% en esos días.
- Incertidumbre estructural de la calibración en 2000–2002, mayor que el IC del bootstrap. Está documentada para la web.

La auditoría se vuelve a correr en cada actualización mensual (etapa 8) como **compuerta de publicación**: con algún FAIL, no se publica.

### Productos generados

| Archivo                                           | Para qué sirve                                                                                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `processed/ARG/events_daily`                    | Mapa: 1 fila por celda × día, con coordenadas, FRP, confianza, satélites y `harmonized_weight` (sumar este peso da conteos armonizados en cualquier recorte). |
| `processed/ARG/timeseries_daily` / `_monthly` | Gráficos: eventos observados, factor K y eventos armonizados con su intervalo de confianza.                                                                       |
| `processed/ARG/calibration_factors`             | K por época × mes, con intervalo de confianza.                                                                                                                   |
| `lineage/ARG/*`                                 | Trazabilidad: registros descartados, manifiesto de fuentes con sha256, celdas enmascaradas, informe de calibración, configuración y versiones usadas.            |

---

## Parte B — Próximas etapas hasta la app web

```
 [Hecho] 1-4 Pipeline histórico + 4b Almacén web ARG + 4c Auditoría QA y corrección de errores
            │
            ▼
 Etapa 5  Validación y robustez ──────────┐
            │                             │
            ▼                             ▼
 Etapa 6  Productos analíticos      Etapa 7  Tiempo real y alertas (NOAA-21 NRT)
 (anomalías, tendencias, provincias)      │
            │                             │
            └──────────────┬──────────────┘
                           ▼
              Etapa 8  Escalado global precalculado (capas SP + NRT)
                           ▼
              Etapa 9  API backend
                           ▼
              Etapa 10 Aplicación web (mapa, series, alertas)
                           ▼
              Etapa 11 Despliegue y operación
```

### Etapa 5 — Validación y robustez del dataset

Objetivo: poder defender las cifras antes de publicarlas.

- **Validación externa.** Comparar la serie armonizada con los productos de área quemada `BA_MODIS` / `BA_VIIRS`, disponibles en la misma API, y con estadísticas oficiales de incendios de Argentina, si las hay.
- **Caídas de satélites.** Detectar días sin datos de un satélite dentro de años cubiertos. Hoy se asume que el satélite estuvo activo todo el año.
- **Sensibilidad.** Repetir la corrida con H3 res 6 y 8, con y sin confianza baja, y con el día UTC en lugar del solar, para ver cuánto cambian las tendencias.
- **Prueba de agnosticismo.** Correr el pipeline con otro país, por ejemplo `CHL` o `BRA`, y verificar que no requiera cambios de código.
- **Revisión de la máscara de fuentes estáticas.** Verificar que las 7.216 celdas no tapen focos de vegetación reales.

### Etapa 6 — Productos analíticos (lo que verá el usuario final)

- **Climatología y anomalías**: media y percentiles por mes de un período base, por ejemplo 2003–2022. Para cada mes, z-score o percentil. Esto da la respuesta a "¿este mes está por encima de lo normal?".
- **Tendencias**: Mann-Kendall más pendiente de Sen sobre la serie armonizada anual, por región y por celda agregada.
- **Agregación administrativa**: provincias y departamentos (límites admin-1 y admin-2) además de H3.
- **Pirámide H3**: niveles 4, 5 y 6 precalculados para que el mapa responda rápido al alejar el zoom.

### Etapa 7 — Tiempo real y alertas (NOAA-21 NRT)

Objetivo: avisar a las autoridades **ante el mínimo indicio de fuego**.

- **Consulta periódica** a la API FIRMS (NRT de NOAA-21, más NOAA-20 y MODIS como respaldo) cada N minutos para la región.
- **Ingesta incremental**: el mismo esquema y los mismos filtros (polígono, máscara de fuentes estáticas, deduplicación). Los eventos quedan marcados como provisorios y se reemplazan cuando llega el producto científico.
- **Motor de alertas**:
  - Dispara con **cualquier** detección nueva, incluida la de confianza baja.
  - No repite la alerta si la misma celda ya avisó dentro de una ventana de X horas.
  - Prioriza por confianza, FRP, cantidad de satélites y cercanía a zonas sensibles (poblaciones, áreas protegidas).
- **Canales de notificación**: correo, SMS o WhatsApp, webhook o integración con sistemas de emergencia.
- **Latencia esperada**: FIRMS publica el NRT unas 3 h después de la pasada del satélite. Es una limitación de la fuente que hay que comunicar a los usuarios.

### Etapa 8 — Escalado global precalculado (arquitectura de dos capas)

Objetivo: que cualquier consulta de la web (país, provincia o polígono dibujado) se responda en milisegundos **leyendo y sumando pesos**, sin ejecutar nunca el pipeline ante una búsqueda.

```
FIRMS SP (mensual) ─► batch global ─┐
                                    ├─► ALMACÉN  events/layer=SP|NRT/year=AAAA/  ◄─ consulta web (DuckDB)
FIRMS NRT (horas)  ─► incremental ──┘            + h3_region_map + calibration_factors (versionados)
```

| Capa                                  | Contenido                                                        | Refresco                  | Estado                                                                                                                  |
| ------------------------------------- | ---------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **SP (histórica consolidada)** | Producto científico, 2000-11 → último mes publicado por FIRMS | Mensual                   | Definitiva e inmutable por versión                                                                                     |
| **NRT (reciente)**              | Desde el corte SP hasta ayer u hoy                               | Incremental, cada N horas | Provisoria; la partición `layer=NRT` se reescribe completa y sus eventos pasan a SP cuando llega el producto oficial |

El corte entre capas **no se fija a mano** (por ejemplo, "2 meses antes"). Se calcula con la cobertura real del SP de cada satélite vigente: es el mínimo de sus fechas finales. Hoy el atraso real es de 2,5 a 3,5 meses: MODIS SP llega a fines de agosto y VIIRS SP a fines de julio.

Diseño:

1. **Ingesta única global.** Los archivos globales se leen una sola vez, no una por región, y se escriben en Parquet particionado por **celda H3 gruesa (res 2–3) + año**. Volumen estimado con las filas observadas: unas 18 M detecciones por año por satélite VIIRS y unas 3,5 M por año de MODIS, del orden de 500–600 M detecciones en total. Se maneja en un solo equipo con DuckDB.
2. **Tabla de mapeo `h3_cell → región`.** País, provincia, departamento y bioma, precalculados una vez por celda de res 7. Una consulta por región es un cruce con esa tabla, no un cálculo punto-en-polígono.
3. **Calibración por zonas fijas, no por región consultada.**
   - Hay que separar por **hemisferio**: con factor mensual, julio es invierno en el sur y verano en el norte.
   - Y por **latitud**: cerca de los polos las órbitas se superponen más y cambia la ganancia por sumar satélites.
   - Propuesta inicial: bandas de latitud por hemisferio (por ejemplo, 0–15°, 15–30°, 30–45°, 45–60° y más de 60°), uniendo bandas con pocos eventos. Cada evento recibe el factor de su zona, y cualquier región consultada lo hereda de forma coherente.
4. **Versionado de factores.** Cada recálculo mensual genera una versión nueva (`calibration_version`). El almacén registra con qué versión se calculó cada peso, y las versiones anteriores se conservan para reproducir cifras ya publicadas.
5. **Publicación atómica e idempotente.** Se construye en una carpeta temporal y se reemplaza de una vez. Un `manifest.json` registra el sha256 de cada archivo, las fechas de corte y los conteos.

Pendiente de decidir: la definición exacta de las zonas de calibración y la frecuencia de refresco del NRT (ver al final).

### Etapa 9 — API backend

- **Almacenamiento**:
  - El almacén Parquet de la etapa 8, consultado con DuckDB, para el histórico y el NRT.
  - Una base transaccional, por ejemplo PostgreSQL + PostGIS, para alertas y suscripciones.
- **API**, por ejemplo con FastAPI. Endpoints mínimos:
  - `/timeseries?region=&from=&to=&freq=`: serie armonizada con intervalo de confianza.
  - `/events?bbox=&date=`: eventos para el mapa.
  - `/anomalies?region=&month=`
  - `/alerts`: listado y suscripción.
- **Teselas de mapa**: hexágonos H3 servidos como vector tiles o PMTiles.
- **Abstracción del sensor**: la API expone valores armonizados. El detalle por satélite queda solo como linaje.

### Etapa 10 — Aplicación web

- **Mapa interactivo** (MapLibre + deck.gl, capa de hexágonos H3) con control de tiempo.
- **Panel de series**: serie armonizada con banda de incertidumbre. El tramo 2000–2002 se marca como de menor confiabilidad.
- **Vista de anomalías y tendencias** por región, provincia o celda.
- **Panel de alertas en vivo** y gestión de suscripciones para las autoridades.
- **Selector de región**, reutilizando la configuración agnóstica del pipeline.

### Etapa 11 — Despliegue y operación

- **Orquestación**: cron o Prefect para la actualización diaria del histórico y la consulta frecuente del NRT.
- **Monitoreo**: estado de la API FIRMS, días sin datos, tasa de alertas y errores del pipeline.
- **Versionado** de datos y de la calibración (`calibration_version`) para que cada cifra publicada sea reproducible.
- **Seguridad**: la MAP_KEY y las credenciales de notificación en variables de entorno o un gestor de secretos.

---

## Decisiones pendientes (a definir antes de las etapas 7–11)

1. **Destinatarios y canales** de las alertas (qué organismos, correo, SMS o webhook) y si hay un sistema existente con el que integrarse.
2. **Frecuencia de consulta** del NRT y ventana de no repetición de alertas.
3. **Zonas sensibles** para priorizar (poblaciones, parques nacionales, interfaz urbano-forestal) y su fuente de datos.
4. **Período base** para anomalías: por ejemplo 2003–2022, para excluir el tramo de solo Terra.
5. **Infraestructura de despliegue**: servidor propio, nube o institucional.
6. **Nivel administrativo** requerido (provincia o departamento) y fuente oficial de límites (IGN Argentina o Natural Earth).
7. **Zonas de calibración global** (etapa 8): bandas de latitud por hemisferio (propuesta), biomas, o una combinación de ambos. También el mínimo de eventos por zona y mes para no unir zonas.
8. **Frecuencia de refresco del NRT** (etapa 8): define a la vez la latencia de las alertas y del mapa. FIRMS publica unas 3 h después de cada pasada, así que refrescar más seguido que cada 1–3 h no aporta datos nuevos.
