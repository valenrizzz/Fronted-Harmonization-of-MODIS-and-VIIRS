"""Auditoría QA de SOLO LECTURA del almacén web de una región.

No importa nada del pipeline: lee Parquet con DuckDB/Polars y contrasta contra fuentes
independientes (polígono Natural Earth, detecciones crudas de data/interim).

Uso:  .venv/bin/python audits/audit_web_store.py ARG
"""
from __future__ import annotations

import json
import math
import sys
from datetime import date, timedelta
from pathlib import Path

import duckdb
import h3
import numpy as np
import polars as pl
import shapely
from shapely.geometry import shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
R = sys.argv[1] if len(sys.argv) > 1 else "ARG"
W = ROOT / "Datos_Para_La_Web" / R
PROC = ROOT / "data" / "processed" / R
DET = ROOT / "data" / "interim" / R / "detections.parquet"
NE = ROOT / "data" / "reference" / "ne_10m_admin_0_countries_v5.1.2.geojson"

con = duckdb.connect()
con.execute(f"CREATE VIEW ev AS SELECT * FROM read_parquet('{W}/events/*/*/*.parquet', hive_partitioning=true)")
con.execute(f"CREATE VIEW td AS SELECT * FROM '{W}/timeseries_daily.parquet'")
con.execute(f"CREATE VIEW tm AS SELECT * FROM '{W}/timeseries_monthly.parquet'")
con.execute(f"CREATE VIEW cf AS SELECT * FROM '{W}/calibration_factors.parquet'")
con.execute(f"CREATE VIEW cfd AS SELECT * FROM '{W}/calibration_factors_daily.parquet'")
con.execute(f"CREATE VIEW det AS SELECT * FROM '{DET}'")
man = json.loads((W / "manifest.json").read_text())
CUT = date.fromisoformat(man["sp_nrt_cut"].get("sp_cutoff_solar_day") or man["sp_nrt_cut"]["sp_cutoff"])
results: list[tuple[str, str, str, str]] = []   # (eje, chequeo, estado, evidencia)


def q(sql):
    return con.execute(sql).fetchall()


def q1(sql):
    return con.execute(sql).fetchall()[0]


def add(axis, name, status, ev):
    results.append((axis, name, status, ev))


def section(t):
    print(f"\n{'=' * 100}\n{t}\n{'=' * 100}")


# ============================================================================ 1. ESQUEMA Y NULOS
section("1. INTEGRIDAD DE ESQUEMA Y NULOS")
n_ev = q1("SELECT count(*) FROM ev")[0]
cols = [r[0] for r in q("DESCRIBE ev")]
types = {r[0]: r[1] for r in q("DESCRIBE ev")}
nulls = {c: q1(f'SELECT count(*) FROM ev WHERE "{c}" IS NULL' + (" AND frp_quality <> 'missing'" if c in ("frp_max", "frp_mean") else ""))[0] for c in cols}
nonzero_nulls = {c: n for c, n in nulls.items() if n}
frp_null_ok = q1("SELECT count(*) FROM ev WHERE frp_max IS NULL")[0]
print("filas eventos:", n_ev, "| columnas con nulos:", nonzero_nulls or "ninguna")
add("1", "Nulos en eventos", "PASS" if not nonzero_nulls else "FAIL",
    f"{len(cols)} columnas, nulos no justificados={nonzero_nulls or 0}; FRP nulo con frp_quality='missing': {frp_null_ok}")

floats = [c for c, t in types.items() if t in ("DOUBLE", "FLOAT")]
nan_inf = {c: q1(f'SELECT count(*) FROM ev WHERE isnan("{c}") OR isinf("{c}")')[0] for c in floats}
bad = {c: n for c, n in nan_inf.items() if n}
add("1", "NaN/inf en columnas float", "PASS" if not bad else "FAIL", f"{floats} -> {bad or 0}")

w = q1("""SELECT count(*) FILTER (WHERE harmonized_weight < 0), count(*) FILTER (WHERE harmonized_weight = 0),
          count(*) FILTER (WHERE harmonized_weight = 0 AND in_series), count(*) FILTER (WHERE harmonized_weight > 0 AND NOT in_series),
          count(*) FILTER (WHERE NOT in_series), min(harmonized_weight) FILTER (WHERE in_series), max(harmonized_weight),
          count(*) FILTER (WHERE weight_ci_low > harmonized_weight OR weight_ci_high < harmonized_weight)
          FROM ev""")
