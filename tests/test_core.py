"""Tests con datos SINTÉTICOS (construidos a mano) de la lógica del pipeline."""
from datetime import date
from pathlib import Path

import numpy as np
import polars as pl
import pytest
from shapely.geometry import box

from firms_harmonize.calibrate import calibrate
from firms_harmonize.catalog import classify, coverage
from firms_harmonize.config import load_pipeline
from firms_harmonize.constellation import daily_activity
from firms_harmonize.dedup import build_events
from firms_harmonize.lineage import RejectLog
from firms_harmonize.regions import Region
from firms_harmonize.standardize import standardize


def test_classify():
    a = classify(Path("/x/Data_MODIS/2003/modis_2003_Argentina.csv"))
    assert (a.product, a.kind, a.level, a.scope, a.year) == ("MODIS", "country", "SP", "Argentina", 2003)
    b = classify(Path("/x/fire_nrt_J2V-C2_848553.csv"))
    assert (b.product, b.kind, b.level) == ("NOAA21", "global", "NRT")
    c = classify(Path("/d/raw/firms_api/ARG/VIIRS_NOAA21_NRT/2026-11-10_2026-11-14.csv"))
    assert (c.product, c.kind, c.level, c.scope) == ("NOAA21", "api", "NRT", "ARG")
    assert classify(Path("/x/otro.csv")) is None


def _rows(tmp_path):
    base = dict(brightness=320.0, brightness_2=290.0, scan=1.0, track=1.0, version="x", daynight="D",
                file_kind="country", level="SP", product="MODIS", file_priority=1)
    recs = [
        # duplicado exacto en dos archivos -> 1 se descarta
        dict(lat=-30.0, lon=-60.0, acq_date=date(2020, 1, 10), acq_time="1430", satellite_raw="Terra",
             instrument_raw="MODIS", confidence_raw="85", frp=10.0, type=0, source_file="f1"),
        dict(lat=-30.0, lon=-60.0, acq_date=date(2020, 1, 10), acq_time="1430", satellite_raw="Terra",
             instrument_raw="MODIS", confidence_raw="85", frp=10.0, type=0, source_file="f0", file_priority=0),
        # volcán -> descartado
        dict(lat=-31.0, lon=-61.0, acq_date=date(2020, 1, 10), acq_time="1500", satellite_raw="Aqua",
             instrument_raw="MODIS", confidence_raw="50", frp=5.0, type=2, source_file="f1"),
        # fuera del polígono
        dict(lat=-10.0, lon=-60.0, acq_date=date(2020, 1, 10), acq_time="1500", satellite_raw="Aqua",
             instrument_raw="MODIS", confidence_raw="50", frp=5.0, type=0, source_file="f1"),
        # VIIRS baja confianza, se conserva
        dict(lat=-30.001, lon=-60.001, acq_date=date(2020, 1, 10), acq_time="1700", satellite_raw="N",
             instrument_raw="VIIRS", confidence_raw="l", frp=1.0, type=0, source_file="f2", product="SNPP"),
        # NRT en fecha cubierta por SP -> reemplazado
        dict(lat=-30.0, lon=-60.0, acq_date=date(2020, 1, 11), acq_time="1430", satellite_raw="N",
             instrument_raw="VIIRS", confidence_raw="n", frp=3.0, type=None, source_file="f3",
             product="SNPP", level="NRT", file_kind="global", file_priority=3),
        # NRT en celda con 1 sola detección no-vegetación -> YA NO se enmascara (regla por celda)
        dict(lat=-31.0, lon=-61.0, acq_date=date(2021, 1, 5), acq_time="1500", satellite_raw="N",
             instrument_raw="VIIRS", confidence_raw="h", frp=3.0, type=None, source_file="f3",
             product="SNPP", level="NRT", file_kind="global", file_priority=3),
    ]
    df = pl.DataFrame([{**base, **r} for r in recs]).with_columns(pl.col("type").cast(pl.Int8))
    p = tmp_path / "rows.parquet"
    df.write_parquet(p)
    return p


