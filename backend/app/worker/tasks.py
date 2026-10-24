"""arq worker: downloading, previews, transcription, rendering, cleanup."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from arq import cron
from arq.connections import RedisSettings
from sqlalchemy import delete, select

from ..config import get_settings
from ..db import Asset, Job, Project, StoredFile, init_db, sessionmaker, utcnow
from ..jobs import JobReporter, get_redis, job_public, publish
from ..render.ass import build_ass
from ..render.graph import AssetInfo, SourceInfo, build_render
from ..schemas import ProjectDoc, frame_size
from ..services import ytdlp
from ..services.assets import process_video
from ..services.errors import UserError
from ..services.ffmpeg import (
    FFmpegError,
    grab_frames_sprite,
    make_previews,
    make_sprite,
    probe,
    run_ffmpeg,
    short_side_scale,
)
from ..services.projects import default_doc
from ..services.quality import quality_class
from ..services.storage import download_url, get_storage, media_url, new_id
from ..services.urls import parse_source_url
from .transcribe import ModelError, group_words, transcribe

log = logging.getLogger("bannerka.worker")

GENERIC_ERRORS = {
    "download": "Не удалось подготовить видео. Попробуйте ещё раз.",
    "preview": "Не удалось загрузить превью видео.",
    "strip": "Не удалось получить кадры превью.",
    "transcribe": "Не удалось распознать речь.",
    "render": "Не удалось собрать ролик. Попробуйте ещё раз.",
    "asset": "Не удалось обработать баннер.",
}


def preview_cache_key(url: str) -> str:
    return f"bk:preview:{url}"


def info_cache_key(url: str) -> str:
    return f"bk:info:{url}"


async def cached_info(url: str) -> dict[str, Any]:
    ref = parse_source_url(url)
    r = get_redis()
    raw = await r.get(info_cache_key(ref.url))
    if raw:
        return json.loads(raw)
    info = await ytdlp.fetch_info(ref)
    await r.set(info_cache_key(ref.url), json.dumps(info), ex=1800)
    return info


async def _register(path: Path, kind: str, mime: str, session_id: str | None, name: str = "file",
                    ttl_hours: float | None = None, permanent: bool = False) -> StoredFile:
    async with sessionmaker()() as db:
        f = await get_storage().register(db, path, kind=kind, mime=mime, session_id=session_id, name=name,
                                         ttl_hours=ttl_hours)
        if permanent:
            f.expires_at = None
        await db.commit()
        return f


def _quality(pl: dict) -> int:
    s = get_settings()
    return max(144, min(int(pl.get("quality") or s.default_quality), s.max_quality))


async def _fetch_section(ref, out_dir: Path, start: float, end: float, quality: int, rep: JobReporter) -> Path:
    """yt-dlp section download, reusing the info cached at /resolve when possible."""
    kw = {"start": start, "end": end, "quality": quality, "on_progress": rep.progress,
          "expected_seconds": (end - start) * 0.6 + 15}
    raw = await get_redis().get(info_cache_key(ref.url))
    if raw:
        info_json = out_dir / "info.json"
        info_json.write_bytes(raw if isinstance(raw, bytes) else raw.encode())
        try:
            return await ytdlp.download(ref, out_dir, info_json=info_json, **kw)
        except UserError as exc:
            if exc.code != "download_failed":
                raise
            # stale format URLs in the cached info: extract again
            log.info("cached info failed for %s, extracting again", ref.url)
        finally:
            info_json.unlink(missing_ok=True)
    return await ytdlp.download(ref, out_dir, **kw)


# --------------------------------------------------------------------------- download
async def task_download(job: Job, rep: JobReporter) -> dict:
    storage = get_storage()
    pl = job.payload
    start, end = float(pl["start"]), float(pl["end"])
    quality = _quality(pl)
    out_dir = storage.new_dir("projects")
    original = out_dir / "original.mp4"
    proxy = out_dir / "proxy.mp4"
    sprite_path = out_dir / "thumbs.jpg"
    t0 = time.monotonic()

    local_src: Path | None = None
    if pl.get("uploadKey"):
        local_src = storage.path(pl["uploadKey"])
    elif pl.get("url"):
        raw = await get_redis().get(preview_cache_key(parse_source_url(pl["url"]).url))
        if raw:
            cached = json.loads(raw)
            # the preview copy is only good enough when it has the chosen quality
            if storage.path(cached["key"]).exists() and cached.get("quality", 0) >= quality:
                local_src = storage.path(cached["key"])

    if local_src is not None:
        # one decode: trimmed working copy + proxy + timeline sprite
        src_probe = await probe(local_src)
        await rep.stage("cutting", 0.02)
        rep.span(0.02, 0.95)
        length = max(0.1, min(end, src_probe.duration) - start)
        sprite = await make_previews(local_src, src_probe, proxy=proxy, sprite=sprite_path, original=original,
                                     quality=quality, start=start, duration=length, on_progress=rep.progress)
        t_fetch = 0.0
        p = await probe(original)
    else:
        # stream-copied section (no re-encode), then proxy + sprite in one pass
        ref = parse_source_url(pl["url"])
        await rep.stage("download", 0.01)
        rep.span(0.01, 0.6)
        downloaded = await _fetch_section(ref, out_dir, start, end, quality, rep)
        downloaded.rename(original)
        t_fetch = time.monotonic() - t0
        p = await probe(original)
        if not p.has_video or p.duration <= 0:
            raise UserError("В скачанном файле нет видео.", code="no_video")
        await rep.stage("proxy", 0.6)
        rep.span(0.6, 0.95)
        sprite = await make_previews(original, p, proxy=proxy, sprite=sprite_path, on_progress=rep.progress)

    await rep.stage("thumbnails", 0.96)
    poster = out_dir / "poster.jpg"
    await run_ffmpeg(["-ss", f"{min(1.0, p.duration / 3):.2f}", "-i", str(proxy), "-frames:v", "1",
                      "-vf", "scale=-2:360", "-q:v", "4", str(poster)])
    log.info("job %s: %.0fs clip %dx%d in %.1fs (fetch %.1fs)", job.id, p.duration, p.width, p.height,
             time.monotonic() - t0, t_fetch)

    fp = await _register(proxy, "proxy", "video/mp4", job.session_id, permanent=True)
    fs = await _register(sprite_path, "thumbs", "image/jpeg", job.session_id, permanent=True)
    fpo = await _register(poster, "poster", "image/jpeg", job.session_id, permanent=True)

    media = {
        **p.as_media(),
        "proxyUrl": media_url(fp.id),
        "posterUrl": media_url(fpo.id),
        "thumbnails": {"url": media_url(fs.id), **sprite},
    }
    async with sessionmaker()() as db:
        project = await db.get(Project, job.project_id)
        if project is None:
            raise UserError("Проект удалён.", code="gone")
        project.media = media
        project.internal = {"dir": storage.key(out_dir), "original": storage.key(original),
                            "files": [fp.id, fs.id, fpo.id]}
        if not (project.doc or {}).get("cuts"):
            project.doc = default_doc(p.width, p.height, p.duration)
        project.status = "ready"
        project.error = None
        project.revision += 1
        project.updated_at = utcnow()
        await db.commit()
    return {"projectId": job.project_id, "media": media}


# --------------------------------------------------------------------------- preview (TikTok, clips, uploads)
async def task_preview(job: Job, rep: JobReporter) -> dict:
    storage = get_storage()
    pl = job.payload
    out_dir = storage.new_dir("previews")
    if pl.get("uploadKey"):
        src = storage.path(pl["uploadKey"])
        p = await probe(src)
        await rep.stage("thumbnails", 0.1)
        video_url = pl["uploadUrl"]
        if p.vcodec not in ("h264",) or src.suffix.lower() not in (".mp4", ".mov", ".m4v"):
            await rep.stage("proxy", 0.1)
            rep.span(0.1, 0.8)
            proxy = out_dir / "preview.mp4"
            w, h = short_side_scale(p.width, p.height, 360)
            args = ["-i", str(src), "-map", "0:v:0"] + (["-map", "0:a:0"] if p.has_audio else [])
            args += ["-vf", f"scale={w}:{h},format=yuv420p", "-c:v", "libx264", "-preset", "ultrafast",
                     "-crf", "30", "-g", "15", "-movflags", "+faststart"]
            args += (["-c:a", "aac", "-b:a", "64k"] if p.has_audio else []) + [str(proxy)]
            await run_ffmpeg(args, duration=p.duration, on_progress=rep.progress)
            video_url = media_url((await _register(proxy, "preview", "video/mp4", job.session_id)).id)
        count = 40
        times = [p.duration * (i + 0.5) / count for i in range(count)]
        sprite_path = out_dir / "strip.jpg"
        sprite = await grab_frames_sprite(str(src), sprite_path, times, p.width, p.height)
        fs = await _register(sprite_path, "strip", "image/jpeg", job.session_id)
        return {"videoUrl": video_url, "duration": p.duration, "width": p.width, "height": p.height,
                "sprite": {"url": media_url(fs.id), **sprite}}

    ref = parse_source_url(pl["url"])
    r = get_redis()
    raw = await r.get(preview_cache_key(ref.url))
    if raw:
        cached = json.loads(raw)
        if storage.path(cached["key"]).exists():
            return cached["result"]
    await rep.stage("download", 0.01)
    rep.span(0.01, 0.85)
    src = await ytdlp.download(ref, out_dir, start=None, end=None, quality=720, on_progress=rep.progress,
                               expected_seconds=20)
    p = await probe(src)
    if not p.has_video:
        raise UserError("В видео нет видеодорожки.", code="no_video")
    await rep.stage("thumbnails", 0.9)
    sprite_path = out_dir / "strip.jpg"
    sprite = await make_sprite(src, sprite_path, p, max_count=60)
    fv = await _register(src, "preview", "video/mp4", job.session_id)
    fs = await _register(sprite_path, "strip", "image/jpeg", job.session_id)
    result = {"videoUrl": media_url(fv.id), "duration": p.duration, "width": p.width, "height": p.height,
              "sprite": {"url": media_url(fs.id), **sprite}}
    await r.set(preview_cache_key(ref.url),
                json.dumps({"key": storage.key(src), "result": result,
                            "quality": quality_class(p.width, p.height)}),
                ex=int(get_settings().file_ttl_hours * 3600 * 0.9))
    return result


# --------------------------------------------------------------------------- strip for long streams (Twitch VOD)
async def task_strip(job: Job, rep: JobReporter) -> dict:
    pl = job.payload
    info = await cached_info(pl["url"])
    stream = ytdlp.stream_url(info)
    if not stream:
        raise UserError("Не удалось получить кадры превью.", code="strip_failed")
    start, end, count = float(pl["start"]), float(pl["end"]), int(pl["count"])
    times = [start + (end - start) * (i + 0.5) / count for i in range(count)]
    out_dir = get_storage().new_dir("previews")
    await rep.stage("thumbnails", 0.1)
    sprite = await grab_frames_sprite(stream, out_dir / "strip.jpg", times, int(info.get("width") or 16),
                                      int(info.get("height") or 9), timeout=60)
    fs = await _register(out_dir / "strip.jpg", "strip", "image/jpeg", job.session_id)
    return {"sprite": {"url": media_url(fs.id), **sprite}}


# --------------------------------------------------------------------------- transcription
async def task_transcribe(job: Job, rep: JobReporter) -> dict:
    storage = get_storage()
    async with sessionmaker()() as db:
        project = await db.get(Project, job.project_id)
        if project is None or project.status != "ready":
            raise UserError("Видео ещё не готово.", code="not_ready")
        original = storage.path(project.internal["original"])
        duration = float((project.media or {}).get("duration") or 0)
        has_audio = bool((project.media or {}).get("hasAudio"))
    if not has_audio:
        raise UserError("В видео нет звука — распознавать нечего.", code="no_audio")
    await rep.stage("audio", 0.02)
    wav = original.parent / "audio16k.wav"
    await run_ffmpeg(["-i", str(original), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(wav)])
    await rep.stage("model", 0.05)
    language = job.payload.get("language") or "auto"
    rep.span(0.08, 0.98)

    async def on_progress(frac: float) -> None:
        if job.stage != "recognize":
            await rep.stage("recognize")
        await rep.progress(frac)

    try:
        result = await transcribe(wav, None if language == "auto" else language, duration, on_progress)
    except ModelError as exc:
        raise UserError(str(exc), code="whisper_unavailable") from exc
    except MemoryError as exc:
        raise UserError("Серверу не хватает памяти для распознавания речи. Укажите WHISPER_MODEL=base в .env.",
                        code="whisper_memory") from exc
    finally:
        wav.unlink(missing_ok=True)
    words = result["words"]
    if not words:
        raise UserError("Речь не распознана. Попробуйте выбрать язык вручную.", code="no_speech")
    lines = [{"id": new_id(6), "words": ws} for ws in group_words(words)]
    async with sessionmaker()() as db:
        project = await db.get(Project, job.project_id)
        if project is not None:
            doc = dict(project.doc or {})
            subs = dict(doc.get("subtitles") or {})
            subs.update({"words": words, "lines": lines, "enabled": True})
            doc["subtitles"] = subs
            project.doc = ProjectDoc.model_validate(doc).model_dump(mode="json")
            project.revision += 1
            project.updated_at = utcnow()
            await db.commit()
    return {"language": result["language"], "words": words, "lines": lines}


# --------------------------------------------------------------------------- render
async def task_render(job: Job, rep: JobReporter) -> dict:
    s = get_settings()
    storage = get_storage()
    doc = ProjectDoc.model_validate(job.payload["doc"])
    async with sessionmaker()() as db:
        project = await db.get(Project, job.project_id)
        if project is None or project.status != "ready":
            raise UserError("Видео ещё не готово.", code="not_ready")
        original = storage.path(project.internal["original"])
        title = project.title
        asset_rows = {}
        ids = {b.assetId for b in doc.banners}
        if ids:
            rows = (await db.execute(select(Asset).where(Asset.id.in_(ids), Asset.session_id == job.session_id))).scalars()
            for a in rows:
                if a.status != "ready" or not a.file_id:
                    continue
                f = await db.get(StoredFile, a.file_id)
                if f is not None:
                    asset_rows[a.id] = AssetInfo(storage.path(f.path), a.kind, a.width, a.height)
                a.last_used_at = utcnow()
            await db.commit()
    missing = ids - set(asset_rows)
    if missing:
        doc = doc.model_copy(update={"banners": [b for b in doc.banners if b.assetId not in missing]})

    await rep.stage("prepare", 0.01)
    p = await probe(original)
    src = SourceInfo(original, p.width, p.height, p.fps, p.fps_str, p.duration, p.has_audio)
    out_dir = storage.new_dir("renders")
    ass_path = None
    subs = doc.subtitles
    if subs.enabled and subs.lines:
        ass_path = out_dir / "subtitles.ass"
        ass_path.write_text(build_ass(subs.lines, doc.cuts, subs.style, frame_size(doc.aspect), s.fonts_dir),
                            encoding="utf-8")
    output = out_dir / "bannerka.mp4"
    plan = build_render(doc, src, asset_rows, output, ass_path, s.fonts_dir, s.render_preset, s.render_threads)
    (out_dir / "filter.txt").write_text(plan.filter_complex)
    await rep.stage("render", 0.02)
    t0 = time.monotonic()
    # pre-keyed banners are independent of each other: run them side by side
    await asyncio.gather(*(run_ffmpeg(cmd) for cmd in plan.prepare))
    rep.span(0.05 if plan.prepare else 0.02, 0.99)
    await run_ffmpeg(plan.args, duration=plan.duration, on_progress=rep.progress)
    for cmd in plan.prepare:
        Path(cmd[-1]).unlink(missing_ok=True)
    log.info("job %s: rendered %.0fs %dx%d in %.1fs", job.id, plan.duration, plan.width, plan.height,
             time.monotonic() - t0)
    safe_title = "".join(ch for ch in title if ch.isalnum() or ch in " -_")[:60].strip() or "bannerka"
    name = f"{safe_title} {datetime.now().strftime('%Y-%m-%d %H-%M')}.mp4"
    f = await _register(output, "render", "video/mp4", job.session_id, name=name)
    return {"fileId": f.id, "url": download_url(f.id), "mediaUrl": media_url(f.id), "size": f.size,
            "width": plan.width, "height": plan.height, "duration": round(plan.duration, 3), "name": name}


# --------------------------------------------------------------------------- video banner processing
async def task_asset(job: Job, rep: JobReporter) -> dict:
    storage = get_storage()
    pl = job.payload
    src = storage.path(pl["uploadKey"])
    out_dir = src.parent
    await rep.stage("convert", 0.02)
    rep.span(0.02, 0.97)
    try:
        res = await process_video(src, out_dir, on_progress=rep.progress)
    except UserError as exc:
        await _asset_failed(pl["assetId"], exc.message)
        raise
    except Exception:
        await _asset_failed(pl["assetId"], GENERIC_ERRORS["asset"])
        raise
    src.unlink(missing_ok=True)
    fr = await _register(res["render"], "asset", res["renderMime"], job.session_id, permanent=True)
    ft = await _register(res["thumb"], "asset-thumb", "image/jpeg", job.session_id, permanent=True)
    async with sessionmaker()() as db:
        a = await db.get(Asset, pl["assetId"])
        if a is None:
            return {}
        a.file_id = a.preview_file_id = fr.id
        a.thumb_file_id = ft.id
        a.width, a.height, a.duration = res["width"], res["height"], res["duration"]
        a.status = "ready"
        await db.commit()
        from ..services.projects import asset_public

        return {"asset": asset_public(a)}


async def _asset_failed(asset_id: str, message: str) -> None:
    async with sessionmaker()() as db:
        a = await db.get(Asset, asset_id)
        if a is not None:
            a.status, a.error = "error", message
            await db.commit()


HANDLERS = {
    "download": task_download,
    "preview": task_preview,
    "strip": task_strip,
    "transcribe": task_transcribe,
    "render": task_render,
    "asset": task_asset,
}


async def _mark_project_failed(job: Job, message: str) -> None:
    if job.kind != "download" or not job.project_id:
        return
    async with sessionmaker()() as db:
        project = await db.get(Project, job.project_id)
        if project is not None:
            project.status, project.error = "error", message
            await db.commit()


async def run_job(ctx: dict, job_id: str) -> None:
    async with sessionmaker()() as db:
        job = await db.get(Job, job_id)
    if job is None or job.status in ("canceled", "done"):
        return
    rep = JobReporter(job)
    await rep.stage("starting", 0.0)
    try:
        result = await HANDLERS[job.kind](job, rep)
        await rep.done(result)
    except UserError as exc:
        await rep.fail(exc.message)
        await _mark_project_failed(job, exc.message)
    except asyncio.CancelledError:
        await rep.fail("Задача отменена.", status="canceled")
        await _mark_project_failed(job, "Скачивание отменено.")
        raise
    except FFmpegError as exc:
        log.error("job %s (%s) ffmpeg failed: %s\n%s", job.id, job.kind, exc, exc.stderr)
        msg = GENERIC_ERRORS.get(job.kind, "Ошибка обработки.")
        await rep.fail(msg)
        await _mark_project_failed(job, msg)
    except Exception as exc:  # noqa: BLE001
        log.exception("job %s (%s) failed", job.id, job.kind)
        # the class name lets a screenshot point at the cause; details are in the worker log
        msg = f"{GENERIC_ERRORS.get(job.kind, 'Ошибка обработки.')} ({type(exc).__name__})"
        await rep.fail(msg)
        await _mark_project_failed(job, msg)


# --------------------------------------------------------------------------- cleanup
async def cleanup(ctx: dict | None = None) -> dict:
    """Delete files older than FILE_TTL_HOURS (projects: since last activity)."""
    s = get_settings()
    storage = get_storage()
    now = utcnow()
    removed = {"files": 0, "projects": 0, "assets": 0, "jobs": 0}
    async with sessionmaker()() as db:
        old_projects = (await db.execute(
            select(Project).where(Project.updated_at < now - timedelta(hours=s.file_ttl_hours))
        )).scalars().all()
        for p in old_projects:
            internal = p.internal or {}
            if internal.get("dir"):
                storage.delete(internal["dir"])
            for fid in internal.get("files", []):
                await db.execute(delete(StoredFile).where(StoredFile.id == fid))
            await db.delete(p)
            removed["projects"] += 1
        old_assets = (await db.execute(
            select(Asset).where(Asset.last_used_at < now - timedelta(hours=s.asset_ttl_hours))
        )).scalars().all()
        for a in old_assets:
            for fid in {a.file_id, a.preview_file_id, a.thumb_file_id} - {None}:
                f = await db.get(StoredFile, fid)
                if f is not None:
                    storage.delete(str(Path(f.path).parent))
                    await db.delete(f)
            await db.delete(a)
            removed["assets"] += 1
        expired = (await db.execute(
            select(StoredFile).where(StoredFile.expires_at.is_not(None), StoredFile.expires_at < now)
        )).scalars().all()
        for f in expired:
            storage.delete(f.path)
            await db.delete(f)
            removed["files"] += 1
        res = await db.execute(delete(Job).where(Job.created_at < now - timedelta(hours=s.file_ttl_hours * 2)))
        removed["jobs"] = res.rowcount or 0
        await db.commit()
    # empty date folders
    for kind_dir in storage.root.iterdir():
        if not kind_dir.is_dir() or kind_dir.name == "models":
            continue
        for day in kind_dir.iterdir():
            if day.is_dir():
                for d in day.iterdir():
                    if d.is_dir() and not any(d.iterdir()):
                        d.rmdir()
                if not any(day.iterdir()):
                    day.rmdir()
    if any(removed.values()):
        log.info("cleanup: %s", removed)
    return removed


async def recover_stale_jobs() -> None:
    """Jobs left 'running' by a crashed worker are marked as failed on startup."""
    async with sessionmaker()() as db:
        rows = (await db.execute(select(Job).where(Job.status == "running"))).scalars().all()
        for job in rows:
            job.status, job.stage, job.error = "error", "error", "Задача прервана перезапуском сервера."
            await publish(job_public(job))
            if job.kind == "download" and job.project_id:
                project = await db.get(Project, job.project_id)
                if project is not None and project.status == "downloading":
                    project.status, project.error = "error", job.error
        await db.commit()


async def startup(ctx: dict) -> None:
    if not logging.getLogger("bannerka").handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
        logging.getLogger("bannerka").addHandler(handler)
        logging.getLogger("bannerka").setLevel(logging.INFO)
    await init_db()
    await recover_stale_jobs()


class WorkerSettings:
    functions = [run_job]
    cron_jobs = [cron(cleanup, minute={7, 37}, run_at_startup=True)]
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url)
    max_jobs = get_settings().worker_max_jobs
    job_timeout = 3 * 3600
    allow_abort_jobs = True
    keep_result = 60
    on_startup = startup
