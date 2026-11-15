"""Descubrimiento dinámico de regiones en DATA_ROOT a partir de sus manifest.json."""

from __future__ import annotations

import hashlib
import json
import logging
import re
import threading
import time
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from .db import ReadOnlyDB, view_names
from .errors import APIError
from .settings import Settings

log = logging.getLogger(__name__)

REGION_CODE = re.compile(r"^[A-Z0-9_]{2,16}$")


@dataclass(frozen=True)
class RegionInfo:
    code: str
    path: Path
    manifest: dict
    generated_utc: str
    calibration_version: str
    period_start: date
    period_end: date
    sp_cutoff: date            # último día solar 100 % SP
    nrt_start: date | None     # primer día solar con datos NRT
    layers: dict
    h3: dict
    bbox: tuple[float, float, float, float]  # oeste, sur, este, norte
    etag: str

    @property
    def views(self) -> dict[str, str]:
        return view_names(self.code)


def _d(value: str) -> date:
    return date.fromisoformat(value)


class Registry:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._lock = threading.Lock()
        self._db: ReadOnlyDB | None = None
        self._retired: list[ReadOnlyDB] = []
        self._regions: dict[str, RegionInfo] = {}
        self._signature: dict[str, tuple[int, int]] | None = None
        self._last_check = 0.0
        self.reload()

    # -- API pública -------------------------------------------------------
    @property
    def db(self) -> ReadOnlyDB:
        assert self._db is not None
        return self._db

    @property
    def regions(self) -> dict[str, RegionInfo]:
        return self._regions

    def get(self, code: str) -> RegionInfo:
        info = self._regions.get(code.upper())
        if info is None:
            raise APIError(
                404,
                "region_not_found",
                f"Región '{code}' no disponible",
                {"available": sorted(self._regions)},
            )
        return info

    def maybe_reload(self) -> None:
        if time.monotonic() - self._last_check < self.settings.reload_check_seconds:
            return
        self.reload()

    def reload(self) -> None:
        with self._lock:
            self._last_check = time.monotonic()
            sig = self._scan()
            if sig == self._signature and self._db is not None:
                return
            region_dirs = {code: self.settings.data_root / code for code in sig}
            rebuild = self._db is None or set(sig) != set(self._signature or {})
            db = (
                ReadOnlyDB(
                    self.settings.data_root,
                    self.settings.catalog_dir,
                    region_dirs,
                    threads=self.settings.duckdb_threads,
                    memory_limit=self.settings.duckdb_memory_limit,
                )
                if rebuild
                else self._db
            )
            regions: dict[str, RegionInfo] = {}
            for code, rdir in region_dirs.items():
                try:
                    regions[code] = self._load_region(db, code, rdir)
                except Exception:  # una región rota no tumba al resto
                    log.exception("No se pudo cargar la región %s", code)
            if rebuild and self._db is not None:
                # Se cierra en el próximo recambio, para no cortar consultas en curso.
                for old in self._retired:
                    old.close()
                self._retired = [self._db]
            self._db, self._regions, self._signature = db, regions, sig
            log.info("Regiones cargadas: %s", ", ".join(sorted(regions)) or "(ninguna)")

    def close(self) -> None:
        with self._lock:
            for db in [*self._retired, self._db]:
                if db is not None:
                    db.close()
            self._retired, self._db = [], None

    # -- internos ----------------------------------------------------------
    def _scan(self) -> dict[str, tuple[int, int]]:
        sig: dict[str, tuple[int, int]] = {}
        root = self.settings.data_root
        if not root.is_dir():
            log.warning("DATA_ROOT no existe: %s", root)
            return sig
        for d in sorted(root.iterdir()):
            m = d / "manifest.json"
            if d.is_dir() and REGION_CODE.match(d.name) and m.is_file():
                st = m.stat()
                sig[d.name] = (st.st_mtime_ns, st.st_size)
        return sig

    def _load_region(self, db: ReadOnlyDB, code: str, rdir: Path) -> RegionInfo:
        manifest = json.loads((rdir / "manifest.json").read_text(encoding="utf-8"))
        cut = manifest.get("sp_nrt_cut", {})
        layers = manifest.get("layers", {})
        period = manifest["period"]

        sp_cutoff = _d(cut.get("sp_cutoff_solar_day") or layers["SP"]["last"])
        nrt = layers.get("NRT") or {}
        nrt_start = _d(nrt["first"]) if nrt.get("first") else None

        bb = db.query(
            f"SELECT min(cell_lon) w, min(cell_lat) s, max(cell_lon) e, max(cell_lat) n "
            f"FROM {view_names(code)['cells']}"
        )[0]
        bbox = tuple(round(float(bb[k]), 4) for k in ("w", "s", "e", "n"))

        version = manifest.get("calibration_version", "unknown")
        generated = manifest.get("generated_utc", "")
        etag = 'W/"' + hashlib.sha1(f"{code}|{version}|{generated}".encode()).hexdigest()[:20] + '"'

        return RegionInfo(
            code=code,
            path=rdir,
            manifest=manifest,
            generated_utc=generated,
            calibration_version=version,
            period_start=_d(period[0]),
            period_end=_d(period[1]),
            sp_cutoff=sp_cutoff,
            nrt_start=nrt_start,
            layers=layers,
            h3=manifest.get("h3", {}),
            bbox=bbox,  # type: ignore[arg-type]
            etag=etag,
        )
