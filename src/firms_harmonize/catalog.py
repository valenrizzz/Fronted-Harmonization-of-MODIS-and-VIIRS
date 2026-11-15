"""Catálogo de archivos fuente: descubre, clasifica y calcula la cobertura temporal.

Formatos de FIRMS reconocidos (por nombre de archivo):
  * por país/año:   modis_YYYY_<País>.csv, viirs-snpp_YYYY_<País>.csv, viirs-jpss1_..., viirs-jpss2_...
  * descarga global: fire_archive_<M-C61|SV-C2|J1V-C2|J2V-C2>_<id>.csv  y  fire_nrt_<...>.csv
  * API por región: <data_dir>/raw/firms_api/<REGION>/<PRODUCTO_API>/<inicio>_<fin>.csv
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path

COUNTRY_RE = re.compile(r"^(modis|viirs-snpp|viirs-jpss1|viirs-jpss2)_(\d{4})_(.+)\.csv$")
GLOBAL_RE = re.compile(r"^fire_(archive|nrt)_(M-C61|M-C6|SV-C2|J1V-C2|J2V-C2)_\d+\.csv$")
API_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})\.csv$")

COUNTRY_PREFIX = {"modis": "MODIS", "viirs-snpp": "SNPP", "viirs-jpss1": "NOAA20", "viirs-jpss2": "NOAA21"}
API_PRODUCT_FAMILY = {"MODIS": "MODIS", "VIIRS_SNPP": "SNPP", "VIIRS_NOAA20": "NOAA20", "VIIRS_NOAA21": "NOAA21"}
GLOBAL_CODE = {"M-C61": "MODIS", "M-C6": "MODIS", "SV-C2": "SNPP", "J1V-C2": "NOAA20", "J2V-C2": "NOAA21"}


@dataclass
class SourceFile:
    path: Path
    product: str            # MODIS | SNPP | NOAA20 | NOAA21
    kind: str               # country | global | api
    level: str              # SP (científico) | NRT (provisorio)
    scope: str              # país, 'global' o código de región (API)
    year: int | None = None
    cov_start: date | None = None   # cobertura temporal (se completa en ingest para 'global')
    cov_end: date | None = None

    @property
    def source_id(self) -> str:
        """Identificador estable y legible (se usa en linaje y como nombre de parquet)."""
        parts = self.path.parts
        return "__".join(parts[-3:]).replace(".csv", "")

    @property
    def priority(self) -> int:
        """Menor = preferido al resolver registros duplicados entre archivos."""
        return {("global", "SP"): 0, ("country", "SP"): 1, ("api", "SP"): 2,
                ("global", "NRT"): 3, ("api", "NRT"): 4}[(self.kind, self.level)]


def classify(path: Path) -> SourceFile | None:
    name = path.name
    if m := COUNTRY_RE.match(name):
        y = int(m.group(2))
        return SourceFile(path, COUNTRY_PREFIX[m.group(1)], "country", "SP", m.group(3), year=y,
                          cov_start=date(y, 1, 1), cov_end=date(y, 12, 31))
    if m := GLOBAL_RE.match(name):
        return SourceFile(path, GLOBAL_CODE[m.group(2)], "global",
                          "SP" if m.group(1) == "archive" else "NRT", "global")
    if (m := API_RE.match(name)) and "firms_api" in path.parts:
        region, api_product = path.parts[-3], path.parts[-2]
        prod = API_PRODUCT_FAMILY.get(api_product.rsplit("_", 1)[0])
        if prod is None:
            return None
        return SourceFile(path, prod, "api", "NRT" if api_product.endswith("NRT") else "SP", region,
                          cov_start=date.fromisoformat(m.group(1)), cov_end=date.fromisoformat(m.group(2)))
    return None


def discover(roots: list[Path], api_dir: Path, region_code: str,
             country_files: list[str]) -> tuple[list[SourceFile], list[Path]]:
    """Devuelve (archivos relevantes para la región, CSV no reconocidos)."""
    selected, unknown = [], []
    wanted = {c.lower() for c in country_files}
    candidates = [p for r in roots if r.exists() for p in sorted(r.rglob("*.csv"))]
    if (api_dir / region_code).exists():
        candidates += sorted((api_dir / region_code).rglob("*.csv"))
    for p in candidates:
        sf = classify(p)
        if sf is None:
            unknown.append(p)
        elif sf.kind == "country" and sf.scope.lower() not in wanted:
            continue
        elif sf.kind == "api" and sf.scope != region_code:
            continue
        else:
            selected.append(sf)
    return selected, unknown


def coverage(files: list[SourceFile]) -> dict[tuple[str, str], list[tuple[date, date]]]:
    """(producto, nivel) -> intervalos de fechas cubiertos (fusionados)."""
    out: dict[tuple[str, str], list[tuple[date, date]]] = {}
    for f in files:
        if f.cov_start and f.cov_end:
            out.setdefault((f.product, f.level), []).append((f.cov_start, f.cov_end))
    for k, iv in out.items():
        iv.sort()
        merged = [iv[0]]
        for s, e in iv[1:]:
            ls, le = merged[-1]
            if (s - le).days <= 1:
                merged[-1] = (ls, max(le, e))
            else:
                merged.append((s, e))
        out[k] = merged
    return out
