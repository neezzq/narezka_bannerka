from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..db import Asset, StoredFile, get_db
from ..jobs import create_job, job_public
from ..services.assets import process_gif, process_image
from ..services.projects import asset_public
from ..services.storage import get_storage, new_id
from .deps import owned_asset, session_id
from .uploads import save_stream, upload_source

router = APIRouter(prefix="/assets", tags=["assets"])


@router.post("")
async def upload_asset(request: Request, sid: str = Depends(session_id), db: AsyncSession = Depends(get_db)) -> dict:
    s = get_settings()
    storage = get_storage()
    out_dir = storage.new_dir("assets")
    chunks, filename = await upload_source(request)
    try:
        path, kind, _mime = await save_stream(chunks, out_dir, s.max_banner_mb * 1024 * 1024,
                                              {"image", "gif", "video"})
    except BaseException:
        storage.delete(storage.key(out_dir))
        raise
    name = Path(filename or "banner").name[:200]
    asset = Asset(id=new_id(), session_id=sid, kind=kind, name=name, mime=_mime, width=0, height=0)
    if kind == "video":
        asset.status = "processing"
        db.add(asset)
        await db.commit()
        job = await create_job(db, session_id=sid, kind="asset", enforce_limit=False,
                               payload={"assetId": asset.id, "uploadKey": storage.key(path)})
        return {"asset": asset_public(asset), "jobId": job.id, "job": job_public(job)}
    try:
        res = await asyncio.to_thread(process_gif if kind == "gif" else process_image, path, out_dir)
    except Exception:
        storage.delete(storage.key(out_dir))
        raise
    if res["render"] != path and res["preview"] != path:
        path.unlink(missing_ok=True)

    async def reg(p: Path, mime: str, k: str) -> StoredFile:
        f = await storage.register(db, p, kind=k, mime=mime, session_id=sid, name=name)
        f.expires_at = None  # lifetime managed by the asset (ASSET_TTL_HOURS since last use)
        return f

    fr = await reg(res["render"], res["renderMime"], "asset")
    fp = fr if res["preview"] == res["render"] else await reg(res["preview"], res["previewMime"], "asset-preview")
    ft = await reg(res["thumb"], "image/png", "asset-thumb")
    asset.kind = res["kind"]
    asset.width, asset.height, asset.duration = res["width"], res["height"], res["duration"]
    asset.file_id, asset.preview_file_id, asset.thumb_file_id = fr.id, fp.id, ft.id
    asset.meta = res["meta"]
    db.add(asset)
    await db.commit()
    return {"asset": asset_public(asset), "jobId": None}


@router.get("")
async def list_assets(sid: str = Depends(session_id), db: AsyncSession = Depends(get_db)) -> dict:
    rows = (await db.execute(
        select(Asset).where(Asset.session_id == sid, Asset.status != "error")
        .order_by(Asset.last_used_at.desc()).limit(100)
    )).scalars().all()
    return {"assets": [asset_public(a) for a in rows]}


@router.get("/{asset_id}")
async def get_asset(asset: Asset = Depends(owned_asset)) -> dict:
    return asset_public(asset)


@router.delete("/{asset_id}")
async def delete_asset(asset: Asset = Depends(owned_asset), db: AsyncSession = Depends(get_db)) -> dict:
    storage = get_storage()
    for fid in {asset.file_id, asset.preview_file_id, asset.thumb_file_id} - {None}:
        f = await db.get(StoredFile, fid)
        if f is not None:
            storage.delete(str(Path(f.path).parent))
            await db.delete(f)
    await db.delete(asset)
    await db.commit()
    return {"ok": True}
