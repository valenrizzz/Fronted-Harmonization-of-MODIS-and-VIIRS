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
        "sum(harmonized_weight) AS w, sum(weight_ci_low) AS l, sum(weight_ci_high) AS h "
        f"FROM {w.region.views['events']} WHERE solar_date BETWEEN ? AND ?{bb_sql} GROUP BY 1)"
    )
    return sql, [start, end, *bb_params]


def daily_rows(w: Window, start: date | None = None, end: date | None = None) -> list[dict[str, Any]]:
    """Filas diarias normalizadas; también las usa /summary."""
    start, end = start or w.start, end or w.end
    tsd = w.region.views["daily"]
    if w.bbox is None:
        sql = (
            "SELECT date, layer, observation_flag AS flag, reliability_tier, events_observed AS obs, "
            "events_harmonized AS w, events_harmonized_ci_low AS l, events_harmonized_ci_high AS h "
            f"FROM {tsd} WHERE date BETWEEN ? AND ? ORDER BY date"
        )
        params: list[Any] = [start, end]
    else:
        cte, params = _events_cte(w, start, end)
        sql = (
            f"WITH {cte} SELECT t.date, t.layer, t.observation_flag AS flag, t.reliability_tier, "
            "coalesce(e.obs, 0) AS obs, coalesce(e.w, 0) AS w, coalesce(e.l, 0) AS l, coalesce(e.h, 0) AS h "
            f"FROM {tsd} t LEFT JOIN e ON e.d = t.date WHERE t.date BETWEEN ? AND ? ORDER BY t.date"
        )
        params += [start, end]
    rows = w.db.query(sql, params)
    for r in rows:
        r["status"] = STATUS_BY_FLAG.get(r["flag"], "ok")
        if r["status"] == "no_data":
            r["obs"] = r["w"] = r["l"] = r["h"] = None
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
        }
        for r in daily_rows(w)
    ]


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
    points = []
    for r in w.db.query(sql, params):
        status = _month_status(int(r["days_observed"]), float(r["coverage_frac"]), int(r["days_suspect_zero"]))
        empty = status == "no_data"
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
            }
        )
    return points, s, e
