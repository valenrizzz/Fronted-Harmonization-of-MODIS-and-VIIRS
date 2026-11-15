"""Etapa 4b — Exporta el almacén autocontenido para la web: Datos_Para_La_Web/<REGIÓN>/.

Lee los productos de data/processed y data/lineage y escribe:
  events/layer=SP|NRT/year=AAAA/*.parquet  eventos celda H3 × día (ordenados por H3 grueso + fecha)
  timeseries_daily.parquet, timeseries_monthly.parquet (+ .json)
  calibration_factors.parquet (+ .json), h3_region_map.parquet
  metadata/  (informe de calibración, descartes, fuentes, cobertura, configuración)
  manifest.json  (versión, corte SP/NRT, conteos, esquema y sha256 de cada archivo)

Corte SP/NRT: último día en que TODOS los productos que aún reciben datos tienen producto
científico (SP). Los productos sin datos recientes (satélite fuera de servicio) no frenan el corte.
Publicación atómica: se construye en una carpeta temporal y se reemplaza de una sola vez.
"""
from __future__ import annotations

import hashlib
import json
import shutil
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import duckdb
import numpy as np
import polars as pl
from h3.api import basic_int as h3i

from .config import PROJECT_ROOT, PipelineCfg
from .lineage import sha256_file, write_json

QUALITY_RANK = {"low": 0, "medium": 1, "high": 2}


def sp_nrt_cut(coverage: dict) -> dict:
    prods: dict[str, dict] = {}
    for key, ivs in coverage.items():
        prod, level = key.split("|")
        p = prods.setdefault(prod, {"sp_end": None, "data_end": None})
        end = max(date.fromisoformat(b) for _, b in ivs)
        if level == "SP":
            p["sp_end"] = max(filter(None, [p["sp_end"], end]))
        p["data_end"] = max(filter(None, [p["data_end"], end]))
    data_end = max(p["data_end"] for p in prods.values())
    pending = {k: p for k, p in prods.items() if p["sp_end"] and p["data_end"] > p["sp_end"]}
    cutoff = min(p["sp_end"] for p in pending.values()) if pending else data_end
    return {"sp_cutoff": cutoff, "nrt_start": cutoff + timedelta(days=1) if cutoff < data_end else None,
            "data_end": data_end, "pending_products": sorted(pending),
            "products": {k: {"sp_end": str(p["sp_end"]), "data_end": str(p["data_end"])} for k, p in sorted(prods.items())}}


def calibration_version(region: str, factors: pl.DataFrame, cfg: PipelineCfg) -> str:
    h = hashlib.sha256()
    for r in factors.sort("active_mask", "month_of_year").select(
            "active_mask", "month_of_year", "k_factor", "k_ci_low", "k_ci_high").iter_rows():
        h.update(("|".join(f"{v:.10g}" if isinstance(v, float) else str(v) for v in r) + "\n").encode())
    h.update(json.dumps(cfg.calibration.model_dump(mode="json"), sort_keys=True).encode())
    h.update(json.dumps(cfg.confidence.model_dump(mode="json"), sort_keys=True).encode())
    return f"{region}-cal-{h.hexdigest()[:12]}"


def quality_expr(q: dict) -> pl.Expr:
    rel = (pl.col("k_ci_high") - pl.col("k_ci_low")) / (2 * pl.col("k_factor"))
    hi, me = q["high"], q["medium"]
    return (pl.when((pl.col("k_factor") <= hi["max_k"]) & (rel <= hi["max_rel_ci"])).then(pl.lit("high"))
            .when((pl.col("k_factor") <= me["max_k"]) & (rel <= me["max_rel_ci"])).then(pl.lit("medium"))
            .otherwise(pl.lit("low")))


def _schema(df_or_path) -> dict:
    s = pl.read_parquet_schema(df_or_path) if isinstance(df_or_path, Path) else df_or_path.schema
    return {k: str(v) for k, v in s.items()}


