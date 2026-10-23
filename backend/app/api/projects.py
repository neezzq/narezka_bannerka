from __future__ import annotations

import json

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..db import Job, Project, StoredFile, get_db, utcnow
from ..jobs import ACTIVE, cancel_job, create_job, get_redis, job_public
from ..schemas import ExportSettings, ProjectDoc, ProjectPatch
from ..services import ytdlp
from ..services.errors import UserError
from ..services.projects import project_public, project_summary
from ..services.storage import get_storage, new_id
from ..services.timecode import validate_range
from ..services.urls import parse_source_url
from ..worker.tasks import info_cache_key
from .deps import owned_project, session_id

router = APIRouter(prefix="/projects", tags=["projects"])


class CreateIn(BaseModel):
    url: str | None = Field(None, max_length=4096)
    uploadId: str | None = Field(None, max_length=40)
    start: float = Field(ge=0)
    end: float = Field(gt=0)
    title: str | None = Field(None, max_length=300)
    quality: int | None = Field(None, ge=144, le=4320, description="short side of the downloaded fragment")


class TranscribeIn(BaseModel):
    language: str = Field("auto", pattern=r"^(auto|[a-z]{2,3})$")


class RenderIn(BaseModel):
    doc: ProjectDoc | None = None
    export: ExportSettings | None = None


async def _jobs_for(db: AsyncSession, project_id: str) -> list[dict]:
    rows = (await db.execute(
        select(Job).where(Job.project_id == project_id).order_by(Job.created_at.desc()).limit(20)
    )).scalars().all()
    return [job_public(j) for j in rows if j.status in ACTIVE or j.kind == "render"][:10]


@router.post("")
async def create_project(body: CreateIn, sid: str = Depends(session_id), db: AsyncSession = Depends(get_db)) -> dict:
    s = get_settings()
    if bool(body.url) == bool(body.uploadId):
        raise UserError("Укажите ссылку или загрузите файл.", code="bad_request")
    payload: dict = {}
    if body.url:
        ref = parse_source_url(body.url)
        raw = await get_redis().get(info_cache_key(ref.url))
        info = json.loads(raw) if raw else await ytdlp.fetch_info(ref)
        duration = float(info.get("duration") or 0) or None
        title = body.title or (info.get("title") or "Видео")[:300]
        platform, source_url = ref.platform, ref.url
        payload["url"] = ref.url
    else:
        f = await db.get(StoredFile, body.uploadId)
        if f is None or f.session_id != sid or f.kind != "upload":
            raise UserError("Загруженный файл не найден — загрузите его ещё раз.", code="not_found", status=404)
        from ..services.ffmpeg import probe

        duration = (await probe(get_storage().path(f.path))).duration
        title = body.title or f.name.rsplit(".", 1)[0] or "Видео"
        platform, source_url = "upload", None
        payload["uploadKey"] = f.path
    start, end = validate_range(body.start, body.end, duration, s.max_clip_seconds)
    project = Project(
        id=new_id(), session_id=sid, title=title, platform=platform, source_url=source_url,
        source_start=start, source_end=end, status="downloading", doc={},
    )
    db.add(project)
    await db.commit()
    payload.update({"start": start, "end": end, "quality": min(body.quality or s.default_quality, s.max_quality)})
    job = await create_job(db, session_id=sid, kind="download", project_id=project.id, payload=payload)
    return {"project": project_public(project, [job_public(job)]), "jobId": job.id}


@router.get("")
async def list_projects(sid: str = Depends(session_id), db: AsyncSession = Depends(get_db)) -> dict:
    rows = (await db.execute(
        select(Project).where(Project.session_id == sid).order_by(Project.updated_at.desc()).limit(50)
    )).scalars().all()
    return {"projects": [project_summary(p) for p in rows]}


@router.get("/{project_id}")
async def get_project(project: Project = Depends(owned_project), db: AsyncSession = Depends(get_db)) -> dict:
    return project_public(project, await _jobs_for(db, project.id))


@router.patch("/{project_id}")
async def patch_project(body: ProjectPatch, project: Project = Depends(owned_project),
                        db: AsyncSession = Depends(get_db)) -> dict:
    if project.status == "downloading" and not body.doc.cuts:
        # the download job fills in defaults; ignore early autosaves without cuts
        return {"revision": project.revision, "updatedAt": project.updated_at.isoformat() + "Z"}
    project.doc = body.doc.model_dump(mode="json")
    if body.title is not None and body.title.strip():
        project.title = body.title.strip()
    project.revision += 1
    project.updated_at = utcnow()
    await db.commit()
    return {"revision": project.revision, "updatedAt": project.updated_at.isoformat() + "Z"}


@router.delete("/{project_id}")
async def delete_project(project: Project = Depends(owned_project), db: AsyncSession = Depends(get_db)) -> dict:
    jobs = (await db.execute(select(Job).where(Job.project_id == project.id, Job.status.in_(ACTIVE)))).scalars().all()
    for j in jobs:
        await cancel_job(db, j)
    internal = project.internal or {}
    if internal.get("dir"):
        get_storage().delete(internal["dir"])
    for fid in internal.get("files", []):
        f = await db.get(StoredFile, fid)
        if f is not None:
            await db.delete(f)
    await db.delete(project)
    await db.commit()
    return {"ok": True}


@router.get("/{project_id}/thumbnails")
async def thumbnails(project: Project = Depends(owned_project)) -> dict:
    if project.status != "ready" or not project.media:
        raise UserError("Видео ещё готовится.", code="not_ready", status=409)
    return project.media["thumbnails"]


@router.post("/{project_id}/transcribe")
async def transcribe(body: TranscribeIn, project: Project = Depends(owned_project), sid: str = Depends(session_id),
                     db: AsyncSession = Depends(get_db)) -> dict:
    if project.status != "ready":
        raise UserError("Видео ещё готовится.", code="not_ready", status=409)
    job = await create_job(db, session_id=sid, kind="transcribe", project_id=project.id,
                           payload={"language": body.language})
    return {"jobId": job.id, "job": job_public(job)}


@router.post("/{project_id}/render")
async def render(body: RenderIn, project: Project = Depends(owned_project), sid: str = Depends(session_id),
                 db: AsyncSession = Depends(get_db)) -> dict:
    if project.status != "ready":
        raise UserError("Видео ещё готовится.", code="not_ready", status=409)
    doc = body.doc or ProjectDoc.model_validate(project.doc or {})
    if body.export is not None:
        doc = doc.model_copy(update={"export": body.export})
    if not doc.cuts:
        raise UserError("В проекте не осталось ни одного фрагмента видео.", code="empty", status=422)
    project.doc = doc.model_dump(mode="json")
    project.revision += 1
    project.updated_at = utcnow()
    await db.commit()
    job = await create_job(db, session_id=sid, kind="render", project_id=project.id,
                           payload={"doc": doc.model_dump(mode="json")})
    return {"jobId": job.id, "job": job_public(job), "revision": project.revision}
