"""Etapa 4 — Corrección del sesgo de constelación (overlap calibration por sub-constelaciones).

Idea: en cualquier día donde la constelación Y está activa podemos SIMULAR la constelación
X ⊂ Y quitando satélites (con las máscaras de bits de cada evento). Sobre los mismos fuegos
y los mismos días, el cociente  r(X→Y) = Σ eventos_Y / Σ eventos_X  mide cuánto más ve Y por
revisita + resolución. Encadenando cocientes entre constelaciones consecutivas se obtiene
K_X, que lleva los conteos de cada época a unidades de la constelación de referencia.

Alcance del factor (calibration.factor_scope):
  * global         — un cociente por par de constelaciones.
  * month_of_year  — 12 cocientes por par (la ganancia de revisita depende de la estación:
                     duración del día, nubosidad, tamaño típico del fuego). Los 12 valores se
                     suavizan de forma CIRCULAR (dic↔ene) en escala log, ponderando cada mes
                     por sus eventos (≈ inverso de la varianza del log-cociente):
                       - harmonic:        log r(m) = a0 + Σ_k a_k cos(2πkm/12) + b_k sin(2πkm/12)
                       - moving_average:  media móvil circular ponderada de `window` meses
                     y se re-escalan para conservar el total de la ventana (Σ r(m)·x_m = Σ y_m).

  serie_armonizada(d) = eventos_observados(d) × K_{constelación(d)}[mes(d)]

Incertidumbre: bootstrap estratificado por mes del año (se remuestrean meses calendario
completos dentro de cada mes del año, preservando la autocorrelación intra-mensual). El ajuste
y el suavizado se repiten en cada réplica; los factores encadenados multiplican las mismas
réplicas. Los IC reflejan solo la incertidumbre de calibración.
"""
from __future__ import annotations

from collections import deque
from datetime import date, timedelta

import numpy as np
import polars as pl

from .config import CalibrationCfg, PipelineCfg
from .constellation import epoch_name, epochs_table

CV_METHODS = [("global", "none"), ("month_of_year", "none"),
              ("month_of_year", "moving_average"), ("month_of_year", "harmonic")]


def _doy_to_month_pos() -> np.ndarray:
    """Posición fraccional (0 = centro de enero … 11 = centro de diciembre) de cada día del año."""
    return (np.arange(1, 367) - 0.5) * 12 / 365.25 - 0.5


def daily_from_monthly(k12: np.ndarray) -> np.ndarray:
    """Interpolación trigonométrica circular de log K (…,12) -> (…,366). Exacta en los centros de mes."""
    L = np.log(np.asarray(k12, float))
    c = np.fft.rfft(L, axis=-1)                       # armónicos 0..6
    t = _doy_to_month_pos()
    k = np.arange(c.shape[-1])
    w = np.where((k == 0) | (k == 6), 1.0, 2.0)       # pesos de la serie real (Nyquist una vez)
    ph = np.exp(2j * np.pi * np.outer(k, t) / 12)      # (7, 366)
    f = np.real((c * w)[..., :, None] * ph).sum(axis=-2) / 12
    return np.exp(f)


def step_from_monthly(k12: np.ndarray) -> np.ndarray:
    """Factor escalonado (constante dentro de cada mes, calendario no bisiesto; día 366 = diciembre)."""
    month_of_doy = np.array([(date(2001, 1, 1) + timedelta(days=int(d) - 1)).month - 1 for d in range(1, 366)] + [11])
    return np.asarray(k12, float)[..., month_of_doy]


def _popcount(m: int) -> int:
    return bin(m).count("1")


