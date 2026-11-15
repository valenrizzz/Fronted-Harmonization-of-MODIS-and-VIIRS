"""Etapa 2 — Estandarización al esquema canónico + filtros documentados.

Orden determinista de reglas (cada descarte queda en rejected_records con su motivo):
  1. invalid_value                 lat/lon/fecha/hora/FRP no parseables
  2. unknown_satellite             código de satélite no mapeado
  3. outside_region_polygon        dentro del bbox pero fuera del polígono de la región
  4. outside_satellite_window      fecha fuera del periodo o de la ventana operativa del satélite
  5. duplicate_record              misma detección en dos archivos (p.ej. país-2025 y global-2025)
  6. superseded_by_science_product NRT en fechas ya cubiertas por el producto científico (SP)
  7. invalid_confidence            confianza no interpretable
  8. type_<t>_non_vegetation       SP con type != 0 (volcán, fuente estática, offshore)
  9. static_source_cell            celda H3 con comportamiento de fuente fija (SP y NRT; ver static_source_cells)
 10. satellite_inactive_on_day     el día solar cae en un día sin cobertura o con caída del satélite
"""
from __future__ import annotations

import logging
from datetime import date
from pathlib import Path

import numpy as np
import polars as pl
from h3.api import basic_int as h3i

from .config import CONFIDENCE_LEVELS, PipelineCfg
from .lineage import RejectLog
from .regions import Region

log = logging.getLogger(__name__)

SATELLITE_MAP = {"Terra": "Terra", "T": "Terra", "Aqua": "Aqua", "A": "Aqua",
                 "N": "SNPP", "SNPP": "SNPP", "NPP": "SNPP", "Suomi NPP": "SNPP",
                 "N20": "NOAA20", "NOAA-20": "NOAA20", "J1": "NOAA20",
                 "N21": "NOAA21", "NOAA-21": "NOAA21", "J2": "NOAA21"}
VIIRS_CONF = {"l": 0, "low": 0, "n": 1, "nominal": 1, "h": 2, "high": 2}


def h3_cells(lat: np.ndarray, lon: np.ndarray, res: int) -> np.ndarray:
    f = h3i.latlng_to_cell
    return np.fromiter((f(a, b, res) for a, b in zip(lat.tolist(), lon.tolist())),
                       dtype=np.uint64, count=len(lat))


def _split(df: pl.DataFrame, bad: pl.Expr, reason: str, rej: RejectLog) -> pl.DataFrame:
    df = df.with_columns(bad.fill_null(True).alias("_bad"))
    rej.add(df.filter(pl.col("_bad")), reason)
    return df.filter(~pl.col("_bad")).drop("_bad")


def _in_intervals(col: str, ivs: list[tuple[date, date]]) -> pl.Expr:
    e = pl.lit(False)
    for a, b in ivs:
        e = e | pl.col(col).is_between(a, b)
    return e