def test_standardize(tmp_path):
    cfg = load_pipeline()
    region = Region("TST", box(-70, -40, -50, -20), (-70, -40, -50, -20), [])
    cov = {("MODIS", "SP"): [(date(2000, 11, 1), date(2020, 12, 31))],
           ("SNPP", "SP"): [(date(2012, 1, 20), date(2020, 12, 31))],
           ("SNPP", "NRT"): [(date(2021, 1, 1), date(2021, 1, 31))]}
    act = daily_activity(cfg, cov, date(2021, 1, 31))
    rej = RejectLog()
    det, masked = standardize(cfg, region, [_rows(tmp_path)], cov, act, rej)
    reasons = sorted(pl.concat(rej.frames)["reason"].to_list())
    assert reasons == ["duplicate_record", "outside_region_polygon",
                       "superseded_by_science_product", "type_2_non_vegetation"]
    assert det.height == 3
    assert det.filter(pl.col("satellite") == "Terra")["source_file"].item() == "f0"  # prioridad
    assert det.filter((pl.col("satellite") == "SNPP") & (pl.col("acq_date") == date(2020, 1, 10)))["confidence_level"].item() == "low"
    assert det.filter(pl.col("satellite") == "Terra")["confidence_level"].item() == "high"
    # 14:30 UTC en lon -60 -> 10:30 solar del mismo día
    assert det.filter(pl.col("acq_date") == date(2020, 1, 10))["solar_date"].to_list() == [date(2020, 1, 10)] * 2
    ev = build_events(cfg, det).filter(pl.col("solar_date") == date(2020, 1, 10))
    assert ev.height == 1  # mismo hexágono res 7, mismo día -> 1 evento
    e = ev.row(0, named=True)
    assert e["n_raw_detections"] == 2 and e["satellites"] == "Terra+SNPP"
    assert e["sat_mask_series"] == 1  # el VIIRS 'low' no entra en la serie
    assert masked.height == 0  # 1 sola detección no-vegetación no alcanza para marcar la celda


def test_calibration_recovers_known_factor():
    """Época 1: solo Terra. Época 2: Terra+Aqua, donde Aqua aporta exactamente el doble de eventos
    que Terra sola -> r = 3 y K(Terra) = 3."""
    cfg = load_pipeline()
    cfg.calibration.min_window_days = 1
    cfg.calibration.bootstrap.n = 50
    cov = {("MODIS", "SP"): [(date(2002, 1, 1), date(2003, 12, 31))]}
    cfg.period.start = date(2002, 1, 1)
    act = daily_activity(cfg, cov, date(2003, 12, 31))
    rows = []
    for d in act["date"].to_list():
        m = act.filter(pl.col("date") == d)["active_mask"].item()
        rows += [{"solar_date": d, "sat_mask_series": 1, "in_series": True}] * 2       # Terra
        if m == 3:
            rows += [{"solar_date": d, "sat_mask_series": 2, "in_series": True}] * 4   # solo Aqua
    ev = pl.DataFrame(rows).with_columns(pl.col("sat_mask_series").cast(pl.Int32))
    factors, fdaily, ts, monthly, report, kt = calibrate(cfg, ev, act)
    k = {(r["active_mask"], r["doy"]): r["k_factor"] for r in kt.to_dicts()}
    assert all(np.isclose(k[(1, d)], 3.0) and np.isclose(k[(3, d)], 1.0) for d in range(1, 367))
    terra_days = ts.filter(pl.col("active_mask") == 1)
    assert np.allclose(terra_days["events_harmonized"].to_numpy(), 6.0)
    assert np.isclose(monthly["events_harmonized"].sum(), ts["events_harmonized"].sum())


def test_monthly_fit_smoothing():
    from firms_harmonize.calibrate import fit_monthly_ratio
    m = np.arange(12)
    true = np.exp(0.9 + 0.35 * np.cos(2 * np.pi * (m - 6) / 12))           # estacionalidad suave
    x = np.array([5000, 4000, 3000, 800, 60, 40, 50, 900, 6000, 9000, 8000, 7000], float)
    y = x * true
    y[5] *= 1.8                                                             # ruido en un mes con pocas muestras
    raw = fit_monthly_ratio(x, y, "month_of_year", "none")
    for method in ("harmonic", "moving_average"):
        sm = fit_monthly_ratio(x, y, "month_of_year", method)
        assert np.isclose((sm * x).sum(), y.sum())                          # conserva el total
        assert abs(np.log(sm[5] / true[5])) < abs(np.log(raw[5] / true[5]))  # atenúa el mes ruidoso
    g = fit_monthly_ratio(x, y, "global", "none")
    assert np.allclose(g, y.sum() / x.sum())