print("pesos: <0=%d, =0=%d, =0&in_series=%d, >0&!in_series=%d, !in_series=%d, min(in_series)=%.4f, max=%.4f, peso fuera de su IC=%d" % w)
add("1", "Pesos negativos / incoherentes", "PASS" if w[0] == 0 and w[2] == 0 and w[3] == 0 and w[7] == 0 else "FAIL",
    f"negativos={w[0]}, cero con in_series={w[2]}, >0 sin in_series={w[3]}, fuera de IC={w[7]}")
add("1", "Pesos = 0 (eventos solo confianza baja)", "WARN" if w[1] else "PASS",
    f"{w[1]:,} eventos ({w[1] / n_ev:.2%}) con peso 0 = exactamente los !in_series ({w[4]:,}); por diseño, pero la web debe saberlo")
add("1", "Rango de pesos", "WARN" if w[6] > 20 else "PASS", f"min={w[5]:.3f}, max={w[6]:.3f} (Terra may-jun)")

frp = q1("""SELECT min(frp_max), quantile_cont(frp_max, 0.5), quantile_cont(frp_max, 0.999), max(frp_max),
            count(*) FILTER (WHERE frp_max <= 0), count(*) FILTER (WHERE frp_max > 5000),
            count(*) FILTER (WHERE frp_mean > frp_max + 1e-3),
            count(*) FILTER (WHERE frp_max > 5000 AND frp_quality <> 'extreme'),
            count(*) FILTER (WHERE frp_quality NOT IN ('ok','partial','extreme','missing'))
            FROM ev""")
print("FRP max: min=%.2f p50=%.2f p99.9=%.1f max=%.1f | <=0: %d | >5000 MW: %d | mean>max: %d | >5000 sin flag: %d | flag inválido: %d" % frp)
fq = q("SELECT frp_quality, count(*) FROM ev GROUP BY 1 ORDER BY 2 DESC")
add("1", "FRP extremos/absurdos", "FAIL" if frp[4] or frp[6] or frp[7] or frp[8] else "PASS",
    f"min={frp[0]:.2f}, p99.9={frp[2]:.0f}, max={frp[3]:.0f} MW; ≤0: {frp[4]}; >5000 MW: {frp[5]} (sin marcar 'extreme': {frp[7]}); "
    f"mean>max: {frp[6]}; frp_quality: {fq}")
top_frp = q("SELECT solar_date, h3_index, cell_lat, cell_lon, frp_max, n_raw_detections, satellites FROM ev ORDER BY frp_max DESC LIMIT 5")
print("top FRP:", *top_frp, sep="\n  ")

coords = q1("""SELECT min(cell_lat), max(cell_lat), min(cell_lon), max(cell_lon), min(solar_date), max(solar_date),
               count(*) FILTER (WHERE year(solar_date) <> year), count(*) FILTER (WHERE month(solar_date) <> month_of_year),
               count(*) FILTER (WHERE last_detection_utc < first_detection_utc),
               count(*) FILTER (WHERE abs(datediff('day', CAST(first_detection_utc AS DATE), solar_date)) > 1)
               FROM ev""")
print("coords/fechas:", coords)
add("1", "Coordenadas y fechas en rango", "PASS" if coords[6] == coords[7] == coords[8] == coords[9] == 0 and
    -56 < coords[0] and coords[1] < -21 and -74 < coords[2] and coords[3] < -53 else "FAIL",
    f"lat [{coords[0]:.3f},{coords[1]:.3f}] lon [{coords[2]:.3f},{coords[3]:.3f}] fechas {coords[4]}→{coords[5]}; "
    f"partición year≠fecha: {coords[6]}, month_of_year≠fecha: {coords[7]}, last<first: {coords[8]}, |utc−solar|>1d: {coords[9]}")

trace = q1(f"""SELECT count(DISTINCT calibration_version), any_value(calibration_version),
               count(*) FILTER (WHERE reliability_tier NOT IN ('high','medium','low')),
               count(*) FILTER (WHERE layer NOT IN ('SP','NRT')),
               count(*) FILTER (WHERE layer='SP' AND solar_date > DATE '{CUT}'),
               count(*) FILTER (WHERE layer='NRT' AND solar_date <= DATE '{CUT}'),
               count(*) FILTER (WHERE layer='SP' AND is_provisional),
               count(*) FILTER (WHERE layer='NRT' AND NOT is_provisional)
               FROM ev""")
