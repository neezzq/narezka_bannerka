"""Streaming uploads with a hard size limit and magic-byte sniffing.

The client sends the file as the raw request body (``X-Filename`` carries the
name), which streams straight into storage. multipart/form-data still works,
but Starlette spools it to a temp file first: every byte is written twice."""

from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path
from urllib.parse import unquote

from fastapi import Request
from starlette.datastructures import UploadFile

from ..services.assets import sniff
from ..services.errors import UserError

CHUNK = 1024 * 1024
EXT = {
    "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif",
    "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm",
}


async def _file_chunks(file: UploadFile) -> AsyncIterator[bytes]:
    while chunk := await file.read(CHUNK):
        yield chunk


async def upload_source(request: Request) -> tuple[AsyncIterator[bytes], str]:
    """(chunks, original file name) of an upload in either encoding."""
    if request.headers.get("content-type", "").startswith("multipart/form-data"):
        form = await request.form()
        file = form.get("file")
        if not isinstance(file, UploadFile):
            raise UserError("Файл не передан.", code="no_file", status=400)
        return _file_chunks(file), file.filename or ""
    return request.stream(), unquote(request.headers.get("x-filename", ""))


async def save_stream(chunks: AsyncIterator[bytes], dest_dir: Path, max_bytes: int,
                      allowed_kinds: set[str]) -> tuple[Path, str, str]:
    """Write ``chunks`` into ``dest_dir``; returns (path, kind, mime). Validates the
    real content type by magic bytes, never trusting the client's header."""
    head = b""
    it = chunks.__aiter__()
    async for chunk in it:
        head += chunk
        if len(head) >= 64:
            break
    sniffed = sniff(head[:64])
    if sniffed is None or sniffed[0] not in allowed_kinds:
        raise UserError("Неподдерживаемый формат файла.", code="bad_type", status=415)
    kind, mime = sniffed
    dest = dest_dir / f"upload{EXT[mime]}"
    size = len(head)
    too_big = UserError(f"Файл слишком большой — максимум {max_bytes // (1024 * 1024)} МБ.", code="too_large",
                        status=413)
    if size > max_bytes:
        raise too_big
    with dest.open("wb") as out:
        out.write(head)
        async for chunk in it:
            size += len(chunk)
            if size > max_bytes:
                out.close()
                dest.unlink(missing_ok=True)
                raise too_big
            out.write(chunk)
    if size < 32:
        dest.unlink(missing_ok=True)
        raise UserError("Файл пустой.", code="empty", status=400)
    return dest, kind, mime
