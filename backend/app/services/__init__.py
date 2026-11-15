"""Lógica de consulta (sin dependencias de FastAPI)."""

from __future__ import annotations

from typing import Any

from ..deps import BBox

STATUS_BY_FLAG = {"ok": "ok", "no_satellite": "no_data", "suspect_zero": "suspect_zero"}


def bbox_clause(bbox: BBox | None) -> tuple[str, list[Any]]:
    """Filtro sobre el centroide de la celda H3 res 7 de cada evento."""
    if bbox is None:
        return "", []
    if bbox.west <= bbox.east:
        lon = "cell_lon BETWEEN ? AND ?"
    else:  # cruza el antimeridiano
        lon = "(cell_lon >= ? OR cell_lon <= ?)"
    return (
        f" AND cell_lat BETWEEN ? AND ? AND {lon}",
        [bbox.south, bbox.north, bbox.west, bbox.east],
    )


def rnd(x: float | None, nd: int = 3) -> float | None:
    return None if x is None else round(float(x), nd)