def daily_subset_counts(events: pl.DataFrame, activity: pl.DataFrame, masks: list[int]) -> pl.DataFrame:
    """Por día: eventos (in_series) que vería cada sub-constelación de `masks`."""
    ev = events.filter(pl.col("in_series"))
    agg = ev.group_by("solar_date").agg(
        [((pl.col("sat_mask_series") & m) != 0).sum().cast(pl.Int64).alias(f"c_{m}") for m in masks]
        + [pl.len().cast(pl.Int64).alias("events_observed")])
    allc = events.group_by("solar_date").agg(pl.len().cast(pl.Int64).alias("events_all_confidence"))
    out = (activity.rename({"date": "solar_date"})
           .join(agg, on="solar_date", how="left").join(allc, on="solar_date", how="left")
           .with_columns(pl.exclude("solar_date", "active_mask", "epoch_id", "n_active").fill_null(0)))
    return out.with_columns(pl.col("solar_date").dt.truncate("1mo").alias("month"),
                            pl.col("solar_date").dt.month().alias("moy"))


# ----------------------------------------------------------------------------- ajuste mensual
def fit_monthly_ratio(x: np.ndarray, y: np.ndarray, scope: str, method: str,
                      harmonics: int = 2, window: int = 3, prior_events: float = 0.0) -> np.ndarray:
    """Cociente por mes del año (12 valores) a partir de sumas x, y por mes del año.

    Con `prior_events` = k > 0, el log-cociente de cada mes se contrae hacia el del total
    (Bayes empírico): log r_m = (x_m·log(y_m/x_m) + k·log r_total) / (x_m + k), con peso x_m + k.
    Un mes con pocos eventos (p. ej. 12 en el invierno uruguayo de 2002) queda cerca del cociente
    anual en vez de producir un factor extremo; un mes con miles de eventos casi no cambia."""
    x, y = np.asarray(x, float), np.asarray(y, float)
    total = y.sum() / x.sum() if x.sum() > 0 else np.nan
    if scope == "global" or not np.isfinite(total):
        return np.full(12, total)
    valid = (x > 0) & (y > 0)
    lr = np.where(valid, np.log(np.where(valid, y, 1) / np.where(valid, x, 1)), 0.0)
    w = np.where(valid, x, 0.0)
    if prior_events > 0:
        lr = (w * lr + prior_events * np.log(total)) / (w + prior_events)
        w = w + prior_events
        valid = np.ones(12, bool)
    if method == "none":
        r = np.where(valid, np.exp(lr), total)
    elif method == "moving_average":
        h = window // 2
        r = np.empty(12)
        for m in range(12):
            idx = [(m + k) % 12 for k in range(-h, h + 1)]
            sw = w[idx].sum()
            r[m] = np.exp((w[idx] * lr[idx]).sum() / sw) if sw > 0 else total
    elif method == "harmonic":
        n_par = 1 + 2 * harmonics
        if valid.sum() < n_par:
            return fit_monthly_ratio(x, y, scope, "moving_average", harmonics, window, prior_events)
        t = 2 * np.pi * np.arange(12) / 12
        X = np.column_stack([np.ones(12)] + [f(k * t) for k in range(1, harmonics + 1) for f in (np.cos, np.sin)])
        sw = np.sqrt(w)
        coef, *_ = np.linalg.lstsq(X * sw[:, None], lr * sw, rcond=None)
        r = np.exp(X @ coef)
    else:
        raise ValueError(method)
    # conservar el total de la ventana: Σ r(m)·x_m = Σ y_m
    pred = (r * x).sum()
    return r * (y.sum() / pred) if pred > 0 else r


def _by_moy(moy: np.ndarray, v: np.ndarray) -> np.ndarray:
    return np.bincount(moy - 1, weights=v, minlength=12)


