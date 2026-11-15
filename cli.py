"""CLI del pipeline de armonización MODIS + VIIRS.

Uso:
    .venv/bin/python cli.py run --region ARG
    .venv/bin/python cli.py run --region CHL --no-api
    .venv/bin/python cli.py export-web --region ARG
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

from firms_harmonize.config import load_pipeline  # noqa: E402
from firms_harmonize.export_web import export_web  # noqa: E402
from firms_harmonize.pipeline import run  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="Ejecuta el pipeline completo para una región")
    r.add_argument("--region", required=True, help="ISO3 (p.ej. ARG) o región de config/regions.yaml")
    r.add_argument("--no-api", action="store_true", help="No consultar la API FIRMS para huecos")
    r.add_argument("--no-hash", action="store_true", help="No calcular sha256 de los archivos fuente")
    r.add_argument("--threads", type=int, default=8)
    r.add_argument("--no-web", action="store_true", help="No exportar a Datos_Para_La_Web")
    w = sub.add_parser("export-web", help="Solo re-exporta Datos_Para_La_Web/<REGIÓN> desde data/processed")
    w.add_argument("--region", required=True)
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    if a.cmd == "run":
        summary = run(a.region, use_api=not a.no_api, hash_sources=not a.no_hash, threads=a.threads)
        print(json.dumps(summary, indent=2, ensure_ascii=False, default=str))
    if a.cmd == "export-web" or not a.no_web:
        m = export_web(load_pipeline(), a.region.upper())
        print(json.dumps({k: m[k] for k in ("region", "calibration_version", "sp_nrt_cut", "layers")},
                         indent=2, ensure_ascii=False, default=str))


if __name__ == "__main__":
    main()
