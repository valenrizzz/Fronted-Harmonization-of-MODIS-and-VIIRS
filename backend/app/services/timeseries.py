"""Series temporales diarias y mensuales.

Sin bbox se leen las series precalculadas (IC exactos de la región).
Con bbox se suman los pesos de los eventos dentro del recorte; el estado del día
(capa SP/NRT, reliability_tier, sin dato) sale de la serie diaria porque depende
del día y no del lugar. Los días sin ningún satélite devuelven null, no 0.
"""

from __future__ import annotations

import calendar
from datetime import date
from typing import Any

from ..deps import Window
from . import STATUS_BY_FLAG, bbox_clause, rnd


def month_bounds(w: Window) -> tuple[date, date]:
    """La serie mensual cubre meses completos: se extiende la ventana al mes entero."""
    s = w.start.replace(day=1)
    last = calendar.monthrange(w.end.year, w.end.month)[1]
    e = min(w.end.replace(day=last), w.region.period_end)
    return s, e


def _events_cte(w: Window, start: date, end: date) -> tuple[str, list[Any]]:
    bb_sql, bb_params = bbox_clause(w.bbox)
    sql = (
        "e AS (SELECT solar_date AS d, "
        "count(*) FILTER (WHERE in_series) AS obs, "
        "sum(harmonized_weight) AS w, sum(weight_ci_low) AS l, sum(weight_ci_high) AS h, "
        # conteo original de FIRMS: detecciones (píxeles) de todas las confianzas, sin corrección
        "sum(n_raw_detections) AS nasa "
        f"FROM {w.region.views['events']} WHERE solar_date BETWEEN ? AND ?{bb_sql} GROUP BY 1)"
    )
    return sql, [start, end, *bb_params]


def _outages_cte(w: Window, start: date, end: date) -> tuple[str, list[Any]]:
    sql = (
        "o AS (SELECT date AS d, list(satellite ORDER BY satellite) AS down "
        f"FROM {w.region.views['outages']} WHERE date BETWEEN ? AND ? GROUP BY 1)"
    )
    return sql, [start, end]


def daily_rows(w: Window, start: date | None = None, end: date | None = None) -> list[dict[str, Any]]:
    """Filas diarias normalizadas; también las usa /summary.

    Sin bbox, los valores armonizados salen de la serie precalculada (IC exactos); con bbox,
    de los eventos del recorte. El conteo original de la NASA y los satélites caídos se
    agregan siempre."""
    start, end = start or w.start, end or w.end
    tsd = w.region.views["daily"]
    ecte, eparams = _events_cte(w, start, end)
    octe, oparams = _outages_cte(w, start, end)
    if w.bbox is None:
        vals = ("t.events_observed AS obs, t.events_harmonized AS w, "
                "t.events_harmonized_ci_low AS l, t.events_harmonized_ci_high AS h")
    else:
        vals = "coalesce(e.obs, 0) AS obs, coalesce(e.w, 0) AS w, coalesce(e.l, 0) AS l, coalesce(e.h, 0) AS h"
    sql = (
        f"WITH {ecte}, {octe} SELECT t.date, t.layer, t.observation_flag AS flag, t.reliability_tier, {vals}, "
        "coalesce(e.nasa, 0) AS nasa, coalesce(o.down, []) AS down "
        f"FROM {tsd} t LEFT JOIN e ON e.d = t.date LEFT JOIN o ON o.d = t.date "
        "WHERE t.date BETWEEN ? AND ? ORDER BY t.date"
    )
    rows = w.db.query(sql, [*eparams, *oparams, start, end])
    for r in rows:
        r["status"] = STATUS_BY_FLAG.get(r["flag"], "ok")
        r["nasa"] = int(r["nasa"])
        if r["status"] == "no_data":
            r["obs"] = r["w"] = r["l"] = r["h"] = r["nasa"] = None
    return rows


def daily(w: Window) -> list[dict[str, Any]]:
    return [
        {
            "date": r["date"],
            "events_observed": r["obs"],
            "events_harmonized": rnd(r["w"]),
            "ci_low": rnd(r["l"]),
            "ci_high": rnd(r["h"]),
            "reliability_tier": r["reliability_tier"],
            "layer": r["layer"],
            "status": r["status"],
            "nasa_detections": r["nasa"],
            "satellites_down": list(r["down"]),
        }
        for r in daily_rows(w)
    ]


