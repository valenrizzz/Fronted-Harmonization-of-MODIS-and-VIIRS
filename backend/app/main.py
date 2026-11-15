"""Punto de entrada: ``uvicorn app.main:app --reload`` desde backend/."""

from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import RedirectResponse

from . import __version__
from .errors import install_error_handlers
from .registry import Registry
from .routers import data, meta
from .settings import Settings, get_settings

API_PREFIX = "/api/v1"


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.registry = Registry(settings)
        try:
            yield
        finally:
            app.state.registry.close()

    app = FastAPI(
        title="Actividad de incendios armonizada (MODIS + VIIRS)",
        version=__version__,
        description=(
            "Serie única y comparable de actividad de incendios desde 2000, construida sobre "
            "NASA FIRMS. El sensor de origen está abstraído: los conteos armonizados se expresan "
            "en unidades de la constelación de referencia. Fechas = día solar local."
        ),
        lifespan=lifespan,
        docs_url=f"{API_PREFIX}/docs",
        openapi_url=f"{API_PREFIX}/openapi.json",
    )
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_origin_regex=settings.cors_origin_regex,
        allow_methods=["GET"],
        allow_headers=["*"],
        expose_headers=["ETag", "X-Process-Time-Ms"],
    )

    @app.middleware("http")
    async def timing(request: Request, call_next):
        t0 = time.perf_counter()
        response = await call_next(request)
        response.headers["X-Process-Time-Ms"] = f"{(time.perf_counter() - t0) * 1000:.1f}"
        return response

    install_error_handlers(app)
    app.include_router(meta.router, prefix=API_PREFIX)
    app.include_router(data.router, prefix=API_PREFIX)

    @app.get("/", include_in_schema=False)
    def root():
        return RedirectResponse(f"{API_PREFIX}/docs")

    return app


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
app = create_app()
