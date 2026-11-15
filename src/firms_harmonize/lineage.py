"""Trazabilidad: hashes de archivos, registro de descartes y metadatos de corrida."""
from __future__ import annotations

import hashlib
import json
import platform
from datetime import datetime, timezone
from importlib.metadata import version
from pathlib import Path

import polars as pl

REJECT_SCHEMA = {
    "reason": pl.Utf8,
    "source_file": pl.Utf8,
    "record_key": pl.Utf8,
    "satellite": pl.Utf8,
    "acq_date": pl.Date,
    "acq_time": pl.Utf8,
    "lat": pl.Float64,
    "lon": pl.Float64,
    "frp": pl.Float32,
    "confidence_raw": pl.Utf8,
    "type": pl.Int8,
}


def sha256_file(path: Path, chunk: int = 1 << 24) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        while b := fh.read(chunk):
            h.update(b)
    return h.hexdigest()


class HashCache:
    """sha256 cacheado por (ruta, tamaño, mtime) para no re-hashear GB en cada corrida."""

    def __init__(self, path: Path):
        self.path = path
        self.data: dict = json.loads(path.read_text()) if path.exists() else {}

    def get(self, f: Path) -> str:
        st = f.stat()
        k = str(f)
        e = self.data.get(k)
        if e and e["size"] == st.st_size and e["mtime"] == st.st_mtime:
            return e["sha256"]
        digest = sha256_file(f)
        self.data[k] = {"size": st.st_size, "mtime": st.st_mtime, "sha256": digest}
        return digest

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self.data, indent=1))


class RejectLog:
    """Acumula registros descartados (con motivo) y conteos agregados."""

    def __init__(self):
        self.frames: list[pl.DataFrame] = []
        self.counts: list[dict] = []

    def add(self, df: pl.DataFrame, reason: str) -> None:
        if df.height == 0:
            return
        out = df.with_columns(pl.lit(reason).alias("reason"))
        cols = [pl.col(c).cast(t) if c in out.columns else pl.lit(None, dtype=t).alias(c)
                for c, t in REJECT_SCHEMA.items()]
        self.frames.append(out.select(cols))

    def add_count(self, source_file: str, reason: str, n: int) -> None:
        """Para descartes masivos sin fila individual (p.ej. fuera del bbox en archivos globales)."""
        if n:
            self.counts.append({"source_file": source_file, "reason": reason, "n_records": n})

    def write(self, out_dir: Path) -> pl.DataFrame:
        out_dir.mkdir(parents=True, exist_ok=True)
        rows = (pl.concat(self.frames) if self.frames
                else pl.DataFrame(schema=REJECT_SCHEMA))
        rows.write_parquet(out_dir / "rejected_records.parquet")
        per_row = rows.group_by("source_file", "reason").agg(pl.len().alias("n_records"))
        agg = pl.DataFrame(self.counts, schema={"source_file": pl.Utf8, "reason": pl.Utf8,
                                                "n_records": pl.UInt32})
        summary = (pl.concat([agg, per_row.cast({"n_records": pl.UInt32})])
                   .group_by("source_file", "reason").agg(pl.col("n_records").sum())
                   .sort("source_file", "reason"))
        summary.write_csv(out_dir / "rejection_summary.csv")
        return summary


def run_metadata(**extra) -> dict:
    libs = {p: version(p) for p in ("polars", "duckdb", "h3", "shapely", "scipy", "pyarrow")}
    return {"generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "python": platform.python_version(), "libraries": libs, **extra}


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, default=str, ensure_ascii=False))
