"""Resolución de regiones: geometría, bbox y filtro punto-en-polígono.

Una región es agnóstica: país (ISO3 vía Natural Earth), bbox o GeoJSON propio.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import requests
import shapely
from shapely.geometry import box, shape
from shapely.ops import unary_union

from .config import BoundariesCfg, PipelineCfg, RegionCfg
from .lineage import sha256_file

log = logging.getLogger(__name__)


@dataclass
class Region:
    code: str
    geometry: shapely.Geometry
    bbox: tuple[float, float, float, float]          # lon_min, lat_min, lon_max, lat_max
    firms_country_files: list[str]
    provenance: dict = field(default_factory=dict)

    def contains(self, lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
        """Vectorizado; los puntos sobre el borde cuentan como dentro."""
        return shapely.intersects_xy(self.geometry, lon, lat)

    @property
    def bbox_str(self) -> str:
        return ",".join(f"{v:.4f}" for v in self.bbox)


def _ensure_boundaries(cfg: PipelineCfg, bnd: BoundariesCfg) -> Path:
    path = cfg.data_dir / bnd.file
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        log.info("Descargando límites Natural Earth -> %s", path)
        r = requests.get(bnd.url, timeout=300)
        r.raise_for_status()
        tmp = path.with_suffix(".part")
        tmp.write_bytes(r.content)
        tmp.rename(path)
    return path


def resolve_region(cfg: PipelineCfg, reg: RegionCfg, bnd: BoundariesCfg) -> Region:
    prov: dict = {"kind": reg.kind}
    files = list(reg.firms_country_files)
    if reg.kind == "country":
        path = _ensure_boundaries(cfg, bnd)
        gj = json.loads(path.read_text())
        feats = [f for f in gj["features"] if f["properties"].get(bnd.id_field) == reg.iso_a3]
        if not feats:
            raise ValueError(f"ISO3 '{reg.iso_a3}' no encontrado en {path.name} ({bnd.id_field})")
        geom = unary_union([shape(f["geometry"]) for f in feats])
        if not files:  # convención FIRMS: espacios -> '_'
            files = [feats[0]["properties"]["NAME"].replace(" ", "_")]
        prov.update(source=bnd.url, file=str(path.name), sha256=sha256_file(path),
                    feature_name=feats[0]["properties"].get("NAME"))
    elif reg.kind == "bbox":
        geom = box(*reg.bbox)
        prov.update(bbox=reg.bbox)
    else:
        path = cfg.data_dir / reg.file
        gj = json.loads(path.read_text())
        geoms = [shape(f["geometry"]) for f in gj.get("features", [gj])]
        geom = unary_union(geoms)
        prov.update(file=str(path), sha256=sha256_file(path))
    if reg.polygon_buffer_deg:
        geom = geom.buffer(reg.polygon_buffer_deg)
    shapely.prepare(geom)
    prov["polygon_buffer_deg"] = reg.polygon_buffer_deg
    return Region(code=reg.code, geometry=geom, bbox=tuple(geom.bounds),
                  firms_country_files=files, provenance=prov)
