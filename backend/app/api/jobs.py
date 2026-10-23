from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import Job, get_db
from ..jobs import ACTIVE, TERMINAL, cancel_job, get_redis, job_public, read_state, state_key
from .deps import owned_job, session_id

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.get("")
async def list_jobs(active: bool = False, sid: str = Depends(session_id), db: AsyncSession = Depends(get_db)) -> dict:
    q = select(Job).where(Job.session_id == sid)
    if active:
        q = q.where(Job.status.in_(ACTIVE))
    rows = (await db.execute(q.order_by(Job.created_at.desc()).limit(30))).scalars().all()
    out = []
    for j in rows:
        live = await read_state(j.id) if j.status in ACTIVE else None
        out.append(live or job_public(j))
    return {"jobs": out}


@router.get("/{job_id}")
async def get_job(job: Job = Depends(owned_job)) -> dict:
    live = await read_state(job.id)
    if live and (live["status"] in TERMINAL or job.status not in TERMINAL):
        return live
    return job_public(job)


@router.post("/{job_id}/cancel")
async def cancel(job: Job = Depends(owned_job), db: AsyncSession = Depends(get_db)) -> dict:
    await cancel_job(db, job)
    return job_public(job)


@router.get("/{job_id}/events")
async def events(request: Request, job: Job = Depends(owned_job)) -> StreamingResponse:
    """Server-Sent Events with the job state until it reaches a terminal status."""
    job_id = job.id
    initial = await read_state(job_id) or job_public(job)

    async def stream() -> AsyncIterator[str]:
        yield "retry: 2000\n\n"
        yield f"data: {json.dumps(initial, ensure_ascii=False)}\n\n"
        if initial["status"] in TERMINAL:
            return
        pubsub = get_redis().pubsub()
        await pubsub.subscribe(state_key(job_id))
        try:
            # re-read after subscribing so no update between the two is lost
            current = await read_state(job_id)
            if current and current != initial:
                yield f"data: {json.dumps(current, ensure_ascii=False)}\n\n"
                if current["status"] in TERMINAL:
                    return
            idle = 0.0
            while True:
                if await request.is_disconnected():
                    return
                msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if msg is None:
                    idle += 1.0
                    if idle >= 15:
                        idle = 0
                        yield ": ping\n\n"
                    await asyncio.sleep(0)
                    continue
                idle = 0
                data = msg["data"]
                yield f"data: {data}\n\n"
                if json.loads(data).get("status") in TERMINAL:
                    return
        finally:
            await pubsub.unsubscribe()
            await pubsub.aclose()

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )
