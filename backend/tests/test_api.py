import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image


@pytest.fixture
def client(env, monkeypatch):
    from app import main
    from app.services import ytdlp

    async def fake_info(ref, timeout=60):
        return {"title": "Тестовое видео", "duration": 600, "width": 1920, "height": 1080,
                "thumbnail": "https://i.ytimg.com/x.jpg", "formats": []}

    monkeypatch.setattr(ytdlp, "fetch_info", fake_info)
    with TestClient(main.app) as c:
        yield c


def test_health_and_config(client):
    assert client.get("/api/health").json()["ok"] is True
    cfg = client.get("/api/config").json()
    assert cfg["maxClipSeconds"] == 180 and any(lang["code"] == "ru" for lang in cfg["languages"])


def test_session_cookie_is_set(client):
    r = client.get("/api/projects")
    assert r.status_code == 200 and r.json() == {"projects": []}
    assert "bk_sid" in client.cookies


def test_resolve_rejects_foreign_domains_in_russian(client):
    r = client.post("/api/source/resolve", json={"url": "https://evil.example.com/watch?v=dQw4w9WgXcQ"})
    assert r.status_code == 400
    body = r.json()["error"]
    assert body["code"] == "bad_url" and "YouTube" in body["message"]


def test_resolve_youtube(client):
    r = client.post("/api/source/resolve", json={"url": "Смотри https://youtu.be/dQw4w9WgXcQ?t=42"})
    assert r.status_code == 200
    s = r.json()
    assert s["platform"] == "youtube" and s["player"] == {"type": "youtube", "id": "dQw4w9WgXcQ"}
    assert s["startHint"] == 42 and s["title"] == "Тестовое видео"


def test_create_project_enqueues_download_and_validates_limit(client, env):
    r = client.post("/api/projects", json={"url": "https://youtu.be/dQw4w9WgXcQ", "start": 10, "end": 70})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["project"]["status"] == "downloading"
    assert env["arq"].calls[-1][0] == ("run_job", data["jobId"])
    job = client.get(f"/api/jobs/{data['jobId']}").json()
    assert job["kind"] == "download" and job["status"] == "queued"

    too_long = client.post("/api/projects", json={"url": "https://youtu.be/dQw4w9WgXcQ", "start": 0, "end": 400})
    assert too_long.status_code == 400 and too_long.json()["error"]["code"] == "range_too_long"


def test_parallel_job_limit(client):
    for _ in range(3):
        assert client.post("/api/projects", json={"url": "https://youtu.be/dQw4w9WgXcQ", "start": 0, "end": 5}).status_code == 200
    r = client.post("/api/projects", json={"url": "https://youtu.be/dQw4w9WgXcQ", "start": 0, "end": 5})
    assert r.status_code == 429 and r.json()["error"]["code"] == "too_many_jobs"


def test_projects_are_private_to_the_session(client, env):
    from app import main

    pid = client.post("/api/projects", json={"url": "https://youtu.be/dQw4w9WgXcQ", "start": 0, "end": 5}).json()["project"]["id"]
    assert client.get(f"/api/projects/{pid}").status_code == 200
    with TestClient(main.app) as other:
        assert other.get(f"/api/projects/{pid}").status_code == 404


def test_patch_validation_message(client):
    pid = client.post("/api/projects", json={"url": "https://youtu.be/dQw4w9WgXcQ", "start": 0, "end": 5}).json()["project"]["id"]
    r = client.patch(f"/api/projects/{pid}", json={"doc": {"aspect": "3:2"}})
    assert r.status_code == 422 and r.json()["error"]["message"] == "Некорректные данные запроса."


def png_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("RGBA", (300, 100), (166, 226, 46, 200)).save(buf, "PNG")
    return buf.getvalue()


def test_asset_upload_library_and_media_range(client):
    r = client.post("/api/assets", files={"file": ("banner.png", png_bytes(), "image/png")})
    assert r.status_code == 200, r.text
    asset = r.json()["asset"]
    assert asset["kind"] == "image" and asset["width"] == 300 and asset["status"] == "ready"
    assert [a["id"] for a in client.get("/api/assets").json()["assets"]] == [asset["id"]]
    media = client.get(asset["url"], headers={"Range": "bytes=0-9"})
    assert media.status_code == 206 and len(media.content) == 10
    assert client.delete(f"/api/assets/{asset['id']}").json() == {"ok": True}
    assert client.get("/api/assets").json()["assets"] == []


def test_asset_upload_rejects_fake_types(client):
    r = client.post("/api/assets", files={"file": ("evil.png", b"#!/bin/sh\necho pwned\n" * 10, "image/png")})
    assert r.status_code == 415 and r.json()["error"]["code"] == "bad_type"


def test_text_banner_spec_is_kept(client):
    pid = client.post("/api/projects", json={"url": "https://youtu.be/dQw4w9WgXcQ", "start": 0, "end": 5}).json()["project"]["id"]
    text = {"content": "Скидка 50%\nсегодня", "preset": "plate", "font": "montserrat", "weight": 900, "box": True,
            "boxColor": "#FFFFFF", "renderFont": 152, "renderHeight": 410}
    doc = {"aspect": "9:16", "cuts": [{"id": "c", "start": 0, "end": 5}],
           "banners": [{"id": "t1", "assetId": "local-abc123", "x": 0.2, "y": 0.4, "w": 0.6, "h": 0.1,
                        "start": 0, "end": 3, "text": text}]}
    assert client.patch(f"/api/projects/{pid}", json={"doc": doc}).status_code == 200
    saved = client.get(f"/api/projects/{pid}").json()["banners"][0]["text"]
    assert saved["content"] == "Скидка 50%\nсегодня" and saved["box"] is True and saved["renderHeight"] == 410


def test_raw_body_upload_streams_into_storage(client, env, monkeypatch):
    # the app sends files as the raw request body: no multipart spooling
    name = "%D0%91%D0%B0%D0%BD%D0%BD%D0%B5%D1%80.png"  # "Баннер.png", URL-encoded
    r = client.post("/api/assets", content=png_bytes(), headers={"Content-Type": "image/png", "X-Filename": name})
    assert r.status_code == 200, r.text
    assert r.json()["asset"]["name"] == "Баннер.png" and r.json()["asset"]["width"] == 300
    bad = client.post("/api/assets", content=b"#!/bin/sh\necho pwned\n" * 10, headers={"X-Filename": "x.png"})
    assert bad.status_code == 415
    from app import config

    monkeypatch.setenv("MAX_BANNER_MB", "0")
    config.get_settings.cache_clear()
    big = client.post("/api/assets", content=png_bytes(), headers={"X-Filename": "b.png"})
    assert big.status_code == 413 and big.json()["error"]["code"] == "too_large"
    leftovers = [p for p in (env["tmp"] / "storage" / "assets").rglob("upload.*")] if (env["tmp"] / "storage").exists() else []
    assert len(leftovers) <= 1  # only the accepted banner's file remains


def test_unknown_file_id(client):
    assert client.get("/api/files/doesnotexist123").status_code == 404
    assert client.get("/api/media/../../etc/passwd").status_code == 404
