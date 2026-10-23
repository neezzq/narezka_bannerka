from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    """Runtime configuration. Every field can be overridden with an env variable
    of the same name in upper case (see ``.env.example``)."""

    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore")

    app_env: str = "development"
    storage_dir: Path = REPO_DIR / "storage"
    database_url: str = ""
    redis_url: str = "redis://localhost:6379/0"
    fonts_dir: Path = REPO_DIR / "frontend" / "public" / "fonts"

    # Limits
    max_clip_seconds: int = 180
    max_banner_mb: int = 50
    max_upload_mb: int = 1024
    max_active_jobs_per_session: int = 3
    rate_limit_per_minute: int = 240
    file_ttl_hours: int = 24
    asset_ttl_hours: int = 168

    # Media processing
    max_source_short_side: int = 1080
    proxy_short_side: int = 540
    ffmpeg_bin: str = "ffmpeg"
    ffprobe_bin: str = "ffprobe"
    ytdlp_bin: str = "yt-dlp"
    ytdlp_cookies_file: Path | None = None
    ytdlp_timeout: int = 900
    render_preset: str = "veryfast"
    render_threads: int = 0

    # Speech recognition
    whisper_model: str = "small"
    whisper_device: str = "cpu"
    whisper_compute_type: str = "int8"
    whisper_cpu_threads: int = 0

    # HTTP
    cookie_secure: bool = False
    x_accel_redirect: bool = False
    x_accel_prefix: str = "/_protected/"
    cors_origins: list[str] = Field(default_factory=list)

    worker_max_jobs: int = 2

    @property
    def db_url(self) -> str:
        return self.database_url or f"sqlite+aiosqlite:///{self.storage_dir / 'bannerka.db'}"

    @property
    def models_dir(self) -> Path:
        return self.storage_dir / "models"


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.storage_dir.mkdir(parents=True, exist_ok=True)
    return s