print("trazabilidad:", trace)
add("1", "Trazabilidad (versión, calidad, capa)", "PASS" if trace[0] == 1 and trace[2:6] == (0, 0, 0, 0) and trace[6] == 0 else "FAIL",
    f"versiones={trace[0]} ({trace[1]}), calidad inválida={trace[2]}, capa inválida={trace[3]}, SP>corte={trace[4]}, NRT≤corte={trace[5]}, SP provisorio={trace[6]}")
add("1", "Columna de confiabilidad `reliability_tier`", "PASS" if "reliability_tier" in cols else "FAIL",
    f"presente={'reliability_tier' in cols}; valores={q('SELECT reliability_tier, count(*) FROM ev GROUP BY 1 ORDER BY 1')}")
if trace[7]:
    mix = q("SELECT satellites, count(*) FROM ev WHERE layer='NRT' AND NOT is_provisional GROUP BY 1 ORDER BY 2 DESC LIMIT 4")
    add("1", "Eventos NRT con detecciones SP", "WARN",
        f"{trace[7]:,} eventos en layer=NRT no son 100% provisorios (mezclan MODIS SP de ago-2026 + VIIRS NRT). Ej.: {mix}")

wk = q1("""SELECT count(*) FILTER (WHERE f.k_factor IS NULL OR abs(e.harmonized_weight - f.k_factor) > 1e-12)
           FROM ev e LEFT JOIN cfd f ON f.epoch_id = e.epoch_id AND f.doy = e.doy WHERE e.in_series""")[0]
add("1", "Peso == K(constelación, día del año) de la tabla diaria", "PASS" if wk == 0 else "FAIL", f"discrepancias={wk}")

# ============================================================================ 2. ESPACIAL Y DEDUP
section("2. FUGAS ESPACIALES Y DEDUPLICACIÓN")
gj = json.loads(NE.read_text())
arg = unary_union([shape(f["geometry"]) for f in gj["features"] if f["properties"]["ADM0_A3"] == R])
land = unary_union([shape(f["geometry"]) for f in gj["features"]])
shapely.prepare(arg); shapely.prepare(land)
cells = pl.read_parquet(W / "h3_region_map.parquet")
lon, lat = cells["cell_lon"].to_numpy(), cells["cell_lat"].to_numpy()
in_arg = shapely.intersects_xy(arg, lon, lat)
in_land = shapely.intersects_xy(land, lon, lat)
out = cells.filter(~pl.Series(in_arg))
ocean = cells.filter(~pl.Series(in_land))
# distancia (km aprox.) de los centroides fuera del polígono al borde
pts = shapely.points(out["cell_lon"].to_numpy(), out["cell_lat"].to_numpy())
dist_km = shapely.distance(arg.boundary, pts) * 111.0 if len(out) else np.array([0.0])
n_out_ev = q1(f"SELECT count(*) FROM ev WHERE h3_cell IN (SELECT unnest({out['h3_cell'].to_list() or [0]}))")[0]
print(f"celdas: {cells.height:,} | centroide fuera de ARG: {out.height:,} (eventos {n_out_ev:,}) | centroide en mar: {ocean.height:,} "
      f"| distancia al borde de los de afuera: p50={np.median(dist_km):.2f} km, max={dist_km.max():.2f} km")
# detecciones crudas: deben estar TODAS dentro (el filtro se aplicó por punto)
dl = con.sql("SELECT lon, lat FROM det").fetchnumpy()
det_out = int((~shapely.intersects_xy(arg, dl["lon"], dl["lat"])).sum())
add("2", "Detecciones crudas fuera del polígono", "PASS" if det_out == 0 else "FAIL", f"{det_out} de {len(dl['lon']):,}")
add("2", "Centroides de celda fuera del polígono", "WARN" if out.height else "PASS",
    f"{out.height:,} celdas ({out.height / cells.height:.2%}), {n_out_ev:,} eventos; detección adentro pero centroide H3 afuera "
    f"(borde/costa). Distancia p50={np.median(dist_km):.2f} km, max={dist_km.max():.2f} km; {ocean.height:,} centroides sobre el mar")

dup = q1("SELECT count(*) - count(DISTINCT (h3_cell, solar_date)) FROM ev")[0]
dup_layers = q1("SELECT count(*) FROM (SELECT h3_cell, solar_date FROM ev GROUP BY ALL HAVING count(DISTINCT layer) > 1)")[0]
add("2", "Unicidad celda H3 × día", "PASS" if dup == 0 and dup_layers == 0 else "FAIL",
    f"duplicados={dup}, celda-día en ambas capas={dup_layers}")
