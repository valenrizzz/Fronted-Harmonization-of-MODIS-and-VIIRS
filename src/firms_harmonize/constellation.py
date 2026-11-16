"""Constelación activa por día: qué satélites podían observar cada fecha.

Un satélite está activo el día d si:  start <= d <= end  (config)  Y  d está cubierto por
algún archivo (SP o NRT) de su familia de producto. Así un hueco de datos no se confunde
con "ausencia de fuego".
"""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import date
from pathlib import Path

import duckdb
import polars as pl

from .config import PipelineCfg

log = logging.getLogger(__name__)


def daily_activity(cfg: PipelineCfg, cov: dict[tuple[str, str], list[tuple[date, date]]],
                   end: date | None = None) -> pl.DataFrame:
    """DataFrame [date, active_mask, epoch_id, n_active]."""
    end = end or cfg.period.resolved_end
    days = pl.date_range(cfg.period.start, end, "1d", eager=True).alias("date")
    df = pl.DataFrame(days)
    mask = pl.lit(0, dtype=pl.Int32)
    for name, s in cfg.satellites.items():
        ivs = cov.get((s.product, "SP"), []) + cov.get((s.product, "NRT"), [])
        covered = pl.lit(False)
        for a, b in ivs:
            covered = covered | pl.col("date").is_between(a, b)
        win = pl.col("date") >= s.start
        if s.end:
            win = win & (pl.col("date") <= s.end)
        mask = mask + pl.when(win & covered).then(s.bit).otherwise(0)
    df = df.with_columns(mask.alias("active_mask"))
    return df.with_columns(
        pl.col("active_mask").map_elements(lambda m: epoch_name(cfg, m), return_dtype=pl.Utf8).alias("epoch_id"),
        pl.col("active_mask").map_elements(lambda m: bin(m).count("1"), return_dtype=pl.Int8).alias("n_active"),
    )


def daily_satellite_counts(cfg: PipelineCfg, row_files: list, satellite_map: dict) -> pl.DataFrame:
    """Detecciones únicas por satélite y día solar en TODO el bbox (cualquier tipo/confianza).
    Se usa solo como evidencia de que el satélite estaba operando."""
    lf = pl.concat([pl.scan_parquet(f).select("lat", "lon", "acq_date", "acq_time", "satellite_raw")
                    for f in row_files], how="vertical_relaxed")
    # mismo cálculo de día solar que standardize (microsegundos exactos)
    shift_us = ((pl.col("lon") / 15.0 - cfg.grid.day_start_solar_hour) * 3_600_000_000).cast(pl.Int64)
    solar = (pl.col("acq_date").cast(pl.Datetime("us"))
             + pl.duration(hours=pl.col("acq_time").str.slice(0, 2).cast(pl.Int32),
                           minutes=pl.col("acq_time").str.slice(2, 2).cast(pl.Int32))
             + pl.duration(microseconds=shift_us)).dt.date()
    return (lf.filter(pl.col("lat").is_not_null() & pl.col("lon").is_not_null() & pl.col("acq_date").is_not_null()
                      & pl.col("acq_time").str.contains(r"^\d{4}$"))
            .with_columns(pl.col("satellite_raw").replace_strict(satellite_map, default=None).alias("satellite"))
            .filter(pl.col("satellite").is_not_null())
            .unique(["satellite", "acq_date", "acq_time", pl.col("lat").round(5), pl.col("lon").round(5)])
            .with_columns(solar.alias("date"))
            .group_by("date", "satellite").agg(pl.len().alias("n"))
            .collect())


REFERENCE_CACHE_VERSION = 1