def standardize(cfg: PipelineCfg, region: Region, row_files: list[Path],
                cov: dict, activity: pl.DataFrame, rej: RejectLog) -> tuple[pl.DataFrame, pl.DataFrame]:
    df = pl.concat([pl.read_parquet(f) for f in row_files], how="vertical_relaxed")
    log.info("Filas en bbox (todas las fuentes): %s", f"{df.height:,}")
    df = df.with_columns(pl.col("satellite_raw").replace_strict(SATELLITE_MAP, default=None).alias("satellite"))

    # 1-2
    df = _split(df, pl.any_horizontal(pl.col("lat", "lon", "acq_date", "frp").is_null())
                | ~pl.col("acq_time").str.contains(r"^\d{4}$"), "invalid_value", rej)
    rej.add(df.filter(pl.col("satellite").is_null()).with_columns(pl.col("satellite_raw").alias("satellite")),
            "unknown_satellite")
    df = df.filter(pl.col("satellite").is_not_null())

    # 3. polígono
    inside = region.contains(df["lon"].to_numpy(), df["lat"].to_numpy())
    df = _split(df, pl.Series(~inside), "outside_region_polygon", rej)

    # 4. periodo + ventana operativa
    sats = cfg.satellites
    win_ok = pl.lit(False)
    for name, s in sats.items():
        cond = (pl.col("satellite") == name) & (pl.col("acq_date") >= s.start)
        if s.end:
            cond = cond & (pl.col("acq_date") <= s.end)
        win_ok = win_ok | cond
    win_ok = win_ok & pl.col("acq_date").is_between(cfg.period.start, cfg.period.resolved_end)
    df = _split(df, ~win_ok, "outside_satellite_window", rej)

    # 5. duplicados exactos entre archivos (se conserva el de mayor prioridad)
    df = df.with_columns(pl.concat_str([pl.col("satellite"), pl.col("acq_date").cast(pl.Utf8),
                                        pl.col("acq_time"), pl.col("lat").round(5).cast(pl.Utf8),
                                        pl.col("lon").round(5).cast(pl.Utf8)], separator="|")
                         .alias("record_key"))
    df = df.sort("record_key", "file_priority", "source_file")
    df = _split(df, ~pl.col("record_key").is_first_distinct(), "duplicate_record", rej)

    # 6. NRT reemplazado por SP
    sup = pl.lit(False)
    for prod in {s.product for s in sats.values()}:
        sup = sup | ((pl.col("product") == prod) & _in_intervals("acq_date", cov.get((prod, "SP"), [])))
    df = _split(df, (pl.col("level") == "NRT") & sup, "superseded_by_science_product", rej)

    # 7. confianza -> rango ordinal (0 low, 1 nominal, 2 high)
    th = cfg.confidence.modis_thresholds
    modis_num = pl.col("confidence_raw").cast(pl.Int16, strict=False)
    instrument = pl.col("satellite").replace_strict({n: s.instrument for n, s in sats.items()})
    df = df.with_columns(instrument.alias("instrument"))
    rank = (pl.when(pl.col("instrument") == "MODIS")
            .then(pl.when(modis_num >= th["high"]).then(2)
                  .when(modis_num >= th["nominal"]).then(1)
                  .when(modis_num.is_between(0, 100)).then(0))
            .otherwise(pl.col("confidence_raw").str.to_lowercase()
                       .replace_strict(VIIRS_CONF, default=None)))
    df = df.with_columns(rank.cast(pl.Int8).alias("confidence_rank"))
    df = _split(df, pl.col("confidence_rank").is_null(), "invalid_confidence", rej)
    df = df.with_columns(pl.col("confidence_rank")
                         .replace_strict(dict(enumerate(CONFIDENCE_LEVELS)), return_dtype=pl.Utf8)
                         .alias("confidence_level"))

    # celdas H3
    res = cfg.grid.h3_resolution
    df = df.with_columns(pl.Series("h3_cell", h3_cells(df["lat"].to_numpy(), df["lon"].to_numpy(), res)))

    # 8. type (solo SP lo trae)
    keep = cfg.filters.keep_types
    nonveg = df.filter(pl.col("type").is_not_null() & ~pl.col("type").is_in(keep))
    for t in sorted(nonveg["type"].unique().to_list()):
        rej.add(nonveg.filter(pl.col("type") == t), f"type_{t}_non_vegetation")
    df = df.filter(pl.col("type").is_null() | pl.col("type").is_in(keep))

    # calidad del FRP: 0 = no disponible (-> nulo); > umbral = extremo (se conserva, marcado)
    fq = cfg.filters.frp
    df = df.with_columns(
        pl.when(pl.col("frp") <= 0).then(pl.lit("missing"))
          .when(pl.col("frp") > fq.extreme_mw).then(pl.lit("extreme")).otherwise(pl.lit("ok")).alias("frp_quality"))
    df = df.with_columns(pl.when(pl.col("frp_quality") == "missing").then(None).otherwise(pl.col("frp"))
                         .alias("frp"))

    # tiempo: timestamp UTC y día solar local
    ts = (pl.col("acq_date").cast(pl.Datetime("us", "UTC"))
          + pl.duration(hours=pl.col("acq_time").str.slice(0, 2).cast(pl.Int32),
                        minutes=pl.col("acq_time").str.slice(2, 2).cast(pl.Int32)))
    df = df.with_columns(ts.alias("timestamp_utc"))
    shift_us = ((pl.col("lon") / 15.0 - cfg.grid.day_start_solar_hour) * 3_600_000_000).cast(pl.Int64)
    df = df.with_columns((pl.col("timestamp_utc").dt.replace_time_zone(None)
                          + pl.duration(microseconds=shift_us)).dt.date().alias("solar_date"))

    # 9. fuentes estáticas a nivel de celda (aplica a SP y NRT por igual)
    static = static_source_cells(cfg, df, nonveg)
    if cfg.filters.static_sources.enabled and static.height:
        df = _split(df, pl.col("h3_cell").is_in(static["h3_cell"].to_list()), "static_source_cell", rej)

    # 10. constelación del día solar
    bits = {n: s.bit for n, s in sats.items()}
    df = df.join(activity.select(pl.col("date").alias("solar_date"), "active_mask", "epoch_id"),
                 on="solar_date", how="left")
    df = df.with_columns(pl.col("satellite").replace_strict(bits, return_dtype=pl.Int32).alias("sat_bit"))
    df = _split(df, (pl.col("active_mask").fill_null(0) & pl.col("sat_bit")) == 0,
                "satellite_inactive_on_day", rej)

    out = df.select(
        "record_key", "lat", "lon", "timestamp_utc", "acq_date", "acq_time", "solar_date",
        "frp", "frp_quality", "brightness", "brightness_2", "scan", "track",
        (pl.col("scan") * pl.col("track")).alias("pixel_area_km2"),
        "confidence_raw", "confidence_level", "confidence_rank",
        "satellite", "instrument", "sat_bit", "version", "daynight", "type",
        (pl.col("level") == "NRT").alias("is_provisional"),
        "product", "source_file", "h3_cell", "epoch_id",
    ).sort("timestamp_utc", "record_key")
    return out, static


