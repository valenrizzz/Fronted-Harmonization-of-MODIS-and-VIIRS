"""Agregación espacial de eventos en celdas H3 con protección de tamaño de respuesta.

Solo se usan las resoluciones ya precalculadas en los Parquet (7, 5 y 3). Si la
resolución pedida supera ``max_cells`` celdas, se pasa a la siguiente más gruesa;
si aun en res 3 se supera, se devuelven las celdas de mayor peso (truncated=True).
"""

from __future__ import annotations

from typing import Any, Literal

import h3

from ..deps import Window
from . import bbox_clause, rnd

RES_COLUMN = {7: "h3_cell", 5: "h3_r5", 3: "h3_r3"}
AVAILABLE_RES = sorted(RES_COLUMN, reverse=True)  # 7, 5, 3


def res_for_zoom(zoom: float) -> int:
    if zoom <= 5:
        return 3
    if zoom <= 8:
        return 5
    return 7


def cells(
    w: Window,
    res_requested: int,
    confidence: Literal["series", "all"],
    cap: int,
) -> dict[str, Any]:
    ev = w.region.views["events"]
    bb_sql, bb_params = bbox_clause(w.bbox)
    where = f"solar_date BETWEEN ? AND ?{bb_sql}" + (" AND in_series" if confidence == "series" else "")
    params: list[Any] = [w.start, w.end, *bb_params]

    counts = w.db.query(
        f"SELECT count(DISTINCT h3_cell) AS c7, count(DISTINCT h3_r5) AS c5, "
        f"count(DISTINCT h3_r3) AS c3 FROM {ev} WHERE {where}",
        params,
    )[0]
    n_at = {7: counts["c7"], 5: counts["c5"], 3: counts["c3"]}

    res = res_requested
    while n_at[res] > cap and res != AVAILABLE_RES[-1]:
        res = AVAILABLE_RES[AVAILABLE_RES.index(res) + 1]
    col = RES_COLUMN[res]

    sql = (
        f"WITH base AS (SELECT {col} AS cell, reliability_tier AS tier, count(*) AS n, "
        "count(*) FILTER (WHERE layer = 'NRT') AS n_nrt, sum(harmonized_weight) AS w, "
        "sum(weight_ci_low) AS l, sum(weight_ci_high) AS h, max(frp_max) AS fmax, "
        "sum(frp_mean) AS fsum, count(frp_mean) AS fcnt "
        f"FROM {ev} WHERE {where} GROUP BY 1, 2) "
        "SELECT cell, sum(n) AS events, sum(n_nrt) AS events_nrt, sum(w) AS weight, "
        "sum(l) AS ci_low, sum(h) AS ci_high, max(fmax) AS frp_max, "
        "sum(fsum) / nullif(sum(fcnt), 0) AS frp_mean, arg_max(tier, w) AS tier "
        "FROM base GROUP BY cell ORDER BY weight DESC, events DESC LIMIT ?"
    )
    rows = w.db.query(sql, [*params, cap])

    out = []
    for r in rows:
        idx = h3.int_to_str(int(r["cell"]))
        lat, lon = h3.cell_to_latlng(idx)
        out.append(
            {
                "h3": idx,
                "lat": round(lat, 5),
                "lon": round(lon, 5),
                "events": int(r["events"]),
                "events_nrt": int(r["events_nrt"]),
                "weight": rnd(r["weight"]),
                "weight_ci_low": rnd(r["ci_low"]),
                "weight_ci_high": rnd(r["ci_high"]),
                "frp_max": rnd(r["frp_max"], 2),
                "frp_mean": rnd(r["frp_mean"], 2),
                "reliability_tier": r["tier"],
            }
        )
    return {
        "res": res,
        "res_requested": res_requested,
        "coarsened": res != res_requested,
        "truncated": n_at[res] > cap,
        "n_cells": len(out),
        "n_cells_total": int(n_at[res]),
        "confidence": confidence,
        "cells": out,
    }


def to_geojson(payload: dict[str, Any]) -> dict[str, Any]:
    features = []
    for c in payload["cells"]:
        ring = [[lon, lat] for lat, lon in h3.cell_to_boundary(c["h3"])]
        ring.append(ring[0])
        features.append(
            {
                "type": "Feature",
                "id": c["h3"],
                "geometry": {"type": "Polygon", "coordinates": [ring]},
                "properties": c,
            }
        )
    meta = {k: v for k, v in payload.items() if k != "cells"}
    return {"type": "FeatureCollection", "features": features, "metadata": meta}
