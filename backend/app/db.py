"""Acceso de solo lectura a los Parquet de Datos_Para_La_Web con DuckDB.

Tres barreras de inmutabilidad:
1. La conexión se abre con ``read_only=True`` sobre un catálogo que solo contiene
   vistas (no se puede crear ni modificar ninguna tabla).
2. ``allowed_directories`` + ``enable_external_access=false`` + ``lock_configuration``:
   DuckDB no puede leer fuera de DATA_ROOT ni instalar extensiones.
3. :meth:`ReadOnlyDB.query` solo ejecuta una sentencia ``SELECT``/``WITH`` por llamada
   (DuckDB permite ``COPY ... TO`` aun en modo read_only, así que se bloquea aquí).
"""

from __future__ import annotations

import os
import re
import uuid
from pathlib import Path
from typing import Any

import duckdb

_READ_ONLY_SQL = re.compile(r"^\s*(select|with)\b", re.IGNORECASE)


def _sql_str(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def view_names(code: str) -> dict[str, str]:
    return {
        "events": f"ev_{code}",
        "daily": f"tsd_{code}",
        "monthly": f"tsm_{code}",
        "cells": f"map_{code}",
        "outages": f"out_{code}",
    }


class ReadOnlyDB:
    def __init__(
        self,
        data_root: Path,
        catalog_dir: Path,
        regions: dict[str, Path],
        threads: int = 4,
        memory_limit: str = "1GB",
    ) -> None:
        catalog_dir.mkdir(parents=True, exist_ok=True)
        self._path = catalog_dir / f"catalog_{os.getpid()}_{uuid.uuid4().hex[:8]}.duckdb"

        # 1) Catálogo con vistas (lo único que se escribe, y fuera de DATA_ROOT).
        writer = duckdb.connect(str(self._path))
        try:
            for code, rdir in regions.items():
                v = view_names(code)
                events_glob = _sql_str(str(rdir / "events" / "*" / "*" / "*.parquet"))
                events_src = f"read_parquet({events_glob}, hive_partitioning=true, union_by_name=true)"
                cols = {r[0] for r in writer.execute(f"DESCRIBE SELECT * FROM {events_src}").fetchall()}
                if "cell_lat" in cols:
                    events_sql = f"SELECT * FROM {events_src}"
                else:
                    # Paquete podado para Vercel (scripts/build_data_bundle.py): coordenadas y
                    # resoluciones H3 gruesas dependen solo de h3_cell y se toman del mapa de celdas.
                    map_src = f"read_parquet({_sql_str(str(rdir / 'h3_region_map.parquet'))})"
                    events_sql = (
                        f"SELECT e.*, m.cell_lat, m.cell_lon, m.h3_r5, m.h3_r3 FROM {events_src} e "
                        f"JOIN {map_src} m ON e.h3_cell = m.h3_cell"
                    )
                writer.execute(f"CREATE VIEW {v['events']} AS {events_sql}")
                for key, fname in (
                    ("daily", "timeseries_daily.parquet"),
                    ("monthly", "timeseries_monthly.parquet"),
                    ("cells", "h3_region_map.parquet"),
                ):
                    writer.execute(
                        f"CREATE VIEW {v[key]} AS SELECT * FROM read_parquet("
                        f"{_sql_str(str(rdir / fname))})"
                    )
                # Caídas de satélite detectadas por el pipeline (vacío si la región no las exporta)
                out_csv = rdir / "metadata" / "satellite_outages.csv"
                if out_csv.is_file():
                    writer.execute(
                        f"CREATE VIEW {v['outages']} AS SELECT CAST(date AS DATE) AS date, satellite "
                        f"FROM read_csv({_sql_str(str(out_csv))}, header=true, columns="
                        "{'date': 'DATE', 'satellite': 'VARCHAR', 'expected_detections': 'DOUBLE', "
                        "'zero_run_days': 'BIGINT', 'zero_run_expected': 'DOUBLE', "
                        "'detections_other_satellites': 'BIGINT', 'method': 'VARCHAR'})"
                    )
                else:
                    writer.execute(
                        f"CREATE VIEW {v['outages']} AS SELECT CAST(NULL AS DATE) AS date, "
                        "CAST(NULL AS VARCHAR) AS satellite WHERE false"
                    )
        finally:
            writer.close()

        # 2) Conexión de solo lectura y sandbox.
        self._conn = duckdb.connect(
            str(self._path),
            read_only=True,
            config={
                "threads": threads,
                "memory_limit": memory_limit,
                "autoinstall_known_extensions": False,
                "autoload_known_extensions": False,
            },
        )
        root = str(data_root.resolve()).rstrip("/") + "/"
        self._conn.execute(f"SET allowed_directories=[{_sql_str(root)}]")
        self._conn.execute("SET enable_external_access=false")
        self._conn.execute("SET lock_configuration=true")

    def query(self, sql: str, params: list[Any] | None = None) -> list[dict[str, Any]]:
        if not _READ_ONLY_SQL.match(sql) or ";" in sql.strip().rstrip(";"):
            raise PermissionError("Solo se permiten consultas SELECT/WITH de una sentencia")
        cur = self._conn.cursor()
        try:
            cur.execute(sql, params or [])
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, row)) for row in cur.fetchall()]
        finally:
            cur.close()

    def close(self) -> None:
        try:
            self._conn.close()
        finally:
            self._path.unlink(missing_ok=True)
            Path(str(self._path) + ".wal").unlink(missing_ok=True)

    @property
    def duckdb_version(self) -> str:
        return duckdb.__version__
