"""Dependencias comunes: región, ventana de fechas, bbox y cabeceras de caché."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Annotated

from fastapi import Depends, Query, Request, Response

from .db import ReadOnlyDB
from .errors import APIError, NotModified
from .registry import RegionInfo, Registry


@dataclass(frozen=True)
class BBox:
    west: float
    south: float
    east: float
    north: float

    def as_list(self) -> list[float]:
        return [self.west, self.south, self.east, self.north]


@dataclass(frozen=True)
class Window:
    region: RegionInfo
    db: ReadOnlyDB
    start: date
    end: date
    bbox: BBox | None


def get_registry(request: Request) -> Registry:
    registry: Registry = request.app.state.registry
    registry.maybe_reload()
    return registry


def parse_bbox(raw: str | None) -> BBox | None:
    if raw is None or raw.strip() == "":
        return None
    try:
        w, s, e, n = (float(x) for x in raw.split(","))
    except ValueError:
        raise APIError(422, "invalid_bbox", "bbox debe ser 'oeste,sur,este,norte' (4 números en grados)")
    if not (-180 <= w <= 180 and -180 <= e <= 180):
        raise APIError(422, "invalid_bbox", "Longitudes fuera de [-180, 180]")
    if not (-90 <= s <= 90 and -90 <= n <= 90) or s >= n:
        raise APIError(422, "invalid_bbox", "Latitudes fuera de [-90, 90] o sur >= norte")
    return BBox(w, s, e, n)  # oeste > este = cruza el antimeridiano


def get_window(
    request: Request,
    response: Response,
    registry: Annotated[Registry, Depends(get_registry)],
    region: Annotated[str, Query(description="Código de región (ISO3), p. ej. ARG", examples=["ARG"])],
    start: Annotated[date | None, Query(description="Día solar inicial (incl.). Por defecto, inicio del período")] = None,
    end: Annotated[date | None, Query(description="Día solar final (incl.). Por defecto, último dato")] = None,
    bbox: Annotated[str | None, Query(description="Recorte espacial 'oeste,sur,este,norte' en grados")] = None,
) -> Window:
    info = registry.get(region)
    s = start or info.period_start
    e = end or info.period_end
    if s > e:
        raise APIError(422, "invalid_range", "start debe ser anterior o igual a end")
    if e < info.period_start or s > info.period_end:
        raise APIError(
            422,
            "range_out_of_period",
            f"El rango no se superpone con el período de {info.code}",
            {"period": [info.period_start.isoformat(), info.period_end.isoformat()]},
        )
    window = Window(
        region=info,
        db=registry.db,
        start=max(s, info.period_start),
        end=min(e, info.period_end),
        bbox=parse_bbox(bbox),
    )
    apply_cache_headers(request, response, info.etag, registry.settings.cache_max_age)
    return window


def apply_cache_headers(request: Request, response: Response, etag: str, max_age: int) -> None:
    headers = {"ETag": etag, "Cache-Control": f"public, max-age={max_age}"}
    if etag in [t.strip() for t in request.headers.get("if-none-match", "").split(",")]:
        raise NotModified(headers)
    response.headers.update(headers)


WindowDep = Annotated[Window, Depends(get_window)]
RegistryDep = Annotated[Registry, Depends(get_registry)]