def _monthly_extras(w: Window, s: date, e: date) -> dict[date, dict[str, Any]]:
    """Por mes: conteo original de la NASA y días con algún satélite fuera de servicio."""
    ecte, eparams = _events_cte(w, s, e)
    octe, oparams = _outages_cte(w, s, e)
    tsd = w.region.views["daily"]
    rows = w.db.query(
        f"WITH {ecte}, {octe} SELECT date_trunc('month', t.date)::DATE AS month, "
        "sum(coalesce(e.nasa, 0)) FILTER (WHERE t.observation_flag <> 'no_satellite') AS nasa, "
        "count(*) FILTER (WHERE o.d IS NOT NULL) AS days_down "
        f"FROM {tsd} t LEFT JOIN e ON e.d = t.date LEFT JOIN o ON o.d = t.date "
        "WHERE t.date BETWEEN ? AND ? GROUP BY 1",
        [*eparams, *oparams, s, e],
    )
    return {r["month"]: r for r in rows}


def _month_status(days_observed: int, coverage: float, suspect: int) -> str:
    if days_observed == 0:
        return "no_data"
    if coverage < 1:
        return "partial"
    if suspect > 0:
        return "suspect_zero"
    return "ok"


def monthly(w: Window) -> tuple[list[dict[str, Any]], date, date]:
    s, e = month_bounds(w)
    tsm = w.region.views["monthly"]
    if w.bbox is None:
        sql = (
            "SELECT month, layer, reliability_tier, days_observed, days_suspect_zero, coverage_frac, "
            "events_observed AS obs, events_harmonized AS w, events_harmonized_ci_low AS l, "
            "events_harmonized_ci_high AS h, events_harmonized_gapfilled AS gw, "
            "events_harmonized_gapfilled_ci_low AS gl, events_harmonized_gapfilled_ci_high AS gh "
            f"FROM {tsm} WHERE month BETWEEN ? AND ? ORDER BY month"
        )
        params: list[Any] = [s, e]
    else:
        cte, params = _events_cte(w, s, e)
        tsd = w.region.views["daily"]
        sql = (
            f"WITH {cte}, agg AS ("
            "SELECT date_trunc('month', t.date)::DATE AS month, "
            "sum(coalesce(e.obs, 0)) FILTER (WHERE t.observation_flag <> 'no_satellite') AS obs, "
            "sum(coalesce(e.w, 0)) FILTER (WHERE t.observation_flag <> 'no_satellite') AS w, "
            "sum(coalesce(e.l, 0)) FILTER (WHERE t.observation_flag <> 'no_satellite') AS l, "
            "sum(coalesce(e.h, 0)) FILTER (WHERE t.observation_flag <> 'no_satellite') AS h "
            f"FROM {tsd} t LEFT JOIN e ON e.d = t.date WHERE t.date BETWEEN ? AND ? GROUP BY 1) "
            "SELECT m.month, m.layer, m.reliability_tier, m.days_observed, m.days_suspect_zero, "
            "m.coverage_frac, a.obs, a.w, a.l, a.h, NULL AS gw, NULL AS gl, NULL AS gh "
            f"FROM {tsm} m JOIN agg a ON a.month = m.month ORDER BY m.month"
        )
        params += [s, e]
    extras = _monthly_extras(w, s, e)
    points = []
    for r in w.db.query(sql, params):
        status = _month_status(int(r["days_observed"]), float(r["coverage_frac"]), int(r["days_suspect_zero"]))
        empty = status == "no_data"
        x = extras.get(r["month"], {})
        points.append(
            {
                "date": r["month"],
                "events_observed": None if empty or r["obs"] is None else int(r["obs"]),
                "events_harmonized": None if empty else rnd(r["w"]),
                "ci_low": None if empty else rnd(r["l"]),
                "ci_high": None if empty else rnd(r["h"]),
                "events_harmonized_gapfilled": rnd(r["gw"]),
                "gapfilled_ci_low": rnd(r["gl"]),
                "gapfilled_ci_high": rnd(r["gh"]),
                "coverage_frac": rnd(r["coverage_frac"], 4),
                "reliability_tier": r["reliability_tier"],
                "layer": r["layer"],
                "status": status,
                "nasa_detections": None if empty or x.get("nasa") is None else int(x["nasa"]),
                "days_with_satellite_down": int(x.get("days_down") or 0),
            }
        )
    return points, s, e
