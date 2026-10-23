from __future__ import annotations

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import Asset, Job, Project, get_db
from ..services.errors import UserError


def session_id(request: Request) -> str:
    sid = getattr(request.state, "session_id", None)
    if not sid:
        raise UserError("Сессия не найдена. Обновите страницу.", code="no_session", status=401)
    return sid


async def owned_project(project_id: str, sid: str = Depends(session_id), db: AsyncSession = Depends(get_db)) -> Project:
    project = await db.get(Project, project_id)
    if project is None or project.session_id != sid:
        raise UserError("Проект не найден или удалён.", code="not_found", status=404)
    return project


async def owned_job(job_id: str, sid: str = Depends(session_id), db: AsyncSession = Depends(get_db)) -> Job:
    job = await db.get(Job, job_id)
    if job is None or job.session_id != sid:
        raise UserError("Задача не найдена.", code="not_found", status=404)
    return job


async def owned_asset(asset_id: str, sid: str = Depends(session_id), db: AsyncSession = Depends(get_db)) -> Asset:
    asset = await db.get(Asset, asset_id)
    if asset is None or asset.session_id != sid:
        raise UserError("Баннер не найден.", code="not_found", status=404)
    return asset
