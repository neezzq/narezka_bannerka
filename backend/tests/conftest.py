from __future__ import annotations

import shutil
from pathlib import Path

import fakeredis
import pytest

ROOT = Path(__file__).resolve().parents[2]
HAS_FFMPEG = shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


class FakeArq:
    def __init__(self) -> None:
        self.calls: list[tuple] = []

    async def enqueue_job(self, *args, **kwargs):
        self.calls.append((args, kwargs))

    async def aclose(self) -> None:
        pass


@pytest.fixture
def env(tmp_path, monkeypatch):
    """Isolated storage/DB/Redis for one test."""
    from app import config, db, jobs
    from app.render import fonts

    monkeypatch.setenv("STORAGE_DIR", str(tmp_path / "storage"))
    monkeypatch.setenv("FONTS_DIR", str(ROOT / "frontend" / "public" / "fonts"))
    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{tmp_path / 'test.db'}")
    monkeypatch.setenv("RATE_LIMIT_PER_MINUTE", "1000")
    config.get_settings.cache_clear()
    fonts.catalog.cache_clear()
    db._engine = None
    db._sessionmaker = None
    fake_redis = fakeredis.FakeAsyncRedis(decode_responses=True)
    arq = FakeArq()
    monkeypatch.setattr(jobs, "_redis", fake_redis)
    monkeypatch.setattr(jobs, "_arq", arq)

    async def get_arq():
        return arq

    monkeypatch.setattr(jobs, "get_arq", get_arq)
    yield {"tmp": tmp_path, "redis": fake_redis, "arq": arq}
    config.get_settings.cache_clear()
    db._engine = None
    db._sessionmaker = None


def make_video(path: Path, seconds: float = 4, size: str = "640x360", audio: bool = True) -> Path:
    import subprocess

    args = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", f"testsrc2=s={size}:r=30:d={seconds}"]
    if audio:
        args += ["-f", "lavfi", "-i", f"sine=f=440:d={seconds}", "-c:a", "aac", "-shortest"]
    args += ["-c:v", "libx264", "-pix_fmt", "yuv420p", str(path)]
    subprocess.run(args, check=True)
    return path
