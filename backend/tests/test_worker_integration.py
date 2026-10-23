"""Worker pipeline with real ffmpeg (yt-dlp mocked): download → proxy/thumbnails → render."""

import json
import shutil
import subprocess

import pytest
from sqlalchemy import select

from .conftest import HAS_FFMPEG, make_video

pytestmark = [pytest.mark.ffmpeg, pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg not installed")]


def ffprobe(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
                         capture_output=True, check=True).stdout
    return json.loads(out)


async def test_download_and_render(env, monkeypatch):
    from app.db import Job, Project, init_db, sessionmaker
    from app.jobs import create_job
    from app.services import ytdlp
    from app.services.storage import get_storage
    from app.worker import tasks

    await init_db()
    source = make_video(env["tmp"] / "remote.mp4", seconds=6)

    async def fake_download(ref, out_dir, *, start, end, max_short, on_progress=None, expected_seconds=60):
        assert (start, end) == (1.0, 5.0) and ref.platform == "youtube"
        if on_progress:
            await on_progress(0.5)
        dst = out_dir / "source.mp4"
        shutil.copy(source, dst)
        return dst

    monkeypatch.setattr(ytdlp, "download", fake_download)

    async with sessionmaker()() as db:
        db.add(Project(id="p1", session_id="s1", title="Тест", platform="youtube",
                       source_url="https://www.youtube.com/watch?v=dQw4w9WgXcQ", source_start=1, source_end=5, doc={}))
        await db.commit()
        job = await create_job(db, session_id="s1", kind="download", project_id="p1",
                               payload={"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "start": 1.0, "end": 5.0})
    await tasks.run_job({}, job.id)

    async with sessionmaker()() as db:
        job = await db.get(Job, job.id)
        project = await db.get(Project, "p1")
        assert job.status == "done", job.error
        assert project.status == "ready"
        media = project.media
        assert media["width"] == 640 and media["hasAudio"] is True
        assert media["thumbnails"]["count"] >= 1 and media["proxyUrl"].startswith("/api/media/")
        assert project.doc["cuts"][0]["start"] == 0 and project.doc["aspect"] == "16:9"

    # render a 9:16 export with two cuts, an image banner and subtitles
    from PIL import Image

    from app.db import Asset, StoredFile

    storage = get_storage()
    asset_dir = storage.new_dir("assets")
    Image.new("RGBA", (300, 100), (166, 226, 46, 255)).save(asset_dir / "banner.png")
    async with sessionmaker()() as db:
        f = await storage.register(db, asset_dir / "banner.png", kind="asset", mime="image/png", session_id="s1")
        db.add(Asset(id="a1", session_id="s1", kind="image", name="b.png", mime="image/png", width=300, height=100,
                     file_id=f.id, preview_file_id=f.id, thumb_file_id=f.id))
        await db.commit()
        doc = dict(project.doc)
        doc.update({
            "aspect": "9:16",
            "cuts": [{"id": "a", "start": 0, "end": 1.5}, {"id": "b", "start": 2.5, "end": 4}],
            "banners": [{"id": "b1", "assetId": "a1", "x": 0.1, "y": 0.1, "w": 0.8, "h": 0.15, "start": 0.2, "end": 2.5,
                         "animIn": "slide-up", "animOut": "scale"}],
            "export": {"quality": "720p", "fps": 30},
        })
        doc["subtitles"]["lines"] = [{"id": "l", "words": [{"text": "Проверка", "start": 0.1, "end": 0.8},
                                                            {"text": "рендера", "start": 0.9, "end": 1.4}]}]
        render = await create_job(db, session_id="s1", kind="render", project_id="p1", payload={"doc": doc})
    await tasks.run_job({}, render.id)

    async with sessionmaker()() as db:
        render = await db.get(Job, render.id)
        assert render.status == "done", render.error
        out = await db.get(StoredFile, render.result["fileId"])
        info = ffprobe(storage.path(out.path))
    v = next(s for s in info["streams"] if s["codec_type"] == "video")
    a = next(s for s in info["streams"] if s["codec_type"] == "audio")
    assert (v["width"], v["height"]) == (720, 1280)
    assert v["codec_name"] == "h264" and a["codec_name"] == "aac"
    assert float(info["format"]["duration"]) == pytest.approx(3.0, abs=0.1)
    assert render.result["url"].startswith("/api/files/")


async def test_cleanup_removes_expired(env):
    from datetime import timedelta

    from app.db import Project, StoredFile, init_db, sessionmaker, utcnow
    from app.services.storage import get_storage
    from app.worker.tasks import cleanup

    await init_db()
    storage = get_storage()
    d = storage.new_dir("renders")
    (d / "x.mp4").write_bytes(b"0" * 100)
    pdir = storage.new_dir("projects")
    (pdir / "original.mp4").write_bytes(b"0")
    async with sessionmaker()() as db:
        f = await storage.register(db, d / "x.mp4", kind="render", mime="video/mp4", session_id="s")
        f.expires_at = utcnow() - timedelta(minutes=1)
        db.add(Project(id="old", session_id="s", title="", platform="upload", doc={},
                       internal={"dir": storage.key(pdir), "files": []}, updated_at=utcnow() - timedelta(hours=30)))
        await db.commit()
    removed = await cleanup()
    assert removed["files"] == 1 and removed["projects"] == 1
    assert not (d / "x.mp4").exists() and not pdir.exists()
    async with sessionmaker()() as db:
        assert (await db.execute(select(StoredFile))).scalars().all() == []


async def test_transcribe_job(env, monkeypatch):
    from app.db import Job, Project, init_db, sessionmaker
    from app.jobs import create_job
    from app.services import ytdlp
    from app.worker import tasks
    from app.worker.transcribe import ModelError

    await init_db()
    source = make_video(env["tmp"] / "remote.mp4", seconds=3)

    async def fake_download(ref, out_dir, **_kw):
        dst = out_dir / "source.mp4"
        shutil.copy(source, dst)
        return dst

    monkeypatch.setattr(ytdlp, "download", fake_download)
    url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    async with sessionmaker()() as db:
        db.add(Project(id="p2", session_id="s1", title="Речь", platform="youtube", source_url=url,
                       source_start=0, source_end=3, doc={}))
        await db.commit()
        job = await create_job(db, session_id="s1", kind="download", project_id="p2",
                               payload={"url": url, "start": 0.0, "end": 3.0})
    await tasks.run_job({}, job.id)

    async def run_transcribe() -> Job:
        async with sessionmaker()() as db:
            j = await create_job(db, session_id="s1", kind="transcribe", project_id="p2", payload={"language": "ru"})
        await tasks.run_job({}, j.id)
        async with sessionmaker()() as db:
            return await db.get(Job, j.id)

    # a missing model reaches the user as an explanation, not a generic error
    async def no_model(*_a, **_kw):
        raise ModelError("Не удалось скачать модель распознавания речи «small».")

    monkeypatch.setattr(tasks, "transcribe", no_model)
    failed = await run_transcribe()
    assert failed.status == "error" and "скачать модель" in failed.error

    async def boom(*_a, **_kw):
        raise RuntimeError("ctranslate2 exploded")

    monkeypatch.setattr(tasks, "transcribe", boom)
    failed = await run_transcribe()
    assert failed.error == "Не удалось распознать речь. (RuntimeError)"

    async def fake_transcribe(wav, language, duration, on_progress):
        assert wav.exists() and language == "ru"
        await on_progress(0.5)
        return {"language": "ru", "words": [{"text": "Привет", "start": 0.2, "end": 0.6},
                                            {"text": "мир.", "start": 0.7, "end": 1.1}]}

    monkeypatch.setattr(tasks, "transcribe", fake_transcribe)
    done = await run_transcribe()
    assert done.status == "done", done.error
    async with sessionmaker()() as db:
        project = await db.get(Project, "p2")
    words = [w["text"] for line in project.doc["subtitles"]["lines"] for w in line["words"]]
    assert words == ["Привет", "мир."]