cross = q1("""SELECT count(*) FROM (SELECT DISTINCT h3_cell, solar_date FROM ev) e""")[0]
proc_n = q1(f"SELECT count(*), sum(harmonized_weight) FROM '{PROC}/events_daily.parquet'")
web_s = q1("SELECT sum(harmonized_weight) FROM ev")[0]
add("2", "Web == data/processed", "PASS" if proc_n[0] == n_ev and abs(proc_n[1] - web_s) <= 1e-12 * abs(web_s) else "FAIL",
    f"filas {n_ev:,} vs {proc_n[0]:,}; Σpeso {web_s:.6f} vs {proc_n[1]:.6f} (dif. relativa {abs(proc_n[1] - web_s) / web_s:.1e}, orden de suma)")

rec = con.sql("""
    SELECT h3_index, h3_cell, any_value(cell_lat) lat, any_value(cell_lon) lon, year, count(*) AS "days"
    FROM ev GROUP BY h3_index, h3_cell, year""").pl()
over150 = rec.filter(pl.col("days") > 150)
over100 = rec.filter(pl.col("days") > 100)
over60 = rec.filter(pl.col("days") > 60)
print(f"celda-año >150 días: {over150.height} | >100: {over100.height} | >60: {over60.height} | máx: {rec['days'].max()}")
top = (rec.group_by("h3_index", "h3_cell", "lat", "lon")
       .agg(pl.col("days").sum().alias("dias_total"), pl.col("days").max().alias("max_dias_año"),
            pl.col("year").n_unique().alias("años_activos"))
       .sort("dias_total", descending=True).head(5))
# caracterización de las top con las detecciones crudas (día/noche, FRP, satélites)
tops = []
for r in top.iter_rows(named=True):
    d = q1(f"""SELECT count(*), avg(CASE WHEN daynight='N' THEN 1 ELSE 0 END), median(frp), count(DISTINCT satellite),
                      min(solar_date), max(solar_date)
               FROM det WHERE h3_cell = {r['h3_cell']}""")
    rej = q1(f"""SELECT count(*) FROM '{ROOT}/data/lineage/{R}/rejected_records.parquet'
                 WHERE reason LIKE 'type_%' AND lat BETWEEN {r['lat']} - 0.03 AND {r['lat']} + 0.03
                   AND lon BETWEEN {r['lon']} - 0.03 AND {r['lon']} + 0.03""")[0]
    tops.append({**r, "detecciones": d[0], "frac_noche": round(d[1], 3), "frp_mediana": round(d[2], 2),
                 "satélites": d[3], "desde": str(d[4]), "hasta": str(d[5]), "rechazos_type_≈3km": rej})
TOP5 = tops
add("2", "Celdas >150 días/año (posible fuente fija)", "PASS" if over150.height == 0 else "FAIL",
    f"{over150.height} celda-año; máx días/año={rec['days'].max()}; >100 d: {over100.height}; >60 d: {over60.height}")
if over60.height:
    add("2", "Recurrencia alta (>60 días/año)", "WARN",
        f"{over60['h3_index'].n_unique()} celdas distintas con algún año >60 días; ver top 5")

# ============================================================================ 3. FRONTERAS
section("3. CONTINUIDAD EN TRANSICIONES DE CONSTELACIÓN Y CORTE SP/NRT")
ts = con.sql("SELECT * FROM td ORDER BY date").pl()
eps = (ts.with_columns((pl.col("epoch_id") != pl.col("epoch_id").shift()).fill_null(True).cum_sum().alias("b"))
       .group_by("b", maintain_order=True).agg(pl.col("epoch_id").first(), pl.col("date").min().alias("start")))
H = dict(zip(ts["date"].to_list(), ts["events_harmonized"].to_list()))
O = dict(zip(ts["date"].to_list(), ts["events_observed"].to_list()))
dates = ts["date"].to_list()
years = sorted({d.year for d in dates})


def window_mean(series, center, a, b):
    vals = [series.get(center + timedelta(days=k)) for k in range(a, b)]
    vals = [v for v in vals if v is not None]
    return float(np.mean(vals)) if vals else float("nan")


