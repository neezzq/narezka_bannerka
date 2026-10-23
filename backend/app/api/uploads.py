"""Streaming upload helper with a hard size limit and magic-byte sniffing."""

from __future__ import annotations

from pathlib import Path

from fastapi import UploadFile

from ..services.assets import sniff
from ..services.errors import UserError

CHUNK = 1024 * 1024


async def save_upload(file: UploadFile, dest_dir: Path, max_bytes: int, allowed_kinds: set[str]) -> tuple[Path, str, str]:
    """Save ``file`` into ``dest_dir``; returns (path, kind, mime). Validates the
    real content type by magic bytes, never trusting the client's header."""
    head = await file.read(64)
    sniffed = sniff(head)
    if sniffed is None or sniffed[0] not in allowed_kinds:
        raise UserError("Неподдерживаемый формат файла.", code="bad_type", status=415)
    kind, mime = sniffed
    ext = {
        "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif",
        "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm",
    }[mime]
    dest = dest_dir / f"upload{ext}"
    size = len(head)
    with dest.open("wb") as out:
        out.write(head)
        while chunk := await file.read(CHUNK):
            size += len(chunk)
            if size > max_bytes:
                out.close()
                dest.unlink(missing_ok=True)
                raise UserError(
                    f"Файл слишком большой — максимум {max_bytes // (1024 * 1024)} МБ.", code="too_large", status=413
                )
            out.write(chunk)
    if size < 32:
        dest.unlink(missing_ok=True)
        raise UserError("Файл пустой.", code="empty", status=400)
    return dest, kind, mime
