"""Orquestador: ingesta -> (API para huecos) -> estandarización -> deduplicación -> calibración."""
from __future__ import annotations

import logging
import time
from pathlib import Path

import polars as pl

from . import calibrate as cal
from .catalog import coverage, discover
from .config import load_pipeline, load_region
from .constellation import daily_activity, daily_satellite_counts, detect_outages
from .dedup import build_events
from .firms_api import fill_gaps
from .ingest import run_ingest
from .lineage import HashCache, RejectLog, run_metadata, write_json
from .regions import resolve_region
from .report import write_markdown_report
from .standardize import SATELLITE_MAP, standardize

log = logging.getLogger(__name__)


def _save(df: pl.DataFrame, path: Path, csv: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    df.write_parquet(path, compression="zstd")
    if csv:
        df.write_csv(path.with_suffix(".csv"))


def run(region_code: str, use_api: bool = True, hash_sources: bool = True, threads: int = 8) -> dict:
    t0 = time.time()
    cfg = load_pipeline()
    reg_cfg, bnd = load_region(region_code)
    region = resolve_region(cfg, reg_cfg, bnd)
    R = region.code
    d = cfg.data_dir
    rows_dir, interim = d / "interim" / R / "rows", d / "interim" / R
    processed, lineage = d / "processed" / R, d / "lineage" / R
    api_dir = d / "raw" / "firms_api"
    csv = bool(cfg.export.get("csv", True))
    log.info("Región %s | bbox %s | archivos por país: %s", R, region.bbox_str, region.firms_country_files)

    # 1. ingesta local
    files, unknown = discover(cfg.paths.local_sources, api_dir, R, region.firms_country_files)
    metas = run_ingest(files, region.bbox, rows_dir, threads)
    cov = coverage(files)

    # 1b. API solo para huecos
    api_report = {"skipped": "deshabilitada por CLI"}
    if use_api:
        api_report = fill_gaps(cfg, R, region.bbox_str, cov, api_dir)
        if api_report.get("downloaded"):
            files, unknown = discover(cfg.paths.local_sources, api_dir, R, region.firms_country_files)
            metas = run_ingest(files, region.bbox, rows_dir, threads)
            cov = coverage(files)

    end = min(cfg.period.resolved_end, max(e for ivs in cov.values() for _, e in ivs))
    activity = daily_activity(cfg, cov, end)
    write_json(lineage / "coverage.json",
               {f"{p}|{lvl}": [[str(a), str(b)] for a, b in ivs] for (p, lvl), ivs in sorted(cov.items())})
    row_files = [rows_dir / f"{m['source_file']}.parquet" for m in metas]

    # 1c. caídas de satélites (actividad diaria basada en datos, no solo en cobertura de archivos)
    sat_counts = daily_satellite_counts(cfg, row_files, SATELLITE_MAP)
    activity, outages = detect_outages(cfg, activity, sat_counts)
    lineage.mkdir(parents=True, exist_ok=True)
    outages.write_csv(lineage / "satellite_outages.csv")
    log.info("Caídas detectadas: %d satélite-día; días sin ningún satélite: %d",
             outages.height, activity.filter(pl.col("active_mask") == 0).height)

    # 2. estandarización
    rej = RejectLog()
    for m in metas:
        rej.add_count(m["source_file"], "outside_region_bbox", m["n_rows"] - m["n_in_bbox"])
    det, static_cells = standardize(cfg, region, row_files, cov, activity, rej)
    _save(det, interim / "detections.parquet", csv=False)
    static_cells.write_parquet(lineage / "static_source_cells.parquet")
    old_mask = lineage / "static_source_mask_cells.parquet"
    if old_mask.exists():
        old_mask.unlink()
    rej_summary = rej.write(lineage)

    # 3. deduplicación
    events = build_events(cfg, det)

    # 4. calibración
    factors, factors_daily, ts, monthly, report, ktable = cal.calibrate(cfg, events, activity)
    # peso del evento = K(constelación del día, mes del año), suavizado; 0 si no entra en la serie
    events = (events
              .join(activity.select(pl.col("date").alias("solar_date"), "active_mask"), on="solar_date", how="left")
              .with_columns(pl.col("solar_date").dt.ordinal_day().cast(pl.Int16).alias("doy"))
              .join(ktable, on=["active_mask", "doy"], how="left")
              .with_columns(pl.when(pl.col("in_series")).then(pl.col("k_factor")).otherwise(0.0)
                            .alias("harmonized_weight"))
              .drop("active_mask", "doy", "k_factor"))
    events = events.with_columns(pl.lit(R).alias("region"))
    ts = ts.with_columns(pl.lit(R).alias("region"))
    monthly = monthly.with_columns(pl.lit(R).alias("region"))

    _save(events, processed / "events_daily.parquet", csv)
    _save(ts, processed / "timeseries_daily.parquet", csv)
    _save(monthly, processed / "timeseries_monthly.parquet", csv)
    _save(factors, processed / "calibration_factors.parquet", csv)
    _save(factors_daily, processed / "calibration_factors_daily.parquet", csv)

    # linaje
    hc = HashCache(d / "lineage" / "sha256_cache.json")
    manifest = []
    for sf, m in zip(files, metas):
        manifest.append({"source_file": sf.source_id, "path": str(sf.path), "product": sf.product,
                         "kind": sf.kind, "level": sf.level, "coverage": [str(sf.cov_start), str(sf.cov_end)],
                         "n_rows": m["n_rows"], "n_in_bbox": m["n_in_bbox"],
                         "sha256": hc.get(sf.path) if hash_sources else None})
    hc.save()
    summary = {
        "region": R, "region_provenance": region.provenance, "bbox": region.bbox,
        "period": [str(cfg.period.start), str(end)],
        "n_source_files": len(files), "unrecognized_csv": [str(p) for p in unknown],
        "n_detections_kept": det.height, "n_events": events.height,
        "n_events_in_series": int(events["in_series"].sum()),
        "n_static_source_cells": static_cells.height,
        "n_satellite_outage_days": outages.height,
        "n_days_without_any_satellite": activity.filter(pl.col("active_mask") == 0).height,
        "rejections": {r["reason"]: r["n_records"] for r in
                       rej_summary.group_by("reason").agg(pl.col("n_records").sum()).to_dicts()},
        "api": api_report, "elapsed_s": round(time.time() - t0, 1),
    }
    write_json(lineage / "source_manifest.json", manifest)
    write_json(lineage / "calibration_report.json", report)
    write_json(lineage / "run_metadata.json",
               run_metadata(config=cfg.model_dump(mode="json"), summary=summary))
    write_markdown_report(lineage / "calibration_report.md", summary, report)
    return summary