trans_rows = []
prev_ep = None
for r in eps.iter_rows(named=True):
    t = r["start"]
    skip = t == dates[0] or r["epoch_id"] == "none" or prev_ep == "none"
    prev_ep = r["epoch_id"]
    if skip:   # fronteras con días sin dato: la ventana mezcla nulos, el test no aplica
        continue
    N = 28 if r["epoch_id"] != "Terra+Aqua+NOAA20+NOAA21" else 12
    hb, ha = window_mean(H, t, -N, 0), window_mean(H, t, 0, N)
    ob, oa = window_mean(O, t, -N, 0), window_mean(O, t, 0, N)
    # referencia estacional: mismo cociente después/antes en los mismos días del calendario de otros años
    ref = []
    for y in years:
        if y == t.year:
            continue
        try:
            c = t.replace(year=y)
        except ValueError:
            continue
        b_, a_ = window_mean(H, c, -N, 0), window_mean(H, c, 0, N)
        if b_ > 0 and a_ > 0 and not math.isnan(a_ + b_):
            ref.append(math.log(a_ / b_))
    ref = np.array(ref)
    lr_h, lr_o = math.log(ha / hb), math.log(oa / ob)
    z = (lr_h - ref.mean()) / ref.std(ddof=1)
    pct = float((ref < lr_h).mean() * 100)
    trans_rows.append({"transición": f"{t} → {r['epoch_id']}", "ventana_d": N,
                       "obs_después/antes": round(oa / ob, 3), "arm_después/antes": round(ha / hb, 3),
                       "esperado_estacional(med)": round(float(np.exp(np.median(ref))), 3),
                       "z": round(z, 2), "percentil": round(pct, 1)})
n_st = {"PASS": 0, "WARN": 0, "FAIL": 0}
for tr in trans_rows:
    print(tr)
    st = "FAIL" if abs(tr["z"]) > 2.5 else "WARN" if abs(tr["z"]) > 1.5 else "PASS"
    n_st[st] += 1
    if st != "PASS":   # informativo: un año atípico no es un error de calibración
        add("3", f"Salto estacional en {tr['transición']} (informativo, z={'alto' if st == 'FAIL' else 'medio'})", "WARN",
            f"obs ×{tr['obs_después/antes']}, armonizado ×{tr['arm_después/antes']} vs esperado estacional ×{tr['esperado_estacional(med)']} "
            f"(z={tr['z']}, percentil {tr['percentil']} de {len(years) - 1} años)")
add("3", "Transiciones: salto vs estacionalidad de otros años (informativo)", "PASS" if n_st["FAIL"] == 0 else "WARN",
    f"{len(trans_rows)} transiciones: {n_st}. No separa error de calibración de un año atípico; ver test de consistencia local")

# --- Test de consistencia LOCAL en cada transición (mide el salto artificial directamente) ---
# En los días donde la constelación grande está activa se puede simular la chica quitando satélites.
# Si la calibración es correcta localmente: Σ eventos_grande·K_grande ≈ Σ eventos_chica·K_chica.
evs = con.sql("SELECT solar_date, sat_mask_series FROM ev WHERE in_series").pl()
kd = {(r[0], r[1]): r[2] for r in q("SELECT active_mask, doy, k_factor FROM cfd")}
amask = dict(zip(ts["date"].to_list(), ts["active_mask"].to_list()))
seqm = ts.select("date", "active_mask").with_columns(
    (pl.col("active_mask") != pl.col("active_mask").shift()).fill_null(True).alias("chg")).filter("chg")
loc_rows = []
prev = None
for d0, m, _chg in seqm.iter_rows():
    if prev is None or m == 0 or prev == 0:
        prev = m
        continue
    a, b = prev, m
    prev = m
    sides = []
    if a & b == a:
        sides = [(b, a, d0, 1)]
    elif a & b == b:
        sides = [(a, b, d0, -1)]
    elif (a & b) and any(k[0] == (a & b) for k in kd):
        sides = [(b, a & b, d0, 1), (a, a & b, d0, -1)]
    for sup, sub, t, direction in sides:
        rng = [t + timedelta(days=k) for k in (range(0, 90) if direction > 0 else range(-90, 0))]
        days = [d for d in rng if amask.get(d) == sup]
        if len(days) < 10 or (sub, 1) not in kd:
            continue
        sub_ev = evs.filter(pl.col("solar_date").is_in(days))
        g = (sub_ev.group_by("solar_date").agg(((pl.col("sat_mask_series") & sup) != 0).sum().alias("cs"),
                                               ((pl.col("sat_mask_series") & sub) != 0).sum().alias("cb")))
        hs = sum(r[1] * kd[(sup, r[0].timetuple().tm_yday)] for r in g.iter_rows())
        hb = sum(r[2] * kd[(sub, r[0].timetuple().tm_yday)] for r in g.iter_rows())
        if hb < 50:
            continue
        loc_rows.append({"fecha": str(t), "grande": sup, "chica": sub, "dias": len(days), "R": round(hs / hb, 4)})