def reference_satellite_counts(cfg: PipelineCfg, files: list, cache_dir: Path,
                               satellite_map: dict, threads: int = 8) -> pl.DataFrame:
    """Detecciones por satélite y día solar en la zona de referencia (availability.reference).

    Se calcula con DuckDB sobre los CSV in-place (sin copiar filas) y se cachea por
    (archivos, tamaño, mtime, bbox). Solo es evidencia de que el satélite estaba operando:
    un mismo píxel presente en un archivo por país y en una descarga global se cuenta dos
    veces, lo cual no afecta a un umbral de presencia."""
    ref = cfg.availability.reference
    lon0, lat0, lon1, lat1 = ref.bbox
    key_src = {"v": REFERENCE_CACHE_VERSION, "bbox": list(ref.bbox), "solar_h": cfg.grid.day_start_solar_hour,
               "files": sorted([str(f.path), f.path.stat().st_size, f.path.stat().st_mtime] for f in files)}
    key = hashlib.sha1(json.dumps(key_src).encode()).hexdigest()[:16]
    out = cache_dir / f"satellite_counts_{key}.parquet"
    if out.exists():
        return pl.read_parquet(out)

    con = duckdb.connect()
    con.execute(f"SET threads={threads}")
    parts = []
    for i, f in enumerate(files, 1):
        log.info("[referencia %d/%d] %s", i, len(files), f.source_id)
        src = f"read_csv('{f.path}', all_varchar=true, header=true)"
        rows = con.execute(f"""
            WITH t AS (
              SELECT trim(satellite) AS sat, TRY_CAST(latitude AS DOUBLE) AS lat, TRY_CAST(longitude AS DOUBLE) AS lon,
                     TRY_CAST(acq_date AS DATE) AS d, lpad(trim(acq_time), 4, '0') AS hhmm
              FROM {src})
            SELECT sat,
                   CAST(CAST(d AS TIMESTAMP)
                        + to_minutes(CAST(substr(hhmm, 1, 2) AS INT) * 60 + CAST(substr(hhmm, 3, 2) AS INT))
                        + to_microseconds(CAST((lon / 15.0 - {cfg.grid.day_start_solar_hour}) * 3600000000 AS BIGINT))
                        AS DATE) AS date,
                   count(*) AS n
            FROM t
            WHERE d IS NOT NULL AND regexp_matches(hhmm, '^[0-9]{{4}}$')
              AND lat BETWEEN {lat0} AND {lat1} AND lon BETWEEN {lon0} AND {lon1}
            GROUP BY ALL""").fetchall()
        parts.append(pl.DataFrame(rows, schema={"sat": pl.Utf8, "date": pl.Date, "n": pl.Int64}, orient="row"))
    con.close()
    df = (pl.concat(parts, how="vertical_relaxed") if parts
          else pl.DataFrame(schema={"sat": pl.Utf8, "date": pl.Date, "n": pl.Int64}))
    df = (df.with_columns(pl.col("sat").replace_strict(satellite_map, default=None).alias("satellite"))
          .filter(pl.col("satellite").is_not_null())
          .group_by("date", "satellite").agg(pl.col("n").sum().cast(pl.Int64))
          .sort("date", "satellite"))
    cache_dir.mkdir(parents=True, exist_ok=True)
    df.write_parquet(out)
    return df


