"""Background jobs: DB rows (durable) + Redis state/pub-sub (live progress).

API creates a ``Job`` row and enqueues ``run_job`` in arq; the worker reports
progress through ``JobReporter`` which writes ``bk:job:<id>`` and publishes on
the channel of the same name. The SSE endpoint relays those messages."""

from __future__ import annotations

import json
import time
from typing import Any

import redis.asyncio as aioredis
from arq import ArqRedis, create_pool
from arq.connections import RedisSettings
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .db import Job, sessionmaker, utcnow
from .services.errors import UserError
from .services.storage import new_id

TERMINAL = {"done", "error", "canceled"}
ACTIVE = {"queued", "running"}
STATE_TTL = 24 * 3600

_redis: aioredis.Redis | None = None
_arq: ArqRedis | None = None


def state_key(job_id: str) -> str:
    return f"bk:job:{job_id}"


def get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(get_settings().redis_url, decode_responses=True)
    return _redis


async def get_arq() -> ArqRedis:
    global _arq
    if _arq is None:
        _arq = await create_pool(RedisSettings.from_dsn(get_settings().redis_url))
    return _arq


async def close_redis() -> None:
    global _redis, _arq
    if _redis is not None:
        await _redis.aclose()
    if _arq is not None:
        await _arq.aclose()
    _redis = _arq = None


def job_public(job: Job) -> dict[str, Any]:
    return {
        "id": job.id,
        "kind": job.kind,
        "projectId": job.project_id,
        "status": job.status,
        "progress": round(job.progress, 4),
        "stage": job.stage,
        "error": job.error,
        "result": job.result,
        "createdAt": job.created_at.isoformat() + "Z",
    }


async def publish(state: dict[str, Any], redis: aioredis.Redis | None = None) -> None:
    r = redis or get_redis()
    data = json.dumps(state, ensure_ascii=False)
    await r.set(state_key(state["id"]), data, ex=STATE_TTL)
    await r.publish(state_key(state["id"]), data)


async def read_state(job_id: str) -> dict[str, Any] | None:
    raw = await get_redis().get(state_key(job_id))
    return json.loads(raw) if raw else None


async def count_active(db: AsyncSession, session_id: str) -> int:
    q = select(func.count()).select_from(Job).where(Job.session_id == session_id, Job.status.in_(ACTIVE))
    return int((await db.execute(q)).scalar_one())


async def create_job(
    db: AsyncSession,
    *,
    session_id: str,
    kind: str,
    project_id: str | None = None,
    payload: dict[str, Any] | None = None,
    enforce_limit: bool = True,
) -> Job:
    settings = get_settings()
    if enforce_limit and await count_active(db, session_id) >= settings.max_active_jobs_per_session:
        raise UserError(
            "Слишком много задач одновременно. Дождитесь завершения текущих и попробуйте снова.",
            code="too_many_jobs",
            status=429,
        )
    job = Job(id=new_id(), session_id=session_id, kind=kind, project_id=project_id, payload=payload or {})
    db.add(job)
    await db.commit()
    await publish(job_public(job))
    pool = await get_arq()
    await pool.enqueue_job("run_job", job.id, _job_id=job.id)
    return job


async def cancel_job(db: AsyncSession, job: Job) -> None:
    if job.status in TERMINAL:
        return
    from arq.jobs import Job as ArqJob

    try:
        await ArqJob(job.id, await get_arq()).abort(timeout=0)
    except Exception:  # noqa: BLE001 - abort is best effort
        pass
    job.status = "canceled"
    job.stage = "canceled"
    job.updated_at = utcnow()
    await db.commit()
    await publish(job_public(job))


class JobReporter:
    """Used by the worker to push progress (throttled) and final states."""

    def __init__(self, job: Job) -> None:
        self.job = job
        self._last_pub = 0.0
        self._span = (0.0, 1.0)

    def span(self, start: float, end: float) -> None:
        """Map following ``progress(0..1)`` calls into ``[start, end]``."""
        self._span = (start, end)

    async def stage(self, stage: str, progress: float | None = None) -> None:
        self.job.stage = stage
        if progress is not None:
            self.job.progress = progress
        self.job.status = "running"
        await self._persist()
        await publish(job_public(self.job))

    async def progress(self, frac: float) -> None:
        a, b = self._span
        value = a + (b - a) * min(1.0, max(0.0, frac))
        if value < self.job.progress:
            return
        self.job.progress = value
        now = time.monotonic()
        if now - self._last_pub >= 0.3:
            self._last_pub = now
            await publish(job_public(self.job))

    async def done(self, result: dict[str, Any] | None = None) -> None:
        self.job.status = "done"
        self.job.stage = "done"
        self.job.progress = 1.0
        self.job.result = result or {}
        await self._persist()
        await publish(job_public(self.job))

    async def fail(self, message: str, status: str = "error") -> None:
        self.job.status = status
        self.job.stage = status
        self.job.error = message
        await self._persist()
        await publish(job_public(self.job))

    async def _persist(self) -> None:
        async with sessionmaker()() as db:
            row = await db.get(Job, self.job.id)
            if row is None:
                return
            if row.status == "canceled" and self.job.status != "canceled":
                self.job.status = "canceled"
                return
            row.status, row.stage, row.progress = self.job.status, self.job.stage, self.job.progress
            row.error, row.result, row.updated_at = self.job.error, self.job.result, utcnow()
            await db.commit()