devs = np.array([abs(r["R"] - 1) for r in loc_rows])
robust = [r for r in loc_rows if r["dias"] >= 60]          # ventanas cortas (caídas breves) = ruido
dev_r = np.array([abs(r["R"] - 1) for r in robust]) if robust else np.array([0.0])
worst = sorted(loc_rows, key=lambda r: -abs(r["R"] - 1))[:5]
st_loc = "PASS" if dev_r.max() <= 0.10 else ("WARN" if dev_r.max() <= 0.20 else "FAIL")
add("3", "Transiciones: salto artificial local a 90 días (armonizado grande vs chica simulada)", st_loc,
    f"{len(loc_rows)} transiciones evaluables ({len(robust)} con ventana ≥60 d, máx |R−1|={dev_r.max():.3f}); "
    f"todas: |R−1| mediana={np.median(devs):.3f}, p90={np.quantile(devs, 0.9):.3f}, "
    f"máx={devs.max():.3f}; >10%: {(devs > 0.10).sum()}, >20%: {(devs > 0.20).sum()}; peores: "
    + "; ".join(f"{r['fecha']} R={r['R']} ({r['dias']}d)" for r in worst))
LOCAL = loc_rows

# discontinuidad del factor en los cambios de mes (factor mensual escalonado)
kj = (ts.select("date", "epoch_id", "k_factor")
      .with_columns(pl.col("k_factor").shift().alias("k_prev"), pl.col("epoch_id").shift().alias("ep_prev"))
      .filter((pl.col("epoch_id") == pl.col("ep_prev")) & (pl.col("date").dt.day() == 1) & pl.col("k_factor").is_not_null() & pl.col("k_prev").is_not_null())
      .with_columns((pl.col("k_factor") / pl.col("k_prev")).alias("salto"))
      .group_by("epoch_id").agg(pl.col("salto").max().alias("max"), pl.col("salto").min().alias("min"))
      .sort("max", descending=True))
print("saltos de K al cambiar de mes (misma época):\n", kj)
worst = kj.row(0, named=True)
add("3", "Escalón del factor K al cambiar de mes", "WARN" if worst["max"] > 1.15 or kj["min"].min() < 0.87 else "PASS",
    "; ".join(f"{r['epoch_id']}: ×{r['min']:.3f}…×{r['max']:.3f}" for r in kj.iter_rows(named=True)))

# satélites que aparecen en eventos fuera de su época
leak = q1("""SELECT count(*) FROM ev e JOIN (SELECT DISTINCT epoch_id, active_mask FROM td) t USING (epoch_id)
             WHERE (e.sat_mask & ~t.active_mask) <> 0""")[0]
add("3", "Satélite detectado fuera de su época", "PASS" if leak == 0 else "FAIL", f"{leak} eventos")
snpp_after = q1("SELECT count(*) FROM det WHERE satellite='SNPP' AND solar_date > DATE '2026-11-02'")[0]
add("3", "S-NPP ausente tras 2026-11-02", "PASS" if snpp_after == 0 else "FAIL", f"{snpp_after} detecciones S-NPP posteriores")

# caídas silenciosas: días donde un satélite activo tiene 0 detecciones mientras el resto detecta mucho
sat_bits = {"Terra": 1, "Aqua": 2, "SNPP": 4, "NOAA20": 8, "NOAA21": 16}
per = con.sql("SELECT solar_date d, satellite s, count(*) n FROM det GROUP BY ALL").pl()
piv = per.pivot(on="s", index="d", values="n").fill_null(0)
act = ts.select(pl.col("date").alias("d"), "active_mask")
piv = act.join(piv, on="d", how="left").fill_null(0)
outages = {}
for s, b in sat_bits.items():
    if s not in piv.columns:
        continue
    others = [c for c in sat_bits if c != s and c in piv.columns]
    sub = piv.filter(((pl.col("active_mask") & b) != 0) & (pl.col(s) == 0)
                     & (pl.sum_horizontal([pl.col(c) for c in others]) >= 200))
    outages[s] = (sub.height, [str(x) for x in sub["d"].head(5).to_list()])
