"""File storage. ``LocalStorage`` keeps files under ``STORAGE_DIR``; the interface
(relative keys, register/delete) is what an S3 implementation would provide."""

from __future__ import annotations

import secrets
import shutil
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..db import StoredFile, utcnow


def new_id(nbytes: int = 12) -> str:
    """Random URL-safe id (96 bits by default)."""
    return secrets.token_urlsafe(nbytes).replace("-", "a").replace("_", "b")


class LocalStorage:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def path(self, key: str) -> Path:
        p = (self.root / key).resolve()
        if self.root not in p.parents and p != self.root:
            raise ValueError("path escapes storage root")
        return p

    def key(self, path: Path) -> str:
        return str(path.resolve().relative_to(self.root))

    def new_dir(self, kind: str) -> Path:
        d = self.root / kind / datetime.now().strftime("%Y%m%d") / new_id()
        d.mkdir(parents=True, exist_ok=True)
        return d

    def delete(self, key: str) -> None:
        p = self.path(key)
        if p.is_dir():
            shutil.rmtree(p, ignore_errors=True)
        else:
            p.unlink(missing_ok=True)

    async def register(
        self,
        db: AsyncSession,
        path: Path,
        *,
        kind: str,
        mime: str,
        session_id: str | None,
        name: str = "file",
        ttl_hours: float | None = None,
    ) -> StoredFile:
        ttl = get_settings().file_ttl_hours if ttl_hours is None else ttl_hours
        f = StoredFile(
            id=new_id(16),
            session_id=session_id,
            kind=kind,
            path=self.key(path),
            mime=mime,
            size=path.stat().st_size,
            name=name,
            expires_at=utcnow() + timedelta(hours=ttl),
        )
        db.add(f)
        await db.flush()
        return f


_storage: LocalStorage | None = None


def get_storage() -> LocalStorage:
    global _storage
    if _storage is None or _storage.root != get_settings().storage_dir.resolve():
        _storage = LocalStorage(get_settings().storage_dir)
    return _storage


def media_url(file_id: str | None) -> str | None:
    return f"/api/media/{file_id}" if file_id else None


def download_url(file_id: str) -> str:
    return f"/api/files/{file_id}"
