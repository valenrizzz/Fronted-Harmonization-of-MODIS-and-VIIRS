from functools import lru_cache
from pathlib import Path
from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="FIRE_API_",
        env_file=BACKEND_DIR / ".env",
        extra="ignore",
    )

    data_root: Path = BACKEND_DIR.parent / "Datos_Para_La_Web"
    catalog_dir: Path = BACKEND_DIR / ".cache"
    cors_origins: Annotated[list[str], NoDecode] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]
    cors_origin_regex: str | None = None  # p. ej. https://.*\.vercel\.app (URLs de preview)
    max_cells: int = Field(20_000, ge=100, le=500_000)
    duckdb_threads: int = Field(4, ge=1)
    duckdb_memory_limit: str = "1GB"
    reload_check_seconds: float = Field(30.0, ge=0)
    cache_max_age: int = Field(300, ge=0)

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, v):
        if isinstance(v, str):
            return [s.strip() for s in v.split(",") if s.strip()]
        return v

    @field_validator("data_root", "catalog_dir", mode="after")
    @classmethod
    def _absolute(cls, v: Path) -> Path:
        # Rutas relativas se resuelven respecto de backend/, no del directorio de arranque.
        return v if v.is_absolute() else (BACKEND_DIR / v).resolve()


@lru_cache
def get_settings() -> Settings:
    return Settings()
