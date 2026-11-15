"""Informe legible (Markdown) de una corrida: linaje + calibración."""
from __future__ import annotations

from pathlib import Path


def _fmt(n) -> str:
    return f"{n:,}".replace(",", ".") if isinstance(n, int) else str(n)


def write_markdown_report(path: Path, summary: dict, cal: dict) -> None:
    L = [f"# Informe de armonización — región {summary['region']}", "",
         f"- Periodo: {summary['period'][0]} → {summary['period'][1]}",
         f"- Archivos fuente: {summary['n_source_files']} (no reconocidos: {len(summary['unrecognized_csv'])})",
         f"- Detecciones conservadas: {_fmt(summary['n_detections_kept'])}",
         f"- Eventos celda H3 × día: {_fmt(summary['n_events'])} "
         f"(en la serie, confianza ≥ {cal['series_min_confidence']}: {_fmt(summary['n_events_in_series'])})",
         f"- Celdas de fuente fija (SP+NRT): {_fmt(summary['n_static_source_cells'])}",
         f"- Caídas de satélite detectadas: {_fmt(summary['n_satellite_outage_days'])} satélite-día; "
         f"días sin ningún satélite (sin dato): {_fmt(summary['n_days_without_any_satellite'])}", "",
         "## Descartes", "", "| Motivo | Registros |", "|---|---:|"]
    L += [f"| {k} | {_fmt(v)} |" for k, v in sorted(summary["rejections"].items(), key=lambda kv: -kv[1])]
    L += ["", "## Épocas (constelación activa)", "", "| Constelación | Inicio | Fin | Días |", "|---|---|---|---:|"]
    L += [f"| {e['epoch_id']} | {e['start']} | {e['end']} | {e['n_days']} |" for e in cal["epochs"]]
    MES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
    sm = cal.get("smoothing", {})
    L += ["", f"## Calibración — referencia: `{cal['reference_constellation']}`", "",
          f"- Alcance del factor: **{cal.get('factor_scope')}**; suavizado: **{sm.get('method')}** "
          f"(armónicos={sm.get('harmonics')}, ventana={sm.get('window')}), circular, escala log, ponderado por eventos.",
          "- r = eventos(destino) / eventos(origen), simulando ambas constelaciones sobre los mismos días.", "",
          "| Origen → Destino | r total | Ventana | Meses |", "|---|---:|---|---:|"]
    for e in cal["edges"]:
        L.append(f"| {e['from']} → {e['to']} | {e['ratio_total']:.3f} | {e['window_start']} → {e['window_end']} | {e['n_months']} |")
    L += ["", "### Validación cruzada temporal (ajuste en 1ª mitad de la ventana → predicción mensual de la 2ª)", "",
          "MAPE = error % medio por mes; WAPE = Σ|error| / Σ observado; Sesgo = error del total.", ""]
    methods = list(cal["edges"][0]["cross_validation"].keys())
    L += ["| Origen → Destino | " + " | ".join(methods) + " |", "|---|" + "---:|" * len(methods)]
    for e in cal["edges"]:
        cells = []
        for mth in methods:
            c = e["cross_validation"].get(mth)
            cells.append("—" if not c else f"MAPE {c['monthly_mape_pct']}% · WAPE {c['monthly_wape_pct']}% · sesgo {c['total_bias_pct']}%")
        L.append(f"| {e['from']} → {e['to']} | " + " | ".join(cells) + " |")
    L += ["", f"Método aplicado: `{cal['edges'][0]['selected_method']}`.", "",
          "### Cociente por mes del año (crudo → ajustado)", "",
          "| Origen → Destino | " + " | ".join(MES) + " |", "|---|" + "---:|" * 12]
    for e in cal["edges"]:
        L.append(f"| {e['from']} → {e['to']} | " + " | ".join(
            f"{m['ratio_raw'] if m['ratio_raw'] is not None else '—'} → {m['ratio_fitted']}" for m in e["month_of_year"]) + " |")
    L += ["", "### Estabilidad anual del cociente", ""]
    for e in cal["edges"]:
        yr = ", ".join(f"{y['year']}: {y['ratio']}" for y in e["yearly"] if y["ratio"] is not None)
        L.append(f"- **{e['from']} → {e['to']}**: {yr}")
    L += ["", "## Factores K por mes del año (multiplican los eventos observados; IC 95% entre paréntesis)", "",
          "| Constelación | " + " | ".join(MES) + " |", "|---|" + "---:|" * 12]
    by_ep: dict = {}
    for f in cal["factors"]:
        by_ep.setdefault(f["epoch_id"], {})[f["month_of_year"]] = f
    for epn, fm in by_ep.items():
        L.append(f"| {epn} | " + " | ".join(
            f"{fm[k]['k_factor']:.2f} ({fm[k]['k_ci_low']:.2f}–{fm[k]['k_ci_high']:.2f})" for k in range(1, 13)) + " |")
    api = summary.get("api") or {}
    L += ["", "## API FIRMS", "",
          f"- Bloques descargados: {len(api.get('downloaded', []) or [])}",
          f"- Sin datos en la fuente: {api.get('unavailable_at_source') or '—'}",
          f"- Omitida: {api.get('skipped') or 'no'}", ""]
    path.write_text("\n".join(L), encoding="utf-8")
