"""File delivery by random id. ``/media`` is inline (with HTTP Range support for
<video>), ``/files`` is a download (Content-Disposition: attachment).

Files are addressed by unguessable ids (capability URLs) and are not tied to
the cookie: an iOS home-screen app and Safari have separate cookie jars, and the
"Download" button may open the link outside the app."""

from __future__ import annotations

from urllib.parse import quote

from fastapi import APIRouter, Depends, Response
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..db import StoredFile, get_db
from ..services.errors import UserError
from ..services.storage import get_storage

router = APIRouter(tags=["files"])


async def _file(file_id: str, db: AsyncSession) -> StoredFile:
    if not (8 <= len(file_id) <= 40) or not file_id.replace("-", "").replace("_", "").isalnum():
        raise UserError("Файл не найден.", code="not_found", status=404)
    f = await db.get(StoredFile, file_id)
    if f is None:
        raise UserError("Файл не найден или срок его хранения истёк.", code="not_found", status=404)
    return f


def _send(f: StoredFile, attachment: bool) -> Response:
    s = get_settings()
    path = get_storage().path(f.path)
    if not path.exists():
        raise UserError("Файл не найден или срок его хранения истёк.", code="not_found", status=404)
    disp = "attachment" if attachment else "inline"
    headers = {
        "Content-Disposition": f"{disp}; filename=\"bannerka.mp4\"; filename*=UTF-8''{quote(f.name)}",
        "Cache-Control": "private, max-age=86400, immutable",
        "X-Content-Type-Options": "nosniff",
    }
    if s.x_accel_redirect:
        headers["X-Accel-Redirect"] = s.x_accel_prefix + quote(f.path)
        return Response(status_code=200, headers=headers, media_type=f.mime)
    return FileResponse(path, media_type=f.mime, headers=headers)


@router.get("/media/{file_id}")
async def media(file_id: str, db: AsyncSession = Depends(get_db)) -> Response:
    return _send(await _file(file_id, db), attachment=False)


@router.get("/files/{file_id}")
async def download(file_id: str, db: AsyncSession = Depends(get_db)) -> Response:
    return _send(await _file(file_id, db), attachment=True)
