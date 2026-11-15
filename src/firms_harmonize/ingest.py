"""Etapa 1 — Ingesta: lee cada CSV in-place con DuckDB, prefiltra por bbox y escribe
una copia Parquet tipada SOLO con las filas de la región (copia de trabajo, no duplicado
del dato crudo). Cachea por (tamaño, mtime, bbox) para que las re-corridas sean incrementales.
"""
from __future__ import annotations

import json
import logging
from datetime import date, timedelta
from pathlib import Path

import duckdb

from .catalog import SourceFile

log = logging.getLogger(__name__)
SCHEMA_VERSION = 1


def _cols(con: duckdb.DuckDBPyConnection, path: Path) -> list[str]:
    return [r[0] for r in con.execute(
        "DESCRIBE SELECT * FROM read_csv(?, all_varchar=true, header=true)", [str(path)]).fetchall()]


def _select_sql(sf: SourceFile, cols: list[str]) -> str:
    b1 = "bright_ti4" if "bright_ti4" in cols else "brightness"
    b2 = "bright_ti5" if "bright_ti5" in cols else "bright_t31"
    typ = "TRY_CAST(type AS TINYINT)" if "type" in cols else "NULL::TINYINT"
    return f"""
      TRY_CAST(latitude AS DOUBLE)  AS lat,
      TRY_CAST(longitude AS DOUBLE) AS lon,
      TRY_CAST({b1} AS FLOAT)       AS brightness,
      TRY_CAST({b2} AS FLOAT)       AS brightness_2,
      TRY_CAST(scan AS FLOAT)       AS scan,
      TRY_CAST(track AS FLOAT)      AS track,
      TRY_CAST(acq_date AS DATE)    AS acq_date,
      lpad(trim(acq_time), 4, '0')  AS acq_time,
      trim(satellite)               AS satellite_raw,
      trim(instrument)              AS instrument_raw,
      trim(confidence)              AS confidence_raw,
      trim(version)                 AS version,
      TRY_CAST(frp AS FLOAT)        AS frp,
      trim(daynight)                AS daynight,
      {typ}                         AS type,
      '{sf.source_id}'              AS source_file,
      '{sf.kind}'                   AS file_kind,
      '{sf.level}'                  AS level,
      '{sf.product}'                AS product,
      {sf.priority}::TINYINT        AS file_priority"""


def ingest_file(con, sf: SourceFile, bbox: tuple, out_dir: Path) -> dict:
    out = out_dir / f"{sf.source_id}.parquet"
    meta_path = out.with_suffix(".json")
    st = sf.path.stat()
    key = {"size": st.st_size, "mtime": st.st_mtime, "bbox": [round(v, 6) for v in bbox],
           "schema_version": SCHEMA_VERSION}
    if out.exists() and meta_path.exists():
        meta = json.loads(meta_path.read_text())
        if meta.get("key") == key:
            return meta

    lon0, lat0, lon1, lat1 = bbox
    src = f"read_csv('{sf.path}', all_varchar=true, header=true)"
    cols = _cols(con, sf.path)
    missing = {"latitude", "longitude", "acq_date", "acq_time", "satellite", "confidence", "frp"} - set(cols)
    if missing:
        raise ValueError(f"{sf.path}: faltan columnas obligatorias {missing}")
    in_bbox = (f"TRY_CAST(latitude AS DOUBLE) BETWEEN {lat0} AND {lat1} "
               f"AND TRY_CAST(longitude AS DOUBLE) BETWEEN {lon0} AND {lon1}")
    n, dmin, dmax, n_bbox, n_badcoord = con.execute(f"""
        SELECT count(*), min(TRY_CAST(acq_date AS DATE)), max(TRY_CAST(acq_date AS DATE)),
               count(*) FILTER (WHERE {in_bbox}),
               count(*) FILTER (WHERE TRY_CAST(latitude AS DOUBLE) IS NULL
                                   OR TRY_CAST(longitude AS DOUBLE) IS NULL)
        FROM {src}""").fetchone()
    out_dir.mkdir(parents=True, exist_ok=True)
    con.execute(f"COPY (SELECT {_select_sql(sf, cols)} FROM {src} WHERE {in_bbox}) "
                f"TO '{out}' (FORMAT parquet, COMPRESSION zstd)")
    meta = {"key": key, "source_file": sf.source_id, "path": str(sf.path), "columns": cols,
            "n_rows": n, "n_in_bbox": n_bbox, "n_invalid_coords": n_badcoord,
            "date_min": str(dmin) if dmin else None, "date_max": str(dmax) if dmax else None}
    meta_path.write_text(json.dumps(meta, indent=1))
    return meta


def apply_coverage(sf: SourceFile, meta: dict) -> None:
    """Cobertura temporal real: archivos globales -> rango observado (siempre hay fuego en
    algún lugar del planeta); archivos por país -> año calendario, recortado si el año está
    incompleto (último dato > 7 días antes del 31-dic)."""
    dmin = date.fromisoformat(meta["date_min"]) if meta["date_min"] else None
    dmax = date.fromisoformat(meta["date_max"]) if meta["date_max"] else None
    if sf.kind == "global" and dmin:
        sf.cov_start, sf.cov_end = dmin, dmax
    elif sf.kind == "country" and dmax and dmax < sf.cov_end - timedelta(days=7):
        sf.cov_end = dmax


def run_ingest(files: list[SourceFile], bbox: tuple, out_dir: Path, threads: int = 8) -> list[dict]:
    con = duckdb.connect()
    con.execute(f"SET threads={threads}")
    metas = []
    for i, sf in enumerate(files, 1):
        log.info("[%d/%d] %s", i, len(files), sf.source_id)
        meta = ingest_file(con, sf, bbox, out_dir)
        apply_coverage(sf, meta)
        metas.append(meta)
    con.close()
    return metas
