from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, Depends, File, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..db import get_db
from ..jobs import create_job, get_redis, job_public
from ..services import ytdlp
from ..services.errors import UserError
from ..services.ffmpeg import FFmpegError, probe
from ..services.storage import get_storage, media_url
from ..services.urls import parse_source_url
from ..worker.tasks import info_cache_key, preview_cache_key
from .deps import session_id
from .uploads import save_upload

router = APIRouter(prefix="/source", tags=["source"])


class ResolveIn(BaseModel):
    url: str = Field(max_length=4096)


class StripIn(BaseModel):
    url: str = Field(max_length=4096)
    start: float = Field(ge=0)
    end: float = Field(gt=0)
    count: int = Field(12, ge=2, le=40)


@router.post("/resolve")
async def resolve(body: ResolveIn) -> dict:
    ref = parse_source_url(body.url)
    r = get_redis()
    raw = await r.get(info_cache_key(ref.url))
    if raw:
        info = json.loads(raw)
    else:
        info = await ytdlp.fetch_info(ref)
        await r.set(info_cache_key(ref.url), json.dumps(info), ex=1800)
    summary = ytdlp.summarize(ref, info)
    if summary["duration"] <= 0 and summary["player"]["type"] != "video":
        raise UserError("Не удалось определить длительность видео.", code="no_duration", status=422)
    return summary


@router.post("/preview")
async def preview(body: ResolveIn, sid: str = Depends(session_id), db: AsyncSession = Depends(get_db)) -> dict:
    """Low quality preview for platforms without an embeddable player API."""
    ref = parse_source_url(body.url)
    raw = await get_redis().get(preview_cache_key(ref.url))
    if raw:
        cached = json.loads(raw)
        if get_storage().path(cached["key"]).exists():
            return {"result": cached["result"], "jobId": None}
    job = await create_job(db, session_id=sid, kind="preview", payload={"url": ref.url})
    return {"jobId": job.id, "job": job_public(job)}


@router.post("/strip")
async def strip(body: StripIn, sid: str = Depends(session_id), db: AsyncSession = Depends(get_db)) -> dict:
    ref = parse_source_url(body.url)
    if body.end <= body.start:
        raise UserError("Неверный интервал.", code="bad_range")
    job = await create_job(db, session_id=sid, kind="strip", enforce_limit=False,
                           payload={"url": ref.url, "start": body.start, "end": body.end, "count": body.count})
    return {"jobId": job.id, "job": job_public(job)}


@router.post("/upload")
async def upload(file: UploadFile = File(...), sid: str = Depends(session_id), db: AsyncSession = Depends(get_db)) -> dict:
    """Upload a video from the device instead of a link."""
    s = get_settings()
    storage = get_storage()
    out_dir = storage.new_dir("uploads")
    path, _kind, mime = await save_upload(file, out_dir, s.max_upload_mb * 1024 * 1024, {"video"})
    try:
        p = await probe(path)
    except FFmpegError as exc:
        storage.delete(storage.key(out_dir))
        raise UserError("Не удалось прочитать видео — формат не поддерживается.", code="bad_video", status=415) from exc
    if not p.has_video or p.duration <= 0:
        storage.delete(storage.key(out_dir))
        raise UserError("В файле нет видеодорожки.", code="bad_video", status=415)
    f = await storage.register(db, path, kind="upload", mime=mime, session_id=sid,
                               name=Path(file.filename or "video").name[:200])
    await db.commit()
    title = Path(file.filename or "Видео").stem[:200] or "Видео"
    job = await create_job(db, session_id=sid, kind="preview", enforce_limit=False,
                           payload={"uploadKey": f.path, "uploadUrl": media_url(f.id)})
    return {
        "uploadId": f.id,
        "title": title,
        "duration": p.duration,
        "width": p.width,
        "height": p.height,
        "jobId": job.id,
    }