def export_web(cfg: PipelineCfg, region: str) -> dict:
    wcfg = cfg.export["web"]
    d = cfg.data_dir
    proc, lin = d / "processed" / region, d / "lineage" / region
    web_root = PROJECT_ROOT / wcfg["dir"]
    stage, final, old = web_root / f".staging_{region}", web_root / region, web_root / f".old_{region}"
    if stage.exists():
        shutil.rmtree(stage)
    (stage / "metadata").mkdir(parents=True)

    coverage = json.loads((lin / "coverage.json").read_text())
    cut = sp_nrt_cut(coverage)
    cutoff = cut["sp_cutoff"]
    factors = pl.read_parquet(proc / "calibration_factors.parquet")
    version = calibration_version(region, factors, cfg)
    # confiabilidad por (constelación, mes) a partir de K y su IC en el centro del mes
    factors = factors.with_columns(
        ((pl.col("k_ci_high") - pl.col("k_ci_low")) / (2 * pl.col("k_factor"))).alias("k_rel_ci_halfwidth"),
        quality_expr(wcfg["quality"]).alias("reliability_tier"),
        pl.lit(version).alias("calibration_version"))
    tier = factors.select("epoch_id", pl.col("month_of_year").cast(pl.Int8), "reliability_tier")
    # factor DIARIO (el que realmente se aplicó): IC del peso por (constelación, día del año)
    fday = (pl.read_parquet(proc / "calibration_factors_daily.parquet")
            .with_columns(pl.lit(version).alias("calibration_version")))
    fdj = fday.select("epoch_id", "doy", "k_ci_low", "k_ci_high")
    # ---------------------------------------------------------------- eventos
    ev = pl.read_parquet(proc / "events_daily.parquet")
    # Corte en DÍA SOLAR: el corte de cobertura es en fecha UTC, pero un día solar puede incluir
    # horas UTC del día siguiente (longitudes oeste). El último día solar 100% SP es el anterior
    # al primer día solar que contiene alguna detección provisoria.
    first_prov = ev.filter(pl.col("n_provisional_detections") > 0)["solar_date"].min()
    solar_cut = min(cutoff, first_prov - timedelta(days=1)) if first_prov else cutoff
    cut["sp_cutoff_solar_day"] = solar_cut
    cutoff = solar_cut
    layer_of = pl.when(pl.col("_d") <= cutoff).then(pl.lit("SP")).otherwise(pl.lit("NRT"))
    cells = ev["h3_cell"].unique().to_numpy()
    rc, rm = int(wcfg["h3_coarse_res"]), int(wcfg["h3_map_res"])
    parents = pl.DataFrame({"h3_cell": cells,
                            f"h3_r{rc}": np.array([h3i.cell_to_parent(int(c), rc) for c in cells], dtype=np.uint64),
                            f"h3_r{rm}": np.array([h3i.cell_to_parent(int(c), rm) for c in cells], dtype=np.uint64)})
    ev = (ev.join(parents, on="h3_cell", how="left")
          .with_columns(pl.col("solar_date").dt.month().cast(pl.Int8).alias("month_of_year"),
                        pl.col("solar_date").dt.ordinal_day().cast(pl.Int16).alias("doy"),
                        pl.col("solar_date").dt.year().alias("year"), pl.col("solar_date").alias("_d"))
          .join(tier, on=["epoch_id", "month_of_year"], how="left")
          .join(fdj, on=["epoch_id", "doy"], how="left")
          .with_columns(layer_of.alias("layer"),
                        pl.when(pl.col("in_series")).then(pl.col("k_ci_low")).otherwise(0.0).alias("weight_ci_low"),
                        pl.when(pl.col("in_series")).then(pl.col("k_ci_high")).otherwise(0.0).alias("weight_ci_high"),
                        pl.lit(version).alias("calibration_version"))
          .drop("_d", "k_ci_low", "k_ci_high"))
    assert ev["reliability_tier"].null_count() == 0, "eventos sin factor de calibración"
    cols = ["region", "layer", "year", "solar_date", "month_of_year", "doy",
            "h3_index", "h3_cell", f"h3_r{rc}", f"h3_r{rm}", "cell_lat", "cell_lon",
            "epoch_id", "in_series", "harmonized_weight", "weight_ci_low", "weight_ci_high",
            "reliability_tier", "calibration_version",
            "n_raw_detections", "n_satellites", "satellites", "n_modis_detections", "n_viirs_detections",
            "sat_mask", "sat_mask_series", "frp_max", "frp_mean", "frp_quality", "max_confidence",
            "max_confidence_rank", "first_detection_utc", "last_detection_utc", "is_provisional",
            "n_provisional_detections"]
    ev = ev.select(cols)
    con = duckdb.connect()
    con.register("ev", ev.to_arrow())
    con.execute(f"""COPY (SELECT * FROM ev ORDER BY layer, year, h3_r{rc}, solar_date, h3_cell)
                    TO '{stage / "events"}' (FORMAT parquet, PARTITION_BY (layer, year), COMPRESSION zstd,
                    ROW_GROUP_SIZE {int(wcfg["row_group_size"])}, FILENAME_PATTERN 'part_{{i}}')""")

    # ---------------------------------------------------------------- series
    ts = (pl.read_parquet(proc / "timeseries_daily.parquet")
          .with_columns(pl.col("date").dt.month().cast(pl.Int8).alias("month_of_year"), pl.col("date").alias("_d"))
          .join(tier, on=["epoch_id", "month_of_year"], how="left")
          .join(fdj, on=["epoch_id", "doy"], how="left")
          .with_columns(layer_of.alias("layer"), pl.lit(version).alias("calibration_version"))
          .rename({"k_ci_low": "k_factor_ci_low", "k_ci_high": "k_factor_ci_high"})
          .drop("_d", "month_of_year")
          .select("region", "date", "month", "doy", "layer", "epoch_id", "n_active", "active_mask",
                  "observation_flag", "events_observed", "events_all_confidence",
                  "k_factor", "k_factor_ci_low", "k_factor_ci_high",
                  "events_harmonized", "events_harmonized_ci_low", "events_harmonized_ci_high",
                  "reliability_tier", "calibration_version"))
    mq = (ts.group_by("month").agg(
            pl.col("layer").unique().sort().str.join("+").alias("_layers"),
            pl.col("reliability_tier").replace_strict(QUALITY_RANK, default=None).min().alias("_q")))
    mo = (pl.read_parquet(proc / "timeseries_monthly.parquet").join(mq, on="month", how="left")
          .with_columns(pl.when(pl.col("_layers") == "SP").then(pl.lit("SP"))
                          .when(pl.col("_layers") == "NRT").then(pl.lit("NRT")).otherwise(pl.lit("MIXED")).alias("layer"),
                        pl.col("_q").replace_strict({v: k for k, v in QUALITY_RANK.items()}, default=None)
                          .alias("reliability_tier"),
                        pl.lit(version).alias("calibration_version"))
          .select("region", "month", "layer", "epochs", "days_observed", "days_in_month", "days_suspect_zero",
                  "events_observed", "events_all_confidence", "events_harmonized",
                  "events_harmonized_ci_low", "events_harmonized_ci_high", "coverage_frac",
                  "events_harmonized_gapfilled", "events_harmonized_gapfilled_ci_low",
                  "events_harmonized_gapfilled_ci_high", "reliability_tier", "calibration_version"))
    ts.write_parquet(stage / "timeseries_daily.parquet", compression="zstd")
    mo.write_parquet(stage / "timeseries_monthly.parquet", compression="zstd")
    mo.with_columns(pl.col("month").cast(pl.Utf8)).write_json(stage / "timeseries_monthly.json")
    factors.write_parquet(stage / "calibration_factors.parquet", compression="zstd")
    factors.write_json(stage / "calibration_factors.json")
    fday.write_parquet(stage / "calibration_factors_daily.parquet", compression="zstd")
    (ev.select("h3_cell", "h3_index", "cell_lat", "cell_lon", f"h3_r{rc}", f"h3_r{rm}", "region")
       .unique("h3_cell").sort("h3_cell").write_parquet(stage / "h3_region_map.parquet", compression="zstd"))

    # ---------------------------------------------------------------- metadatos
    for f in ("calibration_report.json", "calibration_report.md", "rejection_summary.csv",
              "source_manifest.json", "coverage.json", "satellite_outages.csv", "static_source_cells.parquet"):
        shutil.copy2(lin / f, stage / "metadata" / f)
    run_meta = json.loads((lin / "run_metadata.json").read_text())
    write_json(stage / "metadata" / "run_config.json", run_meta)

    layer_counts = {r["layer"]: {"events": r["n"], "first": str(r["a"]), "last": str(r["b"])}
                    for r in ev.group_by("layer").agg(pl.len().alias("n"), pl.col("solar_date").min().alias("a"),
                                                      pl.col("solar_date").max().alias("b")).to_dicts()}
    files = []
    for p in sorted(stage.rglob("*")):
        if p.is_file():
            rel = p.relative_to(stage).as_posix()
            entry = {"path": rel, "bytes": p.stat().st_size, "sha256": sha256_file(p)}
            if p.suffix == ".parquet":
                entry["rows"] = pl.scan_parquet(p).select(pl.len()).collect().item()
            files.append(entry)
    manifest = {
        "dataset": "firms_harmonized_fire_events", "region": region,
        "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "calibration_version": version,
        "calibration": {"reference_constellation":
                        json.loads((lin / "calibration_report.json").read_text())["reference_constellation"],
                        "factor_scope": cfg.calibration.factor_scope,
                        "smoothing": cfg.calibration.smoothing.model_dump(),
                        "series_min_confidence": cfg.confidence.series_min_level,
                        "quality_rules": wcfg["quality"]},
        "sp_nrt_cut": {k: (str(v) if isinstance(v, date) else v) for k, v in cut.items()},
        "layers": layer_counts,
        "period": run_meta["summary"]["period"],
        "h3": {"event_res": cfg.grid.h3_resolution, "coarse_res": rc, "map_res": rm},
        "schemas": {"events": _schema(ev), "timeseries_daily": _schema(ts), "timeseries_monthly": _schema(mo),
                    "calibration_factors": _schema(factors), "calibration_factors_daily": _schema(fday)},
        "files": files,
    }
    write_json(stage / "manifest.json", manifest)

    # ---------------------------------------------------------------- publicación atómica
    if old.exists():
        shutil.rmtree(old)
    if final.exists():
        final.rename(old)
    stage.rename(final)
    if old.exists():
        shutil.rmtree(old)
    return manifest
