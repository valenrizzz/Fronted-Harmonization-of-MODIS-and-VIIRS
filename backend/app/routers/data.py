from typing import Annotated, Literal

from fastapi import APIRouter, Query, Request

from ..deps import Window, WindowDep
from ..errors import APIError
from ..schemas import CellsOut, SummaryOut, TimeseriesOut
from ..services import spatial as spatial_svc
from ..services import summary as summary_svc
from ..services import timeseries as ts_svc

router = APIRouter(tags=["datos"])


def _meta(w: Window, start=None, end=None) -> dict:
    return {
        "region": w.region.code,
        "start": start or w.start,
        "end": end or w.end,
        "bbox": w.bbox.as_list() if w.bbox else None,
        "calibration_version": w.region.calibration_version,
        "sp_cutoff": w.region.sp_cutoff,
    }


@router.get("/timeseries", response_model=TimeseriesOut, summary="Serie temporal armonizada")
def timeseries(
    w: WindowDep,
    granularity: Annotated[Literal["daily", "monthly"], Query()] = "monthly",
) -> dict:
    """Conteos observados y armonizados con IC 95 %, `reliability_tier` y capa SP/NRT.

    - Sin `bbox`: series precalculadas de la región (IC exactos).
    - Con `bbox`: suma de pesos de los eventos dentro del recorte.
    - `monthly` cubre meses completos: `start`/`end` se extienden al mes entero.
    - Días sin ningún satélite: `status = no_data` y valores `null` (no 0).
    """
    if granularity == "daily":
        points, s, e = ts_svc.daily(w), w.start, w.end
    else:
        points, s, e = ts_svc.monthly(w)
    return {
        **_meta(w, s, e),
        "granularity": granularity,
        "ci_method": "exact" if w.bbox is None else "sum_of_event_ci",
        "points": points,
    }


@router.get(
    "/spatial/cells",
    response_model=CellsOut,
    summary="Actividad agregada por celda H3",
    responses={200: {"content": {"application/geo+json": {}}}},
)
def spatial_cells(
    request: Request,
    w: WindowDep,
    zoom: Annotated[float | None, Query(ge=0, le=24, description="Zoom del mapa; elige la resolución")] = None,
    res: Annotated[int | None, Query(description="Resolución H3 explícita: 3, 5 o 7 (tiene prioridad sobre zoom)")] = None,
    confidence: Annotated[
        Literal["series", "all"],
        Query(description="'series' = confianza ≥ nominal; 'all' incluye eventos de confianza baja (peso 0)"),
    ] = "series",
    limit: Annotated[int | None, Query(ge=1, description="Máximo de celdas (tope: FIRE_API_MAX_CELLS)")] = None,
    format: Annotated[Literal["json", "geojson"], Query()] = "json",
):
    """Agrega eventos por celda H3 (res 3, 5 o 7). Si hay más celdas que el límite,
    pasa a una resolución más gruesa (`coarsened`) y, como último recurso, devuelve
    las celdas de mayor peso (`truncated`)."""
    max_cells = request.app.state.registry.settings.max_cells
    cap = min(limit or max_cells, max_cells)
    if res is None:
        res = spatial_svc.res_for_zoom(zoom) if zoom is not None else 5
    elif res not in spatial_svc.RES_COLUMN:
        raise APIError(422, "invalid_res", "res debe ser 3, 5 o 7", {"available": spatial_svc.AVAILABLE_RES})
    payload = {**_meta(w), **spatial_svc.cells(w, res, confidence, cap)}
    if format == "geojson":
        from fastapi.responses import JSONResponse

        body = spatial_svc.to_geojson(CellsOut(**payload).model_dump(mode="json"))
        return JSONResponse(body, media_type="application/geo+json")
    return payload


@router.get("/summary", response_model=SummaryOut, summary="KPIs del período")
def summary(w: WindowDep) -> dict:
    """Total armonizado (con IC), variación interanual (misma ventana un año antes),
    pico diario y mensual, y proporciones SP/NRT y por `reliability_tier` (ponderadas por peso)."""
    return {**_meta(w), **summary_svc.summarize(w)}
