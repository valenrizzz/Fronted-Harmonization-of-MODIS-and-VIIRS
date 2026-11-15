"""KPIs para tarjetas de resumen, calculados sobre la serie diaria (con o sin bbox)."""

from __future__ import annotations

from collections import defaultdict
from datetime import date
from typing import Any

from ..deps import Window
from . import rnd
from .timeseries import daily_rows


def _shift_year(d: date, years: int = -1) -> date:
    try:
        return d.replace(year=d.year + years)
    except ValueError:  # 29 de febrero
        return d.replace(year=d.year + years, day=28)


def _share(acc: dict[str, float]) -> dict[str, float]:
    total = sum(acc.values())
    return {k: (round(v / total, 4) if total > 0 else 0.0) for k, v in sorted(acc.items())}


def summarize(w: Window) -> dict[str, Any]:
    rows = daily_rows(w)
    valid = [r for r in rows if r["status"] != "no_data"]

    total = sum(r["w"] for r in valid)
    ci_low = sum(r["l"] for r in valid)
    ci_high = sum(r["h"] for r in valid)
    observed = sum(int(r["obs"]) for r in valid)

    peak_day = max(valid, key=lambda r: r["w"], default=None)
    by_month: dict[date, float] = defaultdict(float)
    layer_acc: dict[str, float] = {"SP": 0.0, "NRT": 0.0}
    tier_acc: dict[str, float] = {"high": 0.0, "medium": 0.0, "low": 0.0}
    for r in valid:
        by_month[r["date"].replace(day=1)] += r["w"]
        layer_acc[r["layer"]] = layer_acc.get(r["layer"], 0.0) + r["w"]
        if r["reliability_tier"]:
            tier_acc[r["reliability_tier"]] += r["w"]
    peak_month = max(by_month.items(), key=lambda kv: kv[1], default=None)

    prev_start, prev_end = _shift_year(w.start), _shift_year(w.end)
    if prev_start < w.region.period_start:
        yoy = {
            "available": False,
            "previous_start": prev_start,
            "previous_end": prev_end,
            "reason": f"La ventana del año anterior empieza antes del inicio de datos ({w.region.period_start})",
        }
    else:
        prev_rows = daily_rows(w, prev_start, prev_end)
        prev_total = sum(r["w"] for r in prev_rows if r["status"] != "no_data")
        yoy = {
            "available": True,
            "previous_start": prev_start,
            "previous_end": prev_end,
            "previous_value": rnd(prev_total),
            "change_pct": rnd((total - prev_total) / prev_total * 100, 2) if prev_total > 0 else None,
        }

    return {
        "total_harmonized": {"value": rnd(total), "ci_low": rnd(ci_low), "ci_high": rnd(ci_high)},
        "total_observed": observed,
        "yoy": yoy,
        "peak_day": {"date": peak_day["date"], "events_harmonized": rnd(peak_day["w"])} if peak_day else None,
        "peak_month": {"date": peak_month[0], "events_harmonized": rnd(peak_month[1])} if peak_month else None,
        "layer_share": _share(layer_acc),
        "reliability_share": _share(tier_acc),
        "days_total": len(rows),
        "days_no_data": len(rows) - len(valid),
    }
