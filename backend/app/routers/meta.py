from fastapi import APIRouter

from .. import __version__
from ..deps import RegistryDep
from ..registry import RegionInfo
from ..schemas import Health, RegionOut

router = APIRouter(tags=["servicio"])


def _region_out(r: RegionInfo) -> RegionOut:
    return RegionOut(
        region=r.code,
        period={"start": r.period_start, "end": r.period_end},
        sp_nrt={"sp_cutoff": r.sp_cutoff, "nrt_start": r.nrt_start, "data_end": r.period_end},
        layers=r.layers,
        bbox=list(r.bbox),
        h3_event_res=int(r.h3.get("event_res", 7)),
        h3_available_res=[3, 5, 7],
        calibration_version=r.calibration_version,
        generated_utc=r.generated_utc,
    )


@router.get("/health", response_model=Health, summary="Estado del servicio")
def health(registry: RegistryDep) -> Health:
    n = len(registry.regions)
    return Health(
        status="ok" if n else "degraded",
        version=__version__,
        duckdb=registry.db.duckdb_version,
        regions_loaded=n,
    )


@router.get("/regions", response_model=list[RegionOut], summary="Regiones disponibles")
def regions(registry: RegistryDep) -> list[RegionOut]:
    """Regiones detectadas en DATA_ROOT, con su período, el corte SP/NRT y la versión de calibración."""
    return [_region_out(r) for _, r in sorted(registry.regions.items())]


@router.get("/regions/{code}", response_model=RegionOut, summary="Detalle de una región")
def region(code: str, registry: RegistryDep) -> RegionOut:
    return _region_out(registry.get(code))