def _cv(moy, xs, ys, scope, method, sm) -> dict | None:
    """Validación temporal: ajusta en la 1ª mitad de la ventana, predice cada mes de la 2ª."""
    h = len(xs) // 2
    if h < 3 or xs[:h].sum() == 0 or ys[h:].sum() == 0:
        return None
    r12 = fit_monthly_ratio(_by_moy(moy[:h], xs[:h]), _by_moy(moy[:h], ys[:h]), scope, method,
                            sm.harmonics, sm.window, sm.prior_events)
    r12 = np.where(np.isfinite(r12), r12, ys[:h].sum() / xs[:h].sum())
    pred, obs = r12[moy[h:] - 1] * xs[h:], ys[h:]
    ok = obs > 0
    return {"monthly_mape_pct": round(float(np.mean(np.abs(pred[ok] - obs[ok]) / obs[ok]) * 100), 2),
            "monthly_wape_pct": round(float(np.abs(pred - obs).sum() / obs.sum() * 100), 2),
            "total_bias_pct": round(float((pred.sum() - obs.sum()) / obs.sum() * 100), 2),
            "n_test_months": int(len(obs))}


def _ratio_stats(df: pl.DataFrame, x: int, y: int, rng: np.random.Generator, cc: CalibrationCfg) -> dict:
    m = (df.group_by("month").agg(pl.col("moy").first(), pl.col(f"c_{x}").sum().alias("x"),
                                  pl.col(f"c_{y}").sum().alias("y")).sort("month"))
    moy = m["moy"].to_numpy().astype(int)
    xs, ys = m["x"].to_numpy().astype(float), m["y"].to_numpy().astype(float)
    if xs.sum() == 0:
        raise ValueError(f"Sin eventos para estimar r({x}->{y})")
    sm, scope = cc.smoothing, cc.factor_scope
    cv = {f"{s}/{mt}" if s != "global" else "global": _cv(moy, xs, ys, s, mt, sm) for s, mt in CV_METHODS}
    selected = "global" if scope == "global" else f"{scope}/{sm.method}"
    if selected not in cv:
        cv[selected] = _cv(moy, xs, ys, scope, sm.method, sm)
    # Selección por validación cruzada: el factor estacional solo si predice al menos tan bien
    # como el anual único (WAPE de la 2ª mitad de la ventana).
    if sm.select_by_cv and selected != "global" and cv.get(selected) and cv.get("global"):
        if cv["global"]["monthly_wape_pct"] < cv[selected]["monthly_wape_pct"]:
            selected = "global"
    fit_scope, fit_method = ("global", "none") if selected == "global" else (scope, sm.method)
    fit = lambda a, b: fit_monthly_ratio(a, b, fit_scope, fit_method, sm.harmonics, sm.window,  # noqa: E731
                                         sm.prior_events)
    x12, y12 = _by_moy(moy, xs), _by_moy(moy, ys)
    r12 = fit(x12, y12)
    r_total = ys.sum() / xs.sum()

    # bootstrap estratificado por mes del año
    B = cc.bootstrap.n
    xb, yb = np.zeros((B, 12)), np.zeros((B, 12))
    for k in range(12):
        idx = np.flatnonzero(moy == k + 1)
        if len(idx):
            draw = idx[rng.integers(0, len(idx), size=(B, len(idx)))]
            xb[:, k], yb[:, k] = xs[draw].sum(1), ys[draw].sum(1)
    boot = np.vstack([fit(xb[b], yb[b]) for b in range(B)])
    boot = np.where(np.isfinite(boot), boot, r12)

    yearly = (df.group_by(pl.col("solar_date").dt.year().alias("year"))
              .agg(pl.col(f"c_{x}").sum().alias("x"), pl.col(f"c_{y}").sum().alias("y")).sort("year")
              .with_columns((pl.col("y") / pl.col("x")).round(4).alias("ratio")))
    with np.errstate(divide="ignore", invalid="ignore"):
        raw12 = np.where(x12 > 0, y12 / x12, np.nan)
    moy_tab = [{"month_of_year": k + 1, "x": int(x12[k]), "y": int(y12[k]),
                "ratio_raw": None if np.isnan(raw12[k]) else round(float(raw12[k]), 4),
                "ratio_fitted": round(float(r12[k]), 4)} for k in range(12)]
    return {"r12": r12, "boot": boot, "r_total": float(r_total), "n_months": len(xs),
            "sum_x": int(xs.sum()), "sum_y": int(ys.sum()), "selected_method": selected,
            "cross_validation": cv, "yearly": yearly.to_dicts(), "month_of_year": moy_tab}


