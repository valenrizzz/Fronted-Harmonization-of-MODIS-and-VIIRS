"""Arma backend/data_bundle/ para el despliegue en Vercel.

Vercel limita cada función a 250 MB sin comprimir. Con 5 países, los eventos
completos de Datos_Para_La_Web/ (~186 MB) más DuckDB (~90 MB) no entran, así que
el paquete conserva todo excepto las columnas de eventos que la API no consulta
(horarios de detección, máscaras de satélites, conteos por sensor, etc.).

Datos_Para_La_Web/ no se modifica: sigue siendo la salida completa del pipeline.

Uso (desde backend/):  .venv/bin/python scripts/build_data_bundle.py
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "Datos_Para_La_Web"
DST = ROOT / "backend" / "data_bundle"

# Columnas de eventos que usa la API (app/services, app/db.py). `layer` y `year`
# viajan en la ruta (particiones hive), no dentro del archivo. cell_lat, cell_lon,
# h3_r5 y h3_r3 dependen solo de h3_cell: app/db.py las recupera de h3_region_map.
EVENT_COLUMNS = [
    "solar_date", "h3_cell",
    "in_series", "harmonized_weight", "weight_ci_low", "weight_ci_high",
    "n_raw_detections", "frp_max", "frp_mean", "reliability_tier",
]
DERIVED_FROM_MAP = ["cell_lat", "cell_lon", "h3_r5", "h3_r3"]


def check_cell_map(con: duckdb.DuckDBPyConnection, rdir: Path) -> None:
    """Las columnas derivadas solo se quitan si el mapa de celdas las reproduce exactamente."""
    ev = f"read_parquet('{rdir}/events/*/*/*.parquet', hive_partitioning=false)"
    mp = f"read_parquet('{rdir}/h3_region_map.parquet')"
    cols = ", ".join(DERIVED_FROM_MAP)
    dup = con.execute(f"SELECT count(*) - count(DISTINCT h3_cell) FROM {mp}").fetchone()[0]
    diff = con.execute(
        f"SELECT count(*) FROM (SELECT DISTINCT h3_cell, {cols} FROM {ev}) e "
        f"LEFT JOIN {mp} m ON e.h3_cell = m.h3_cell WHERE m.h3_cell IS NULL OR "
        + " OR ".join(f"e.{c} IS DISTINCT FROM m.{c}" for c in DERIVED_FROM_MAP)
    ).fetchone()[0]
    if dup or diff:
        sys.exit(f"{rdir.name}: h3_region_map no reproduce los eventos (duplicados={dup}, distintos={diff})")


def slim_events(con: duckdb.DuckDBPyConnection, src: Path, dst: Path) -> None:
    present = {r[0] for r in con.execute(f"DESCRIBE SELECT * FROM read_parquet('{src}', hive_partitioning=false)").fetchall()}
    missing = [c for c in EVENT_COLUMNS if c not in present]
    if missing:
        sys.exit(f"{src}: faltan columnas requeridas por la API: {missing}")
    cols = ", ".join(EVENT_COLUMNS)
    dst.parent.mkdir(parents=True, exist_ok=True)
    con.execute(
        f"COPY (SELECT {cols} FROM read_parquet('{src}', hive_partitioning=false) ORDER BY solar_date, h3_cell) "
        f"TO '{dst}' (FORMAT parquet, COMPRESSION zstd, COMPRESSION_LEVEL 19)"
    )


def main() -> None:
    if not SRC.is_dir():
        sys.exit(f"No existe {SRC}")
    if DST.exists():
        shutil.rmtree(DST)
    con = duckdb.connect()
    regions = sorted(p for p in SRC.iterdir() if (p / "manifest.json").is_file())
    for rdir in regions:
        check_cell_map(con, rdir)
        out = DST / rdir.name
        shutil.copytree(rdir, out, ignore=shutil.ignore_patterns("events"))
        for f in sorted((rdir / "events").rglob("*.parquet")):
            slim_events(con, f, out / f.relative_to(rdir))
        print(f"{rdir.name}: {sum(p.stat().st_size for p in out.rglob('*') if p.is_file()) / 1e6:6.1f} MB")
    total = sum(p.stat().st_size for p in DST.rglob("*") if p.is_file()) / 1e6
    print(f"data_bundle total: {total:.1f} MB ({len(regions)} regiones)")


if __name__ == "__main__":
    main()