print("posibles caídas (satélite activo con 0 detecciones y ≥200 del resto):", outages)
tot_out = sum(v[0] for v in outages.values())
add("3", "Caídas silenciosas de satélites", "WARN" if tot_out else "PASS",
    "; ".join(f"{s}: {n} días (ej. {ex[:3]})" for s, (n, ex) in outages.items() if n) or "ninguna")

# corte SP/NRT
sp_last, nrt_first = q1("SELECT max(solar_date) FILTER (WHERE layer='SP'), min(solar_date) FILTER (WHERE layer='NRT') FROM ev")
both = q1("SELECT count(*) FROM (SELECT date FROM td GROUP BY date HAVING count(*) > 1)")[0]
gaps = q1("SELECT count(*) FROM (SELECT date, lag(date) OVER (ORDER BY date) p FROM td) WHERE date - p <> 1")[0]
around = q(f"""SELECT date, layer, events_observed, round(events_harmonized,1) FROM td
               WHERE date BETWEEN DATE '{CUT}' - 3 AND DATE '{CUT}' + 3 ORDER BY date""")
print("alrededor del corte:", *around, sep="\n  ")
add("3", "Corte SP/NRT sin solape ni hueco", "PASS" if nrt_first == sp_last + timedelta(days=1) and both == 0 and gaps == 0 else "FAIL",
    f"último SP={sp_last}, primer NRT={nrt_first}, corte manifest={CUT}, días duplicados={both}, huecos de calendario={gaps}")
zero_days = q("""SELECT year(date) y, count(*) FROM td WHERE events_observed = 0 GROUP BY 1 HAVING count(*) > 0 ORDER BY 1""")
add("3", "Días con 0 eventos", "WARN" if zero_days else "PASS", f"por año: {zero_days}")
blocks = q("""WITH z AS (SELECT date FROM td WHERE events_observed = 0),
              g AS (SELECT date, date - CAST(row_number() OVER (ORDER BY date) AS INT) g FROM z)
              SELECT min(date), max(date), count(*) FROM g GROUP BY g HAVING count(*) >= 5 ORDER BY 1""")
unflag = q1("""SELECT count(*) FROM td WHERE events_observed = 0 AND observation_flag = 'ok'
               AND date IN (SELECT date FROM (SELECT date, count(*) OVER (PARTITION BY g) n FROM
                 (SELECT date, date - CAST(row_number() OVER (ORDER BY date) AS INT) g FROM td WHERE events_observed = 0)) WHERE n >= 3)""")[0]
add("3", "Bloques ≥5 días seguidos con 0 eventos", "FAIL" if unflag else ("WARN" if blocks else "PASS"),
    ("; ".join(f"{a}→{b} ({n} d)" for a, b, n in blocks) or "ninguno")
    + f" — días en rachas ≥3 sin marcar 'suspect_zero': {unflag}; nulos 'no_satellite': "
    + str(q1("SELECT count(*) FROM td WHERE observation_flag = 'no_satellite'")[0]))
nrt_vs = q1(f"""SELECT avg(events_harmonized) FILTER (WHERE date BETWEEN DATE '{CUT}' + 1 AND DATE '{CUT}' + 30),
                       avg(events_harmonized) FILTER (WHERE date BETWEEN DATE '{CUT}' - 29 AND DATE '{CUT}') FROM td""")
seas = []
for y in years:
    if y == CUT.year:
        continue
    a = window_mean(H, CUT.replace(year=y), 1, 31); b = window_mean(H, CUT.replace(year=y), -29, 1)
    if a > 0 and b > 0:
        seas.append(a / b)
ratio_cut = nrt_vs[0] / nrt_vs[1]
add("3", "Salto en el corte SP→NRT", "PASS" if min(seas) <= ratio_cut <= max(seas) else "WARN",
    f"30 d después/antes = ×{ratio_cut:.2f}; esperado estacional (mediana otros años) ×{np.median(seas):.2f} "
    f"[rango {min(seas):.2f}–{max(seas):.2f}]")