# ----------------------------------------------------------------------------- calibración
def calibrate(cfg: PipelineCfg, events: pl.DataFrame, activity: pl.DataFrame):
    cc = cfg.calibration
    rng = np.random.default_rng(cc.bootstrap.seed)
    ep = epochs_table(activity).filter(pl.col("active_mask") > 0)
    masks = sorted(set(ep["active_mask"].to_list()))
    daily = daily_subset_counts(events, activity, masks)
    days_per_mask = daily.group_by("active_mask").len()
    n_days = dict(zip(days_per_mask["active_mask"].to_list(), days_per_mask["len"].to_list()))

    if cc.reference == "auto":
        ref = max(masks, key=lambda m: (_popcount(m), n_days.get(m, 0)))
    else:
        ref = next(m for m in masks if epoch_name(cfg, m) == cc.reference)

    # aristas entre constelaciones consecutivas en el tiempo
    seq = ep["active_mask"].to_list()
    edges = sorted({tuple(sorted((a, b))) for a, b in zip(seq, seq[1:]) if a != b})
    act = daily["active_mask"]
    edge_stats = {}
    for a, b in edges:
        u = a | b
        sup = b if (a & b) == a else a if (a & b) == b else None
        win = (act == sup) if (cc.window == "adjacent" and sup is not None) else None
        if win is not None and sup is not None and cc.proximity_years:
            # proximidad temporal: solo los días del superconjunto a <= N años de la época a calibrar
            # la época a calibrar se define por sus bloques LARGOS (>= 30 días): los bloques cortos
            # creados por caídas de otro satélite (p.ej. días "solo Terra" en 2008) no estiran el rango,
            # y los días sin dato dentro de la época no la parten.
            sub = a if sup == b else b
            blocks = ep.filter(pl.col("active_mask") == sub)
            long_b = blocks.filter(pl.col("n_days") >= 30)
            span_b = long_b if long_b.height else blocks
            pad = timedelta(days=round(365.25 * cc.proximity_years))
            near = win & daily["solar_date"].is_between(span_b["start"].min() - pad, span_b["end"].max() + pad)
            if int(near.sum()) >= cc.min_window_days:
                win = near
        if win is None or int(win.sum()) < cc.min_window_days:
            win = (act & u) == u
        wdf = daily.filter(win)
        if wdf.height == 0:
            raise ValueError(f"Sin días donde {epoch_name(cfg, u)} esté activa para calibrar")
        st = _ratio_stats(wdf, a, b, rng, cc)        # r = eventos_b / eventos_a (12 valores)
        st.update(window_days=wdf.height, window_start=str(wdf["solar_date"].min()),
                  window_end=str(wdf["solar_date"].max()))
        edge_stats[(a, b)] = st

    # BFS desde la referencia: K_X = r(X→Y)·K_Y   (vectores de 12 meses; réplicas B×12)
    B = cc.bootstrap.n
    K = {ref: (np.ones(12), np.ones((B, 12)), [])}
    q = deque([ref])
    while q:
        cur = q.popleft()
        k_pt, k_bt, path = K[cur]
        for (a, b), st in edge_stats.items():
            if cur not in (a, b):
                continue
            other = b if cur == a else a
            if other in K:
                continue
            if cur == b:
                K[other] = (k_pt * st["r12"], k_bt * st["boot"], path + [(a, b)])
            else:
                K[other] = (k_pt / st["r12"], k_bt / st["boot"], path + [(a, b)])
            q.append(other)
    missing = [epoch_name(cfg, m) for m in masks if m not in K]
    if missing:
        raise ValueError(f"Constelaciones sin camino de calibración a la referencia: {missing}")

    lo_q, hi_q = (1 - cc.bootstrap.ci) / 2, 1 - (1 - cc.bootstrap.ci) / 2
    rows = []
    for m in masks:
        lo, hi = np.quantile(K[m][1], lo_q, axis=0), np.quantile(K[m][1], hi_q, axis=0)
        path = " -> ".join(f"[{epoch_name(cfg, a)} | {epoch_name(cfg, b)}]" for a, b in K[m][2]) or "reference"
        for k in range(12):
            rows.append({"active_mask": m, "epoch_id": epoch_name(cfg, m), "month_of_year": k + 1,
                         "n_days": n_days.get(m, 0), "k_factor": float(K[m][0][k]),
                         "k_ci_low": float(lo[k]), "k_ci_high": float(hi[k]), "calibration_path": path})
    factors = pl.DataFrame(rows).with_columns(pl.col("month_of_year").cast(pl.Int8))

    # Factor DIARIO: interpolación trigonométrica (circular) de log K entre los centros de mes.
    # Con el ajuste armónico (≤5 armónicos) es exacta: el armónico ES una función continua del
    # día del año; así se eliminan los escalones del factor al cambiar de mes.
    doys = np.arange(1, 367)
    to_daily = (daily_from_monthly if cc.daily_interpolation else step_from_monthly)
    Kd = {m: (to_daily(K[m][0]), to_daily(K[m][1])) for m in masks}          # (366,), (B,366)
    drows = []
    for m in masks:
        lo, hi = np.quantile(Kd[m][1], lo_q, axis=0), np.quantile(Kd[m][1], hi_q, axis=0)
        drows.append(pl.DataFrame({"active_mask": m, "epoch_id": epoch_name(cfg, m), "doy": doys.astype(np.int16),
                                   "k_factor": Kd[m][0], "k_ci_low": lo, "k_ci_high": hi}))
    factors_daily = pl.concat(drows)
    kjoin = factors_daily.select("active_mask", "doy", "k_factor",
                                 pl.col("k_ci_low").alias("_klo"), pl.col("k_ci_high").alias("_khi"))

    # serie diaria
    has_obs = pl.col("active_mask") > 0
    ts = (daily.with_columns(pl.col("solar_date").dt.ordinal_day().cast(pl.Int16).alias("doy"))
          .join(kjoin, on=["active_mask", "doy"], how="left")
          .select(pl.col("solar_date").alias("date"), "month", "doy", "epoch_id", "n_active", "active_mask",
                  pl.when(has_obs).then(pl.col("events_observed")).alias("events_observed"),
                  pl.when(has_obs).then(pl.col("events_all_confidence")).alias("events_all_confidence"),
                  "k_factor", "_klo", "_khi")
          .with_columns((pl.col("events_observed") * pl.col("k_factor")).alias("events_harmonized"),
                        (pl.col("events_observed") * pl.col("_klo")).alias("events_harmonized_ci_low"),
                        (pl.col("events_observed") * pl.col("_khi")).alias("events_harmonized_ci_high"))
          .drop("_klo", "_khi").sort("date"))
    # marca de observación: sin satélite / racha de ceros sospechosa (no alcanza a ser caída) / ok
    zero = (pl.col("events_observed") == 0).fill_null(False)
    ts = (ts.with_columns(zero.alias("_z"))
          .with_columns((pl.col("_z") != pl.col("_z").shift()).fill_null(True).cum_sum().alias("_r"))
          .with_columns(pl.len().over("_r").alias("_rl"))
          .with_columns(pl.when(~has_obs).then(pl.lit("no_satellite"))
                          .when(pl.col("_z") & (pl.col("_rl") >= cfg.availability.suspect_zero_min_run))
                          .then(pl.lit("suspect_zero"))
                          .otherwise(pl.lit("ok")).alias("observation_flag"))
          .drop("_z", "_r", "_rl"))

    # serie mensual con IC coherente: se suman día a día las MISMAS réplicas bootstrap
    months = ts["month"].unique().sort()
    midx = {mo: i for i, mo in enumerate(months.to_list())}
    obs_days = ts.filter(has_obs)
    kb = np.stack([Kd[m][1] for m in masks])                                  # (S, B, 366)
    s_idx = np.array([masks.index(a) for a in obs_days["active_mask"].to_list()])
    d_idx = obs_days["doy"].to_numpy().astype(int) - 1
    o = obs_days["events_observed"].to_numpy().astype(float)
    m_idx = np.array([midx[mo] for mo in obs_days["month"].to_list()])
    boot_m = np.zeros((len(months), cc.bootstrap.n))
    np.add.at(boot_m, m_idx, kb[s_idx, :, d_idx] * o[:, None])
    point_m = np.bincount(m_idx, weights=o * np.array([Kd[masks[s]][0][d] for s, d in zip(s_idx, d_idx)]),
                          minlength=len(months))
    monthly = (ts.group_by("month").agg(
        pl.col("events_observed").sum(), pl.col("events_all_confidence").sum(),
        pl.col("events_harmonized").sum(),
        (pl.col("active_mask") > 0).sum().alias("days_observed"), pl.len().alias("days_in_month"),
        (pl.col("observation_flag") == "suspect_zero").sum().alias("days_suspect_zero"),
        pl.col("epoch_id").filter(pl.col("active_mask") > 0).unique().sort().str.join(",").alias("epochs"))
        .sort("month")
        .join(pl.DataFrame({"month": months, "events_harmonized_ci_low": np.quantile(boot_m, lo_q, axis=1),
                            "events_harmonized_ci_high": np.quantile(boot_m, hi_q, axis=1),
                            "_check": point_m}), on="month"))
    assert np.allclose(monthly["_check"].to_numpy(), monthly["events_harmonized"].to_numpy()), "IC mensual inconsistente"
    monthly = monthly.drop("_check")
    # meses con días sin ningún satélite: cobertura explícita + versión re-escalada a mes completo
    scale = pl.col("days_in_month") / pl.col("days_observed")
    monthly = monthly.with_columns(
        (pl.col("days_observed") / pl.col("days_in_month")).alias("coverage_frac"),
        pl.when(pl.col("days_observed") > 0).then(pl.col("events_harmonized") * scale)
          .alias("events_harmonized_gapfilled"),
        pl.when(pl.col("days_observed") > 0).then(pl.col("events_harmonized_ci_low") * scale)
          .alias("events_harmonized_gapfilled_ci_low"),
        pl.when(pl.col("days_observed") > 0).then(pl.col("events_harmonized_ci_high") * scale)
          .alias("events_harmonized_gapfilled_ci_high"))

    report = {
        "method": "constellation_subset_chain (ratio of totals)",
        "factor_scope": cc.factor_scope, "smoothing": cc.smoothing.model_dump(),
        "reference_constellation": epoch_name(cfg, ref),
        "series_min_confidence": cfg.confidence.series_min_level,
        "bootstrap": cc.bootstrap.model_dump(),
        "window_rule": cc.window, "min_window_days": cc.min_window_days,
        "epochs": [{**r, "start": str(r["start"]), "end": str(r["end"])} for r in ep.to_dicts()],
        "edges": [{"from": epoch_name(cfg, a), "to": epoch_name(cfg, b),
                   "ratio_total": round(st["r_total"], 5),
                   "ratio_fitted_by_month": [round(float(v), 4) for v in st["r12"]],
                   "ratio_ci_by_month": [[round(float(lo), 4), round(float(hi), 4)] for lo, hi in
                                         zip(np.quantile(st["boot"], lo_q, axis=0), np.quantile(st["boot"], hi_q, axis=0))],
                   **{k: v for k, v in st.items() if k not in ("r12", "boot", "r_total")}}
                  for (a, b), st in edge_stats.items()],
        "factors": factors.to_dicts(),
    }
    report["daily_interpolation"] = cc.daily_interpolation
    return factors, factors_daily, ts, monthly, report, kjoin.select("active_mask", "doy", "k_factor")