def test_monthly_shrinkage_tames_sparse_months():
    """Un mes con muy pocos eventos no debe dar un factor extremo; los meses con muchos casi no cambian."""
    from firms_harmonize.calibrate import fit_monthly_ratio
    x = np.array([2000, 1800, 1500, 900, 300, 12, 12, 400, 1500, 2000, 2100, 2100], float)
    y = x * 4.0
    y[6] = 12 * 36                                  # julio: 12 eventos, cociente crudo ×36 (ruido)
    raw = fit_monthly_ratio(x, y, "month_of_year", "harmonic")
    shr = fit_monthly_ratio(x, y, "month_of_year", "harmonic", prior_events=100)
    assert shr.max() < raw.max()
    assert shr[6] < 8                                # sin contracción el armónico lo dejaba muy alto
    assert abs(shr[0] - 4.0) / 4.0 < 0.15            # enero (2.000 eventos) sigue cerca de su valor
    # se conserva el total de la ventana
    assert (shr * x).sum() == pytest.approx(y.sum(), rel=1e-9)


def test_select_by_cv_prefers_global_when_season_overfits():
    import numpy as np
    from firms_harmonize.calibrate import _ratio_stats
    from firms_harmonize.config import CalibrationCfg
    rng = np.random.default_rng(0)
    months = pl.date_range(date(2010, 1, 1), date(2013, 12, 1), "1mo", eager=True)
    x = rng.poisson(200, len(months)).astype(float)
    y = rng.poisson(x * 3.0).astype(float)          # sin estacionalidad real: cociente constante ×3
    days = [{"solar_date": m, "month": m, "moy": m.month, "c_1": int(a), "c_3": int(b)}
            for m, a, b in zip(months, x, y)]
    df = pl.DataFrame(days)
    cc = CalibrationCfg()
    cc.bootstrap.n = 20
    cc.smoothing.method, cc.smoothing.select_by_cv = "none", True   # 12 cocientes crudos = sobreajuste
    st = _ratio_stats(df, 1, 3, np.random.default_rng(1), cc)
    assert st["selected_method"] == "global"
    assert np.allclose(st["r12"], st["r_total"])


