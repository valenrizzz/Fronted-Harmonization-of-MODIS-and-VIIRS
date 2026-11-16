"""Tests de integración contra los datos reales de Datos_Para_La_Web/ARG."""

import time

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.settings import get_settings

API = "/api/v1"
SENSOR_KEYS = {"satellites", "epoch_id", "epochs", "sat_mask", "sat_mask_series", "n_modis_detections",
               "n_viirs_detections", "active_mask", "n_active", "k_factor"}


@pytest.fixture(scope="module")
def client():
    settings = get_settings()
    if not (settings.data_root / "ARG" / "manifest.json").exists():
        pytest.skip("No hay datos de ARG en DATA_ROOT")
    with TestClient(create_app(settings)) as c:
        yield c


def get(client, path, **params):
    r = client.get(API + path, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def all_keys(obj):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield k
            yield from all_keys(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from all_keys(v)


# -- servicio -----------------------------------------------------------------
def test_health_and_regions(client):
    assert get(client, "/health")["status"] == "ok"
    regions = {r["region"]: r for r in get(client, "/regions")}
    arg = regions["ARG"]
    assert arg["period"]["start"] == "2000-11-01"
    assert arg["sp_nrt"]["sp_cutoff"] < arg["sp_nrt"]["nrt_start"] <= arg["sp_nrt"]["data_end"]
    w, s, e, n = arg["bbox"]
    assert -75 < w < e < -50 and -56 < s < n < -20


# -- series -------------------------------------------------------------------
def test_monthly_snaps_to_whole_months_and_matches_daily(client):
    m = get(client, "/timeseries", region="ARG", granularity="monthly", start="2020-01-15", end="2020-03-10")
    assert (m["start"], m["end"]) == ("2020-01-01", "2020-03-31")
    assert len(m["points"]) == 3 and m["ci_method"] == "exact"
    d = get(client, "/timeseries", region="ARG", granularity="daily", start="2020-01-01", end="2020-03-31")
    assert sum(p["events_harmonized"] for p in d["points"]) == pytest.approx(
        sum(p["events_harmonized"] for p in m["points"]), rel=1e-6
    )


def test_bbox_covering_region_equals_precomputed_series(client):
    kw = dict(region="ARG", granularity="daily", start="2019-01-01", end="2019-12-31")
    full = get(client, "/timeseries", **kw)["points"]
    boxed = get(client, "/timeseries", bbox="-80,-60,-50,-15", **kw)
    assert boxed["ci_method"] == "sum_of_event_ci"
    for a, b in zip(full, boxed["points"]):
        assert a["events_observed"] == b["events_observed"]
        assert a["events_harmonized"] == pytest.approx(b["events_harmonized"], abs=1e-2)
        assert (a["layer"], a["reliability_tier"], a["status"]) == (b["layer"], b["reliability_tier"], b["status"])


def test_days_without_satellite_are_null_not_zero(client):
    for bbox in (None, "-80,-60,-50,-15"):
        params = dict(region="ARG", granularity="daily", start="2001-06-15", end="2001-07-02")
        if bbox:
            params["bbox"] = bbox
        pts = get(client, "/timeseries", **params)["points"]
        nodata = [p for p in pts if p["status"] == "no_data"]
        assert nodata, "se esperaban días sin satélite en junio de 2001"
        assert all(p["events_harmonized"] is None and p["events_observed"] is None for p in nodata)


def test_sp_nrt_layers_follow_cutoff(client):
    cut = get(client, "/regions/ARG")["sp_nrt"]["sp_cutoff"]
    pts = get(client, "/timeseries", region="ARG", granularity="daily", start="2026-07-25", end="2026-08-05")["points"]
    for p in pts:
        assert p["layer"] == ("SP" if p["date"] <= cut else "NRT")


def test_smaller_bbox_gives_less_activity(client):
    kw = dict(region="ARG", start="2020-01-01", end="2020-12-31")
    total = get(client, "/summary", **kw)["total_harmonized"]["value"]
    sub = get(client, "/summary", bbox="-62,-30,-57,-26", **kw)["total_harmonized"]["value"]
    assert 0 < sub < total


# -- mapa ---------------------------------------------------------------------
def test_zoom_selects_resolution(client):
    for zoom, res in ((3, 3), (7, 5)):
        out = get(client, "/spatial/cells", region="ARG", start="2020-08-01", end="2020-08-31", zoom=zoom)
        assert out["res"] == res and not out["coarsened"]


def test_cells_weight_matches_summary_total(client):
    kw = dict(region="ARG", start="2020-01-01", end="2020-12-31")
    cells = get(client, "/spatial/cells", res=3, **kw)
    total = get(client, "/summary", **kw)["total_harmonized"]["value"]
    assert sum(c["weight"] for c in cells["cells"]) == pytest.approx(total, rel=1e-6)
    assert not cells["truncated"]


def test_coarsens_then_truncates_when_too_many_cells(client):
    out = get(client, "/spatial/cells", region="ARG", start="2020-01-01", end="2020-12-31", res=7, limit=500)
    assert out["res_requested"] == 7 and out["res"] == 3 and out["coarsened"]
    assert out["n_cells"] <= 500 and out["truncated"] == (out["n_cells_total"] > 500)
    weights = [c["weight"] for c in out["cells"]]
    assert weights == sorted(weights, reverse=True)


def test_confidence_all_adds_events_but_not_weight(client):
    kw = dict(region="ARG", start="2021-01-01", end="2021-12-31", res=3)
    series = get(client, "/spatial/cells", **kw)
    allc = get(client, "/spatial/cells", confidence="all", **kw)
    assert sum(c["events"] for c in allc["cells"]) > sum(c["events"] for c in series["cells"])
    assert sum(c["weight"] for c in allc["cells"]) == pytest.approx(sum(c["weight"] for c in series["cells"]), rel=1e-9)


def test_nrt_events_only_after_cutoff(client):
    before = get(client, "/spatial/cells", region="ARG", start="2026-07-01", end="2026-07-30", res=3)
    after = get(client, "/spatial/cells", region="ARG", start="2026-08-01", end="2026-08-31", res=3)
    assert sum(c["events_nrt"] for c in before["cells"]) == 0
    assert all(c["events_nrt"] == c["events"] for c in after["cells"])


def test_geojson_format(client):
    r = client.get(API + "/spatial/cells", params=dict(region="ARG", start="2020-08-01", end="2020-08-31", res=3, format="geojson"))
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/geo+json")
    fc = r.json()
    assert fc["type"] == "FeatureCollection" and fc["features"]
    ring = fc["features"][0]["geometry"]["coordinates"][0]
    assert ring[0] == ring[-1] and len(ring) == 7


# -- resumen ------------------------------------------------------------------
def test_summary_kpis(client):
    s = get(client, "/summary", region="ARG", start="2026-07-01", end="2026-09-30")
    assert s["layer_share"]["SP"] > 0 and s["layer_share"]["NRT"] > 0
    assert sum(s["layer_share"].values()) == pytest.approx(1, abs=1e-3)
    assert s["yoy"]["available"] and s["yoy"]["previous_start"] == "2025-07-01"
    t = s["total_harmonized"]
    assert t["ci_low"] <= t["value"] <= t["ci_high"]
    assert s["peak_day"]["date"] >= "2026-07-01"


def test_summary_yoy_unavailable_at_start(client):
    s = get(client, "/summary", region="ARG", start="2000-11-01", end="2001-03-31")
    assert s["yoy"]["available"] is False and s["yoy"]["reason"]
    assert s["reliability_share"]["low"] > 0.9


# -- caídas de satélites y conteo original de la NASA -------------------------
def test_outages_periods(client):
    o = get(client, "/outages", region="ARG")
    terra_2001 = [p for p in o["periods"] if p["satellite"] == "Terra" and p["start"] == "2001-06-15"]
    assert terra_2001 and terra_2001[0]["end"] == "2001-07-02" and terra_2001[0]["days"] == 18
    assert terra_2001[0]["kind"] == "full"                 # época solo Terra: nadie observó
    assert "2001-06-20" in o["no_data_days"]
    assert sum(p["days"] for p in o["periods"]) == o["satellite_days"]
    assert any(p["kind"] == "partial" for p in o["periods"])
    for p in o["periods"]:
        assert p["start"] <= p["end"]


def test_daily_points_carry_nasa_count_and_satellites_down(client):
    pts = get(client, "/timeseries", region="ARG", granularity="daily", start="2001-06-13", end="2001-06-16")["points"]
    by = {p["date"]: p for p in pts}
    assert by["2001-06-15"]["satellites_down"] == ["Terra"] and by["2001-06-15"]["nasa_detections"] is None
    assert by["2001-06-13"]["satellites_down"] == [] and by["2001-06-13"]["nasa_detections"] > 0
    # el conteo de la NASA (píxeles, todas las confianzas) nunca es menor que los eventos celda-día
    assert by["2001-06-13"]["nasa_detections"] >= by["2001-06-13"]["events_observed"]


def test_nasa_count_consistent_daily_monthly_summary(client):
    kw = dict(region="URY", start="2001-01-01", end="2001-12-31")
    d = get(client, "/timeseries", granularity="daily", **kw)["points"]
    m = get(client, "/timeseries", granularity="monthly", **kw)["points"]
    s = get(client, "/summary", **kw)
    total = sum(p["nasa_detections"] or 0 for p in d)
    assert total == sum(p["nasa_detections"] or 0 for p in m) == s["total_nasa_detections"] > 0
    assert all("days_with_satellite_down" in p for p in m)
    # con bbox que cubre la región, mismo conteo
    boxed = get(client, "/timeseries", granularity="daily", bbox="-60,-36,-52,-29", **kw)["points"]
    assert sum(p["nasa_detections"] or 0 for p in boxed) == total


# -- contrato, errores, caché, seguridad --------------------------------------
@pytest.mark.parametrize("path,params", [
    ("/timeseries", dict(region="ARG", granularity="monthly")),
    ("/timeseries", dict(region="ARG", granularity="daily", start="2025-01-01", end="2025-01-31", bbox="-65,-35,-60,-30")),
    ("/spatial/cells", dict(region="ARG", start="2025-01-01", end="2025-12-31", zoom=6)),
    ("/summary", dict(region="ARG")),
])
def test_no_sensor_fields_exposed(client, path, params):
    assert not SENSOR_KEYS & set(all_keys(get(client, path, **params)))


@pytest.mark.parametrize("params,status,code", [
    (dict(region="XXX"), 404, "region_not_found"),
    (dict(region="ARG", bbox="1,2"), 422, "invalid_bbox"),
    (dict(region="ARG", bbox="-60,-20,-55,-30"), 422, "invalid_bbox"),
    (dict(region="ARG", start="2020-02-01", end="2020-01-01"), 422, "invalid_range"),
    (dict(region="ARG", start="1990-01-01", end="1995-01-01"), 422, "range_out_of_period"),
    (dict(region="ARG", granularity="weekly"), 422, "invalid_request"),
    (dict(region="ARG", res=4, _path="/spatial/cells"), 422, "invalid_res"),
])
def test_errors(client, params, status, code):
    path = params.pop("_path", "/timeseries")
    r = client.get(API + path, params=params)
    assert r.status_code == status
    assert r.json()["error"]["code"] == code


def test_etag_304(client):
    r = client.get(API + "/summary", params=dict(region="ARG"))
    etag = r.headers["etag"]
    r2 = client.get(API + "/summary", params=dict(region="ARG"), headers={"If-None-Match": etag})
    assert r2.status_code == 304


def test_cors(client):
    r = client.get(API + "/health", headers={"Origin": "http://localhost:5173"})
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_db_is_read_only(client):
    db = client.app.state.registry.db
    root = get_settings().data_root
    for sql in (
        f"COPY (SELECT 1) TO '{root}/hack.parquet'",
        "CREATE TABLE t (a INT)",
        "SELECT 1; COPY (SELECT 1) TO 'x.csv'",
    ):
        with pytest.raises(Exception):
            db.query(sql)
    with pytest.raises(Exception):  # fuera de DATA_ROOT
        db.query("SELECT * FROM read_csv('/etc/passwd')")
    assert not (root / "hack.parquet").exists()


def test_latency(client):
    cases = [
        ("/regions", {}),
        ("/timeseries", dict(region="ARG", granularity="monthly")),
        ("/timeseries", dict(region="ARG", granularity="daily", bbox="-65,-35,-55,-25")),
        ("/spatial/cells", dict(region="ARG", zoom=6)),
        ("/spatial/cells", dict(region="ARG", start="2020-08-01", end="2020-08-31", zoom=10, bbox="-60,-28,-58,-26")),
        ("/summary", dict(region="ARG", bbox="-65,-35,-55,-25")),
    ]
    for path, params in cases:
        t0 = time.perf_counter()
        get(client, path, **params)
        assert (time.perf_counter() - t0) < 1.0, path
