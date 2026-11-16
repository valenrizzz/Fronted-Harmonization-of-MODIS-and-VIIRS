"""Satélites fuera de servicio (caídas detectadas por el pipeline), agrupados en períodos."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from ..deps import Window


def outages(w: Window) -> dict[str, Any]:
    rows = w.db.query(
        f"SELECT date, satellite FROM {w.region.views['outages']} "
        "WHERE date BETWEEN ? AND ? ORDER BY satellite, date",
        [w.start, w.end],
    )
    no_data = [
        r["date"]
        for r in w.db.query(
            f"SELECT date FROM {w.region.views['daily']} "
            "WHERE observation_flag = 'no_satellite' AND date BETWEEN ? AND ? ORDER BY date",
            [w.start, w.end],
        )
    ]
    no_data_set = set(no_data)

    periods: list[dict[str, Any]] = []
    for r in rows:
        last = periods[-1] if periods else None
        if last and last["satellite"] == r["satellite"] and r["date"] == last["end"] + timedelta(days=1):
            last["end"] = r["date"]
            last["_days"].append(r["date"])
        else:
            periods.append({"satellite": r["satellite"], "start": r["date"], "end": r["date"], "_days": [r["date"]]})

    out = []
    for p in periods:
        days: list[date] = p.pop("_days")
        p["days"] = len(days)
        # full: ese día no quedó ningún satélite observando (sin dato); partial: otros siguieron
        p["kind"] = "full" if all(d in no_data_set for d in days) else "partial"
        out.append(p)
    out.sort(key=lambda p: (p["start"], p["satellite"]))
    return {
        "periods": out,
        "no_data_days": no_data,
        "satellite_days": len(rows),
    }