def static_source_cells(cfg: PipelineCfg, veg: pl.DataFrame, nonveg: pl.DataFrame) -> pl.DataFrame:
    """Celdas H3 que se comportan como fuente fija (mechero, refinería, industria).

    Se evalúa sobre las detecciones 'vegetación' que sobrevivieron al filtro de `type`
    (SP y NRT), porque FIRMS tipifica por píxel y deja pasar píxeles vecinos de una fuente fija.
    Una celda es estática si cumple CUALQUIERA de:
      persistent  ≥ min_years años con ≥ min_days_per_year días de fuego y fracción nocturna ≥ umbral
      flare       algún año con ≥ min_days_in_a_year días, muy nocturna y FRP mediano bajo
      typed       FIRMS marcó ≥ N detecciones no-vegetación y son ≥ share de la celda
      chronic     muchos años con algo de actividad, nocturna y de FRP bajo (ingenios, plantas)
      modis_only  MODIS la detecta varios días en la era VIIRS pero VIIRS (más sensible) nunca:
                  falsa alarma persistente de MODIS (superficie caliente/reflectiva)
    Los incendios de vegetación son mayormente diurnos y de FRP alto; los mecheros son
    continuos, nocturnos y de FRP bajo (ver auditoría en audits/).
    """
    sc = cfg.filters.static_sources
    viirs_start = min(s.start for s in cfg.satellites.values() if s.instrument == "VIIRS")
    per_year = (veg.group_by("h3_cell", pl.col("solar_date").dt.year().alias("y"))
                .agg(pl.col("solar_date").n_unique().alias("nd")))
    stats = (per_year.group_by("h3_cell").agg(
                pl.col("nd").max().alias("max_days_in_a_year"),
                (pl.col("nd") >= sc.persistent.min_days_per_year).sum().alias("years_persistent"),
                (pl.col("nd") >= sc.chronic.min_days_per_active_year).sum().alias("years_active"))
             .join(veg.group_by("h3_cell").agg(
                pl.len().alias("n_veg_detections"),
                (pl.col("daynight") == "N").mean().alias("night_frac"),
                pl.col("frp").median().alias("frp_median"),
                pl.col("solar_date").filter((pl.col("instrument") == "MODIS")
                                            & (pl.col("solar_date") >= viirs_start)).n_unique()
                  .alias("modis_days_viirs_era"),
                pl.col("solar_date").filter(pl.col("instrument") == "MODIS").dt.year().n_unique().alias("modis_years"),
                (pl.col("instrument") == "VIIRS").sum().alias("n_viirs_detections")), on="h3_cell")
             .join(nonveg.group_by("h3_cell").agg(pl.len().alias("n_nonveg_detections")), on="h3_cell", how="full",
                   coalesce=True)
             .with_columns(pl.col("n_nonveg_detections", "n_veg_detections", "max_days_in_a_year",
                                  "years_persistent", "years_active", "modis_days_viirs_era", "modis_years",
                                  "n_viirs_detections").fill_null(0)))
    stats = stats.with_columns(
        (pl.col("n_nonveg_detections") / (pl.col("n_nonveg_detections") + pl.col("n_veg_detections")))
        .alias("nonveg_share"))
    p, f, t, c, mo = sc.persistent, sc.flare, sc.typed, sc.chronic, sc.modis_only
    rules = {
        "persistent": (pl.col("years_persistent") >= p.min_years) & (pl.col("night_frac") >= p.min_night_frac),
        "flare": (pl.col("max_days_in_a_year") >= f.min_days_in_a_year) & (pl.col("night_frac") >= f.min_night_frac)
                 & (pl.col("frp_median") <= f.max_median_frp_mw),
        "typed": (pl.col("n_nonveg_detections") >= t.min_nonveg_detections)
                 & (pl.col("nonveg_share") >= t.min_nonveg_share),
        "chronic": (pl.col("years_active") >= c.min_active_years) & (pl.col("night_frac") >= c.min_night_frac)
                   & (pl.col("frp_median") <= c.max_median_frp_mw),
        "modis_only": (pl.col("modis_days_viirs_era") >= mo.min_modis_days_viirs_era)
                      & (pl.col("modis_years") >= mo.min_modis_years)
                      & (pl.col("n_viirs_detections") <= mo.max_viirs_detections),
    }
    stats = stats.with_columns([r.fill_null(False).alias(f"rule_{k}") for k, r in rules.items()])
    flagged = stats.filter(pl.any_horizontal([pl.col(f"rule_{k}") for k in rules]))
    return flagged.sort("h3_cell")
