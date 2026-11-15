"""Contratos de la API (Pydantic v2).

El sensor queda abstraído: ninguna respuesta expone satélites, épocas ni máscaras.
"""

from __future__ import annotations

from datetime import date as Date
from typing import Literal

from pydantic import BaseModel, Field

Layer = Literal["SP", "NRT", "MIXED"]
Tier = Literal["high", "medium", "low"]
Status = Literal["ok", "partial", "suspect_zero", "no_data"]


class Health(BaseModel):
    status: Literal["ok", "degraded"]
    version: str
    duckdb: str
    regions_loaded: int


class Period(BaseModel):
    start: Date
    end: Date


class SpNrt(BaseModel):
    sp_cutoff: Date = Field(description="Último día solar con datos definitivos (SP)")
    nrt_start: Date | None = Field(description="Primer día solar con datos provisorios (NRT)")
    data_end: Date


class LayerInfo(BaseModel):
    events: int
    first: Date | None = None
    last: Date | None = None


class RegionOut(BaseModel):
    region: str
    period: Period
    sp_nrt: SpNrt
    layers: dict[str, LayerInfo]
    bbox: list[float] = Field(description="oeste, sur, este, norte")
    h3_event_res: int
    h3_available_res: list[int]
    calibration_version: str
    generated_utc: str


class ResponseMeta(BaseModel):
    region: str
    start: Date
    end: Date
    bbox: list[float] | None
    calibration_version: str
    sp_cutoff: Date


class TimeseriesPoint(BaseModel):
    date: Date = Field(description="Día solar (daily) o primer día del mes (monthly)")
    events_observed: int | None = Field(description="Eventos (celda H3 × día) con confianza ≥ nominal")
    events_harmonized: float | None = Field(description="Conteo armonizado (unidades de la constelación de referencia)")
    ci_low: float | None
    ci_high: float | None
    events_harmonized_gapfilled: float | None = Field(
        None, description="Solo monthly sin bbox: rellena días sin dato"
    )
    gapfilled_ci_low: float | None = None
    gapfilled_ci_high: float | None = None
    coverage_frac: float | None = Field(None, description="Fracción de días observados (monthly)")
    reliability_tier: Tier | None
    layer: Layer
    status: Status


class TimeseriesOut(ResponseMeta):
    granularity: Literal["daily", "monthly"]
    ci_method: Literal["exact", "sum_of_event_ci"]
    points: list[TimeseriesPoint]


class Cell(BaseModel):
    h3: str
    lat: float
    lon: float
    events: int
    events_nrt: int = Field(description="Eventos provisorios (NRT) dentro de 'events'")
    weight: float = Field(description="Suma de harmonized_weight")
    weight_ci_low: float
    weight_ci_high: float
    frp_max: float | None
    frp_mean: float | None
    reliability_tier: Tier = Field(description="Nivel que concentra la mayor parte del peso de la celda")


class CellsOut(ResponseMeta):
    res: int
    res_requested: int
    coarsened: bool
    truncated: bool
    n_cells: int
    n_cells_total: int
    confidence: Literal["series", "all"]
    cells: list[Cell]


class Total(BaseModel):
    value: float
    ci_low: float
    ci_high: float


class YoY(BaseModel):
    available: bool
    previous_start: Date | None = None
    previous_end: Date | None = None
    previous_value: float | None = None
    change_pct: float | None = None
    reason: str | None = None


class Peak(BaseModel):
    date: Date
    events_harmonized: float


class SummaryOut(ResponseMeta):
    total_harmonized: Total
    total_observed: int
    yoy: YoY
    peak_day: Peak | None
    peak_month: Peak | None
    layer_share: dict[str, float]
    reliability_share: dict[str, float]
    days_total: int
    days_no_data: int