def detect_outages(cfg: PipelineCfg, activity: pl.DataFrame, counts: pl.DataFrame,
                   ref_counts: pl.DataFrame | None = None) -> tuple[pl.DataFrame, pl.DataFrame, pl.DataFrame]:
    """Quita de la máscara activa los satélites caídos (ver `availability` en pipeline.yaml).

    Con `ref_counts` (detecciones por satélite y día en la zona de referencia), una caída cuya
    evidencia es solo climatológica (ningún satélite detectó nada en la región) se descarta si el
    satélite tuvo >= reference.min_detections en la zona de referencia ese día.
    Devuelve (actividad corregida, tabla de caídas, tabla de caídas vetadas)."""
    av = cfg.availability
    sats = cfg.satellites
    wide = (activity.select("date", "active_mask")
            .join(counts.pivot(on="satellite", index="date", values="n"), on="date", how="left"))
    for s in sats:
        if s not in wide.columns:
            wide = wide.with_columns(pl.lit(0).alias(s))
    wide = wide.with_columns([pl.col(s).fill_null(0).cast(pl.Float64) for s in sats]).sort("date")
    use_ref = ref_counts is not None
    if use_ref:
        refw = (ref_counts.pivot(on="satellite", index="date", values="n")
                .rename({s: f"_ref_{s}" for s in sats if s in ref_counts["satellite"].unique().to_list()}))
        wide = wide.join(refw, on="date", how="left")
        for s in sats:
            if f"_ref_{s}" not in wide.columns:
                wide = wide.with_columns(pl.lit(0).alias(f"_ref_{s}"))
        wide = wide.with_columns([pl.col(f"_ref_{s}").fill_null(0).cast(pl.Int64) for s in sats]).sort("date")
        win_m = 2 * av.climatology_window_days + 1
        wide = wide.with_columns([pl.col(f"_ref_{s}").cast(pl.Float64)
                                  .rolling_median(win_m, center=True, min_samples=5).fill_null(0)
                                  .alias(f"_refmed_{s}") for s in sats])
    win_r, win_c = 2 * av.ratio_window_days + 1, 2 * av.climatology_window_days + 1
    outs, vetoes = [], []
    down_bits = pl.lit(0)
    for s, sc in sats.items():
        nominal = (pl.col("active_mask") & sc.bit) != 0
        others = pl.sum_horizontal([pl.when((pl.col("active_mask") & o.bit) != 0).then(pl.col(n)).otherwise(0)
                                    for n, o in sats.items() if n != s])
        both = nominal & (pl.col(s) > 0) & (others > 0)
        w = wide.with_columns(others.alias("_oth"), nominal.alias("_nom"))
        w = w.with_columns(
            pl.when(both).then(pl.col(s)).otherwise(0).rolling_sum(win_r, center=True, min_samples=1).alias("_num"),
            pl.when(both).then(pl.col("_oth")).otherwise(0).rolling_sum(win_r, center=True, min_samples=1).alias("_den"),
            pl.when(pl.col("_nom")).then(pl.col(s)).rolling_mean(win_c, center=True, min_samples=5).alias("_sm"),
            pl.col("date").dt.ordinal_day().clip(1, 365).alias("_doy"))
        clim = w.group_by("_doy").agg(pl.col("_sm").median().alias("_clim"))
        w = (w.join(clim, on="_doy", how="left")
             .with_columns(pl.when((pl.col("_oth") > 0) & (pl.col("_den") > 0))
                           .then(pl.col("_num") / pl.col("_den") * pl.col("_oth"))
                           .otherwise(pl.col("_clim")).alias("_exp"),
                           pl.when((pl.col("_oth") > 0) & (pl.col("_den") > 0)).then(pl.lit("ratio_to_others"))
                           .otherwise(pl.lit("climatology")).alias("_method"))
             .with_columns((pl.col("_nom") & (pl.col(s) == 0)).alias("_zero")))
        # rachas de días consecutivos en cero: la evidencia se acumula (Σ esperado de la racha)
        w = (w.with_columns((pl.col("_zero") != pl.col("_zero").shift()).fill_null(True).cum_sum().alias("_run"))
             .with_columns(pl.col("_exp").fill_null(0).sum().over("_run").alias("_run_exp"),
                           pl.len().over("_run").alias("_run_len"))
             .with_columns((pl.col("_zero") & ((pl.col("_exp") >= av.min_expected_detections)
                                               | (pl.col("_run_exp") >= av.min_expected_run)))
                           .fill_null(False).alias("_down")))
        if use_ref:
            veto = (pl.col("_down") & (pl.col("_method") == "climatology")
                    & (pl.col(f"_ref_{s}") >= av.reference.min_detections)
                    & (pl.col(f"_ref_{s}") >= av.reference.min_fraction * pl.col(f"_refmed_{s}")))
            w = w.with_columns(veto.alias("_veto"))
            vetoes.append(w.filter("_veto").select("date", pl.lit(s).alias("satellite"),
                                                   pl.col("_exp").round(1).alias("expected_detections"),
                                                   pl.col("_run_len").alias("zero_run_days"),
                                                   pl.col(f"_ref_{s}").alias("reference_detections"),
                                                   pl.col(f"_refmed_{s}").round(1).alias("reference_median")))
            w = w.with_columns((pl.col("_down") & ~pl.col("_veto")).alias("_down"))
        outs.append(w.filter("_down").select("date", pl.lit(s).alias("satellite"),
                                             pl.col("_exp").round(1).alias("expected_detections"),
                                             pl.col("_run_len").alias("zero_run_days"),
                                             pl.col("_run_exp").round(1).alias("zero_run_expected"),
                                             pl.col("_oth").cast(pl.Int64).alias("detections_other_satellites"),
                                             pl.col("_method").alias("method")))
        wide = wide.with_columns(w["_down"].alias(f"_down_{s}"))
        down_bits = down_bits + pl.when(pl.col(f"_down_{s}")).then(sc.bit).otherwise(0)
    veto_df = (pl.concat(vetoes).sort("date", "satellite") if vetoes else
               pl.DataFrame(schema={"date": pl.Date, "satellite": pl.Utf8, "expected_detections": pl.Float64,
                                    "zero_run_days": pl.UInt32, "reference_detections": pl.Int64,
                                    "reference_median": pl.Float64}))
    if not av.detect_outages:
        return activity, pl.concat(outs).sort("date", "satellite"), veto_df
    new_mask = wide.select("date", (pl.col("active_mask") - down_bits).alias("active_mask"))
    act = (activity.drop("active_mask", "epoch_id", "n_active").join(new_mask, on="date", how="left")
           .with_columns(
               pl.col("active_mask").map_elements(lambda m: epoch_name(cfg, m), return_dtype=pl.Utf8).alias("epoch_id"),
               pl.col("active_mask").map_elements(lambda m: bin(m).count("1"), return_dtype=pl.Int8).alias("n_active")))
    return act, pl.concat(outs).sort("date", "satellite"), veto_df


def epoch_name(cfg: PipelineCfg, mask: int) -> str:
    names = [n for n, s in cfg.satellites.items() if mask & s.bit]
    return "+".join(names) if names else "none"


def epochs_table(activity: pl.DataFrame) -> pl.DataFrame:
    """Bloques contiguos de días con la misma constelación."""
    return (activity.with_columns((pl.col("active_mask") != pl.col("active_mask").shift()).fill_null(True)
                                  .cum_sum().alias("_blk"))
            .group_by("_blk", maintain_order=True)
            .agg(pl.col("epoch_id").first(), pl.col("active_mask").first(),
                 pl.col("date").min().alias("start"), pl.col("date").max().alias("end"),
                 pl.len().alias("n_days"))
            .drop("_blk"))
