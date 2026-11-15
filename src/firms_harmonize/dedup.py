"""Etapa 3 — Deduplicación espaciotemporal: celda H3 × día solar = 1 evento.

Cada evento conserva métricas agregadas y linaje (qué satélites/instrumentos lo vieron).
Se guardan dos máscaras de bits por evento:
  * sat_mask         — satélites con cualquier detección (todas las confianzas)
  * sat_mask_series  — satélites con detección de confianza >= series_min_level
La segunda permite contar, sin re-leer detecciones, cuántos eventos habría visto
cualquier SUB-constelación (base de la calibración).
"""
from __future__ import annotations

import numpy as np
import polars as pl
from h3.api import basic_int as h3i

from .config import CONFIDENCE_LEVELS, PipelineCfg
from .constellation import epoch_name


def build_events(cfg: PipelineCfg, det: pl.DataFrame) -> pl.DataFrame:
    min_rank = cfg.confidence.series_min_rank
    total = sum(s.bit for s in cfg.satellites.values())
    mask_names = {m: epoch_name(cfg, m) for m in range(total + 1)}
    ev = (det.group_by("h3_cell", "solar_date")
          .agg(
              pl.len().cast(pl.UInt32).alias("n_raw_detections"),
              pl.col("satellite").n_unique().cast(pl.UInt8).alias("n_satellites"),
              (pl.col("instrument") == "MODIS").sum().cast(pl.UInt32).alias("n_modis_detections"),
              (pl.col("instrument") == "VIIRS").sum().cast(pl.UInt32).alias("n_viirs_detections"),
              pl.col("sat_bit").unique().sum().cast(pl.Int32).alias("sat_mask"),
              pl.col("sat_bit").filter(pl.col("confidence_rank") >= min_rank).unique().sum()
                .cast(pl.Int32).alias("sat_mask_series"),
              pl.col("frp").max().alias("frp_max"),
              pl.col("frp").mean().cast(pl.Float32).alias("frp_mean"),
              (pl.col("frp_quality") == "missing").sum().cast(pl.UInt32).alias("_n_frp_missing"),
              (pl.col("frp_quality") == "extreme").any().alias("_frp_extreme"),
              pl.col("confidence_rank").max().alias("max_confidence_rank"),
              pl.col("timestamp_utc").min().alias("first_detection_utc"),
              pl.col("timestamp_utc").max().alias("last_detection_utc"),
              pl.col("is_provisional").all().alias("is_provisional"),
              pl.col("is_provisional").sum().cast(pl.UInt32).alias("n_provisional_detections"),
              pl.col("epoch_id").first(),
          ))
    ev = ev.with_columns(
        pl.col("sat_mask_series").fill_null(0),
        pl.col("sat_mask").replace_strict(mask_names, return_dtype=pl.Utf8).alias("satellites"),
        pl.col("max_confidence_rank").replace_strict(dict(enumerate(CONFIDENCE_LEVELS)), return_dtype=pl.Utf8)
          .alias("max_confidence"),
    ).with_columns((pl.col("sat_mask_series") > 0).alias("in_series"),
                   pl.when(pl.col("frp_max").is_null()).then(pl.lit("missing"))
                     .when(pl.col("_frp_extreme")).then(pl.lit("extreme"))
                     .when(pl.col("_n_frp_missing") > 0).then(pl.lit("partial"))
                     .otherwise(pl.lit("ok")).alias("frp_quality")).drop("_n_frp_missing", "_frp_extreme")
    # centroide de celda + id H3 en hex (legible para la web)
    cells = ev.select(pl.col("h3_cell").unique().sort())
    arr = cells["h3_cell"].to_numpy()
    ll = np.array([h3i.cell_to_latlng(int(c)) for c in arr]) if len(arr) else np.empty((0, 2))
    cells = cells.with_columns(pl.Series("cell_lat", ll[:, 0]), pl.Series("cell_lon", ll[:, 1]),
                               pl.Series("h3_index", [h3i.int_to_str(int(c)) for c in arr], dtype=pl.Utf8))
    return (ev.join(cells, on="h3_cell", how="left")
            .sort("solar_date", "h3_cell")
            .select("h3_index", "h3_cell", "cell_lat", "cell_lon", "solar_date", "epoch_id",
                    "n_raw_detections", "n_satellites", "satellites",
                    "n_modis_detections", "n_viirs_detections", "sat_mask", "sat_mask_series",
                    "frp_max", "frp_mean", "frp_quality", "max_confidence", "max_confidence_rank", "in_series",
                    "first_detection_utc", "last_detection_utc", "is_provisional",
                    "n_provisional_detections"))