def test_static_source_rule():
    from firms_harmonize.standardize import static_source_cells
    cfg = load_pipeline()
    days = pl.date_range(date(2021, 1, 1), date(2021, 4, 30), "1d", eager=True)
    flare = pl.DataFrame({"h3_cell": [1] * len(days), "solar_date": days, "daynight": ["N"] * len(days),
                          "frp": [1.2] * len(days)})
    # incendio real largo: muchos días pero diurno y FRP alto
    fire = pl.DataFrame({"h3_cell": [2] * len(days), "solar_date": days,
                         "daynight": ["D", "D", "N"] * (len(days) // 3) + ["D"] * (len(days) % 3),
                         "frp": [8.0] * len(days)})
    # falsa alarma MODIS: diurna, años 2008-2016, solo MODIS aunque VIIRS existe desde 2012
    md = [date(y, 3, d) for y in range(2008, 2017) for d in (1, 2)]
    modis_fa = pl.DataFrame({"h3_cell": [3] * len(md), "solar_date": md, "daynight": ["D"] * len(md),
                             "frp": [9.0] * len(md)})
    veg = (pl.concat([flare.with_columns(pl.lit("VIIRS").alias("instrument")),
                      fire.with_columns(pl.lit("VIIRS").alias("instrument")),
                      modis_fa.with_columns(pl.lit("MODIS").alias("instrument"))])
           .with_columns(pl.col("h3_cell").cast(pl.UInt64)))
    nonveg = pl.DataFrame({"h3_cell": pl.Series([2], dtype=pl.UInt64)})
    out = static_source_cells(cfg, veg, nonveg)
    assert out["h3_cell"].to_list() == [1, 3]
    assert out.filter(pl.col("h3_cell") == 1)["rule_flare"].item()
    assert out.filter(pl.col("h3_cell") == 3)["rule_modis_only"].item()


def test_daily_k_is_continuous():
    from firms_harmonize.calibrate import daily_from_monthly, step_from_monthly
    k12 = np.array([6.8, 7.9, 11.2, 17.6, 24.2, 24.6, 18.8, 13.0, 9.7, 8.2, 7.5, 7.0])
    d, st = daily_from_monthly(k12), step_from_monthly(k12)
    jump_d = np.max(np.abs(np.diff(np.log(np.r_[d, d[0]]))))
    jump_s = np.max(np.abs(np.diff(np.log(np.r_[st, st[0]]))))
    assert jump_d < 0.05 < jump_s


def test_outage_detection():
    from firms_harmonize.constellation import detect_outages
    cfg = load_pipeline()
    cfg.period.start = date(2019, 1, 1)
    cov = {(p, "SP"): [(date(2019, 1, 1), date(2019, 12, 31))] for p in ("MODIS", "SNPP", "NOAA20")}
    act = daily_activity(cfg, cov, date(2019, 12, 31))
    rows = []
    for d in act["date"].to_list():
        for s, n in (("Terra", 50), ("Aqua", 100), ("SNPP", 300), ("NOAA20", 320)):
            if s == "SNPP" and date(2019, 7, 10) <= d <= date(2019, 7, 14):
                continue                                   # caída de 5 días
            if s == "Terra" and d == date(2019, 3, 3):
                n = 0
            rows.append({"date": d, "satellite": s, "n": n})
    counts = pl.DataFrame(rows).filter(pl.col("n") > 0)
    new, outs, vetoes = detect_outages(cfg, act, counts)
    snpp = outs.filter(pl.col("satellite") == "SNPP")["date"].to_list()
    assert snpp == [date(2019, 7, d) for d in range(10, 15)]
    assert outs.filter(pl.col("satellite") == "Terra")["date"].to_list() == [date(2019, 3, 3)]
    assert new.filter(pl.col("date") == date(2019, 7, 12))["epoch_id"].item() == "Terra+Aqua+NOAA20"
    assert vetoes.height == 0


def _quiet_day_setup():
    """Región con fuego todos los días salvo una semana en que NINGÚN satélite detecta nada."""
    cfg = load_pipeline()
    cfg.period.start = date(2019, 1, 1)
    cov = {(p, "SP"): [(date(2019, 1, 1), date(2019, 12, 31))] for p in ("MODIS", "SNPP", "NOAA20")}
    act = daily_activity(cfg, cov, date(2019, 12, 31))
    quiet = [date(2019, 2, d) for d in range(10, 17)]
    rows = [{"date": d, "satellite": s, "n": n}
            for d in act["date"].to_list() if d not in quiet
            for s, n in (("Terra", 50), ("Aqua", 100), ("SNPP", 300), ("NOAA20", 320))]
    return cfg, act, pl.DataFrame(rows), quiet


def test_outage_regional_veto():
    """Semana húmeda sin fuego: sin veto todo queda 'sin dato'; con actividad regional de los
    satélites, la caída climatológica se veta y los días quedan como observados en cero."""
    from firms_harmonize.constellation import detect_outages
    cfg, act, counts, quiet = _quiet_day_setup()

    new, outs, vetoes = detect_outages(cfg, act, counts)          # comportamiento anterior
    assert new.filter(pl.col("date").is_in(quiet))["active_mask"].to_list() == [0] * len(quiet)

    ref = pl.DataFrame([{"date": d, "satellite": s, "n": 500} for d in act["date"].to_list()
                        for s in ("Terra", "Aqua", "SNPP", "NOAA20")])
    new, outs, vetoes = detect_outages(cfg, act, counts, ref)
    assert outs.filter(pl.col("date").is_in(quiet)).height == 0
    assert vetoes.filter(pl.col("date").is_in(quiet)).height == 4 * len(quiet)
    assert set(new.filter(pl.col("date").is_in(quiet))["epoch_id"].to_list()) == {"Terra+Aqua+SNPP+NOAA20"}


def test_outage_veto_keeps_real_outages():
    """Una caída real (el satélite no aporta nada tampoco en la zona de referencia) se mantiene,
    y una caída por cociente con otros satélites (evidencia local) nunca se veta."""
    from firms_harmonize.constellation import detect_outages
    cfg, act, counts, quiet = _quiet_day_setup()
    gap = [date(2019, 7, d) for d in range(10, 15)]
    counts = counts.filter(~((pl.col("satellite") == "SNPP") & pl.col("date").is_in(gap)))
    ref = pl.DataFrame([{"date": d, "satellite": s,
                         "n": 20 if (s == "Aqua" and d in quiet) else 500}   # Aqua: caída parcial (4% de lo habitual)
                        for d in act["date"].to_list()
                        for s in ("Terra", "Aqua", "SNPP", "NOAA20")
                        if not (s == "Terra" and d in quiet)])            # Terra caído de verdad
    new, outs, vetoes = detect_outages(cfg, act, counts, ref)
    assert outs.filter((pl.col("satellite") == "Terra") & pl.col("date").is_in(quiet)).height == len(quiet)
    assert outs.filter((pl.col("satellite") == "Aqua") & pl.col("date").is_in(quiet)).height == len(quiet)
    assert outs.filter((pl.col("satellite") == "SNPP") & pl.col("date").is_in(gap)).height == len(gap)
    assert vetoes.filter((pl.col("satellite") == "SNPP") & pl.col("date").is_in(gap)).height == 0