# ============================================================================ 4. COHERENCIA
section("4. COHERENCIA AGREGADA VS GRANULAR")
dd = q1("""WITH e AS (SELECT solar_date d, sum(harmonized_weight) w, count(*) FILTER (WHERE in_series) n, count(*) na,
                      sum(weight_ci_low) lo, sum(weight_ci_high) hi FROM ev GROUP BY 1)
           SELECT max(abs(coalesce(e.w,0) - t.events_harmonized)),
                  count(*) FILTER (WHERE coalesce(e.w,0) <> t.events_harmonized),
                  count(*) FILTER (WHERE coalesce(e.n,0) <> t.events_observed),
                  count(*) FILTER (WHERE coalesce(e.na,0) <> t.events_all_confidence),
                  max(abs(coalesce(e.lo,0) - t.events_harmonized_ci_low)), max(abs(coalesce(e.hi,0) - t.events_harmonized_ci_high)),
                  count(*)
           FROM td t LEFT JOIN e ON e.d = t.date""")
print("diario:", dd)
add("4", "Σ pesos (eventos) vs timeseries_daily", "PASS" if dd[0] < 1e-6 and dd[2] == 0 and dd[3] == 0 else "FAIL",
    f"{dd[6]} días; max |dif|={dd[0]:.3e}; días con dif ≠ 0 exacta: {dd[1]} (orden de suma en coma flotante); "
    f"conteo observado distinto: {dd[2]}; conteo todas las confianzas distinto: {dd[3]}; IC: max dif {max(dd[4], dd[5]):.2e}")
mm = q1("""WITH e AS (SELECT date_trunc('month', solar_date) m, sum(harmonized_weight) w, count(*) FILTER (WHERE in_series) n,
                      sum(weight_ci_low) lo, sum(weight_ci_high) hi FROM ev GROUP BY 1),
                d AS (SELECT month m, sum(events_harmonized) w FROM td GROUP BY 1)
           SELECT max(abs(coalesce(e.w,0) - t.events_harmonized)), max(abs(d.w - t.events_harmonized)),
                  count(*) FILTER (WHERE coalesce(e.n,0) <> t.events_observed),
                  max((coalesce(e.lo,0) - t.events_harmonized_ci_low) / nullif(t.events_harmonized,0)),
                  min((coalesce(e.hi,0) - t.events_harmonized_ci_high) / nullif(t.events_harmonized,0)),
                  count(*) FILTER (WHERE t.events_harmonized_ci_low > t.events_harmonized OR t.events_harmonized_ci_high < t.events_harmonized),
                  count(*)
           FROM tm t LEFT JOIN e ON e.m = t.month LEFT JOIN d ON d.m = t.month""")
print("mensual:", mm)
add("4", "Σ pesos (eventos) vs timeseries_monthly", "PASS" if mm[0] < 1e-6 and mm[1] < 1e-6 and mm[2] == 0 else "FAIL",
    f"{mm[6]} meses; max |dif| eventos={mm[0]:.3e}, diaria→mensual={mm[1]:.3e}; conteo distinto: {mm[2]}")
add("4", "IC mensual vs Σ IC de eventos", "WARN" if mm[3] > 1e-9 or mm[4] < -1e-9 else "PASS",
    f"no son aditivos por diseño: Σ weight_ci_low − ci_low_mensual hasta {mm[3]:+.2%} y Σ weight_ci_high − ci_high_mensual "
    f"hasta {mm[4]:+.2%} del total (Σ de cuantiles ≠ cuantil de la Σ); IC que no contiene la estimación: {mm[5]}")
tot = q1("SELECT (SELECT sum(harmonized_weight) FROM ev), (SELECT sum(events_harmonized) FROM td), (SELECT sum(events_harmonized) FROM tm)")
add("4", "Total histórico", "PASS" if abs(tot[0] - tot[1]) < 1e-4 and abs(tot[0] - tot[2]) < 1e-4 else "FAIL",
    f"eventos={tot[0]:.6f}, diaria={tot[1]:.6f}, mensual={tot[2]:.6f}")

# ============================================================================ TABLERO
section("TABLERO")
for axis in "1234":
    for a, n, s, e in results:
        if a == axis:
            print(f"[{s:4}] eje {a} | {n}: {e}")
section("TOP 5 CELDAS POR RECURRENCIA")
for t in TOP5:
    print(t)
out_json = ROOT / "audits" / f"audit_{R}.json"
out_json.write_text(json.dumps({"results": [dict(zip(("axis", "check", "status", "evidence"), r)) for r in results],
                                "top5": TOP5, "transitions": trans_rows, "transitions_local": LOCAL}, indent=2, default=str, ensure_ascii=False))
print("\nJSON:", out_json)
