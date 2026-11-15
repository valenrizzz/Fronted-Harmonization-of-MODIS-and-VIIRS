"""Cliente FIRMS (API de área): rellena SOLO los huecos que no cubren los archivos locales.

Cada bloque descargado se guarda tal cual en data/raw/firms_api/<REGION>/<PRODUCTO>/<ini>_<fin>.csv
(incluso si viene vacío: el archivo prueba que esa ventana fue consultada).
"""
from __future__ import annotations

import io
import logging
import time
from datetime import date, timedelta
from pathlib import Path

import requests

from .config import PipelineCfg

log = logging.getLogger(__name__)


def _get(url: str, cfg: PipelineCfg) -> str:
    last = None
    for attempt in range(cfg.api.max_retries):
        try:
            r = requests.get(url, timeout=cfg.api.timeout_s)
            if r.status_code == 200 and not r.text.lstrip().lower().startswith(("invalid", "error")):
                return r.text
            last = f"HTTP {r.status_code}: {r.text[:200]}"
        except requests.RequestException as e:
            last = str(e)
        time.sleep(2 ** attempt)
    raise RuntimeError(f"FIRMS API falló tras {cfg.api.max_retries} intentos: {last}")


def availability(cfg: PipelineCfg, key: str) -> dict[str, tuple[date, date]]:
    txt = _get(f"{cfg.api.availability_url}/{key}/all", cfg)
    out = {}
    for line in io.StringIO(txt).read().splitlines()[1:]:
        pid, a, b = line.split(",")[:3]
        out[pid] = (date.fromisoformat(a), date.fromisoformat(b))
    return out


def _subtract(span: tuple[date, date], covered: list[tuple[date, date]]) -> list[tuple[date, date]]:
    gaps, cur = [], span[0]
    for s, e in sorted(covered):
        if e < cur:
            continue
        if s > span[1]:
            break
        if s > cur:
            gaps.append((cur, s - timedelta(days=1)))
        cur = max(cur, e + timedelta(days=1))
    if cur <= span[1]:
        gaps.append((cur, span[1]))
    return gaps


def fill_gaps(cfg: PipelineCfg, region_code: str, bbox_str: str,
              cov: dict[tuple[str, str], list[tuple[date, date]]], api_dir: Path) -> dict:
    """Descarga lo que falte. Devuelve un reporte (descargado / no disponible en la fuente)."""
    report: dict = {"downloaded": [], "unavailable_at_source": [], "skipped": None}
    key = cfg.api.map_key()
    if not cfg.api.enabled or not key:
        report["skipped"] = "API deshabilitada o sin MAP_KEY"
        return report
    avail = availability(cfg, key)
    end = cfg.period.resolved_end
    for family, sats in cfg.products.items():
        start = max(cfg.period.start, min(cfg.satellites[s].start for s in sats))
        covered = cov.get((family, "SP"), []) + cov.get((family, "NRT"), [])
        for g0, g1 in _subtract((start, end), covered):
            for level in ("sp", "nrt"):
                pid = cfg.api.products[family][level]
                a0, a1 = avail.get(pid, (None, None))
                if a0 is None:
                    continue
                s, e = max(g0, a0), min(g1, a1)
                sp_av = avail.get(cfg.api.products[family]["sp"])
                if level == "nrt" and sp_av:          # NRT solo donde no hay SP
                    s = max(s, sp_av[1] + timedelta(days=1))
                d = s
                while d <= e:
                    d_end = min(d + timedelta(days=cfg.api.day_range - 1), e)
                    out = api_dir / region_code / pid / f"{d}_{d_end}.csv"
                    if not out.exists():
                        n = (d_end - d).days + 1
                        txt = _get(f"{cfg.api.area_url}/{key}/{pid}/{bbox_str}/{n}/{d}", cfg)
                        out.parent.mkdir(parents=True, exist_ok=True)
                        out.write_text(txt)
                        report["downloaded"].append({"product": pid, "start": str(d), "end": str(d_end),
                                                     "rows": max(txt.count("\n") - 1, 0)})
                    d = d_end + timedelta(days=1)
            # lo que siga sin cubrir tras SP+NRT no existe (todavía) en FIRMS
            src = [avail[p] for p in cfg.api.products[family].values() if p in avail]
            for u0, u1 in _subtract((g0, g1), src):
                report["unavailable_at_source"].append({"family": family, "start": str(u0), "end": str(u1)})
    return report
