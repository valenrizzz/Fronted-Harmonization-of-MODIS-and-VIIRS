"""Carga y validación de la configuración (pipeline.yaml + regions.yaml)."""
from __future__ import annotations

import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, Field, field_validator

PROJECT_ROOT = Path(__file__).resolve().parents[2]
CONFIDENCE_LEVELS = ("low", "nominal", "high")  # orden ordinal 0 < 1 < 2


class SatelliteCfg(BaseModel):
    instrument: Literal["MODIS", "VIIRS"]
    product: str
    bit: int
    start: date
    end: date | None = None


class PersistentRule(BaseModel):
    min_days_per_year: int = 30
    min_years: int = 2
    min_night_frac: float = 0.5


class FlareRule(BaseModel):
    min_days_in_a_year: int = 60
    min_night_frac: float = 0.6
    max_median_frp_mw: float = 3.0


class TypedRule(BaseModel):
    min_nonveg_detections: int = 10
    min_nonveg_share: float = 0.25


class ChronicRule(BaseModel):
    min_active_years: int = 8
    min_days_per_active_year: int = 5
    min_night_frac: float = 0.6
    max_median_frp_mw: float = 3.0


class ModisOnlyRule(BaseModel):
    min_modis_days_viirs_era: int = 5
    min_modis_years: int = 5
    max_viirs_detections: int = 0


class FrpCfg(BaseModel):
    extreme_mw: float = 5000.0


class StaticSourcesCfg(BaseModel):
    enabled: bool = True
    persistent: PersistentRule = PersistentRule()
    flare: FlareRule = FlareRule()
    typed: TypedRule = TypedRule()
    chronic: ChronicRule = ChronicRule()
    modis_only: ModisOnlyRule = ModisOnlyRule()


class FiltersCfg(BaseModel):
    keep_types: list[int] = [0]
    static_sources: StaticSourcesCfg = StaticSourcesCfg()
    frp: FrpCfg = FrpCfg()


class AvailabilityCfg(BaseModel):
    detect_outages: bool = True
    min_expected_detections: float = 20
    min_expected_run: float = 100
    suspect_zero_min_run: int = 3
    ratio_window_days: int = 30
    climatology_window_days: int = 15


class ConfidenceCfg(BaseModel):
    modis_thresholds: dict[str, int] = {"nominal": 30, "high": 80}
    series_min_level: Literal["low", "nominal", "high"] = "nominal"

    @property
    def series_min_rank(self) -> int:
        return CONFIDENCE_LEVELS.index(self.series_min_level)


class GridCfg(BaseModel):
    h3_resolution: int = 7
    day_start_solar_hour: float = 0.0


class BootstrapCfg(BaseModel):
    n: int = 1000
    seed: int = 20261115
    ci: float = 0.95


class SmoothingCfg(BaseModel):
    method: Literal["harmonic", "moving_average", "none"] = "harmonic"
    harmonics: int = 2
    window: int = 3


class CalibrationCfg(BaseModel):
    reference: str = "auto"
    window: Literal["adjacent", "all"] = "adjacent"
    min_window_days: int = 60
    proximity_years: float | None = 2
    factor_scope: Literal["month_of_year", "global"] = "month_of_year"
    daily_interpolation: bool = True
    smoothing: SmoothingCfg = SmoothingCfg()
    bootstrap: BootstrapCfg = BootstrapCfg()


class ApiCfg(BaseModel):
    enabled: bool = True
    area_url: str
    availability_url: str
    map_key_env: str = "FIRMS_MAP_KEY"
    day_range: int = 5
    timeout_s: int = 120
    max_retries: int = 4
    products: dict[str, dict[str, str]]

    def map_key(self) -> str | None:
        key = os.environ.get(self.map_key_env)
        if key:
            return key
        env_file = PROJECT_ROOT / ".env"
        if env_file.exists():
            for line in env_file.read_text().splitlines():
                if line.strip().startswith(f"{self.map_key_env}="):
                    return line.split("=", 1)[1].strip()
        return None


class PathsCfg(BaseModel):
    local_sources: list[Path]
    data_dir: Path

    @field_validator("local_sources", mode="before")
    @classmethod
    def _expand(cls, v):
        return [Path(os.path.expanduser(p)) for p in v]


class PeriodCfg(BaseModel):
    start: date
    end: date | None = None

    @property
    def resolved_end(self) -> date:
        return self.end or (datetime.now(timezone.utc).date() - timedelta(days=1))


class PipelineCfg(BaseModel):
    paths: PathsCfg
    period: PeriodCfg
    satellites: dict[str, SatelliteCfg]
    filters: FiltersCfg = FiltersCfg()
    availability: AvailabilityCfg = AvailabilityCfg()
    confidence: ConfidenceCfg = ConfidenceCfg()
    grid: GridCfg = GridCfg()
    calibration: CalibrationCfg = CalibrationCfg()
    api: ApiCfg
    export: dict = Field(default_factory=lambda: {"csv": True})

    @property
    def data_dir(self) -> Path:
        d = self.paths.data_dir
        return d if d.is_absolute() else PROJECT_ROOT / d

    @property
    def products(self) -> dict[str, list[str]]:
        """Familia de producto -> satélites que la componen (MODIS -> [Terra, Aqua])."""
        out: dict[str, list[str]] = {}
        for name, s in self.satellites.items():
            out.setdefault(s.product, []).append(name)
        return out


class RegionCfg(BaseModel):
    code: str
    kind: Literal["country", "bbox", "geojson"]
    iso_a3: str | None = None
    bbox: list[float] | None = None
    file: str | None = None
    firms_country_files: list[str] = []
    polygon_buffer_deg: float = 0.0


class BoundariesCfg(BaseModel):
    url: str
    file: str
    id_field: str = "ADM0_A3"


def load_pipeline(path: Path | None = None) -> PipelineCfg:
    path = path or PROJECT_ROOT / "config" / "pipeline.yaml"
    return PipelineCfg.model_validate(yaml.safe_load(path.read_text()))


def load_region(code: str, path: Path | None = None) -> tuple[RegionCfg, BoundariesCfg]:
    path = path or PROJECT_ROOT / "config" / "regions.yaml"
    raw = yaml.safe_load(path.read_text())
    bnd = BoundariesCfg.model_validate(raw["boundaries"])
    regions = raw.get("regions") or {}
    code = code.upper()
    if code in regions:
        reg = RegionCfg.model_validate({"code": code, **regions[code]})
    elif len(code) == 3:
        # Cualquier país sin override: se resuelve por ISO3 en Natural Earth.
        reg = RegionCfg(code=code, kind="country", iso_a3=code)
    else:
        raise ValueError(f"Región '{code}' no declarada en regions.yaml y no es un ISO3")
    return reg, bnd
