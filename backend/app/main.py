from __future__ import annotations

import logging
import secrets
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from .api import assets, files, jobs, projects, source
from .config import get_settings
from .db import Session, dispose_db, init_db, sessionmaker
from .jobs import close_redis, get_redis
from .services.errors import UserError

log = logging.getLogger("bannerka")
COOKIE = "bk_sid"
NO_RATE_LIMIT = ("/api/media/", "/api/files/", "/api/health")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    await init_db()
    yield
    await close_redis()
    await dispose_db()


app = FastAPI(title="Bannerka API", version="1.0.0", lifespan=lifespan, docs_url="/api/docs",
              openapi_url="/api/openapi.json")

settings = get_settings()
if settings.cors_origins:
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=True,
                       allow_methods=["*"], allow_headers=["*"])


def _valid_sid(value: str | None) -> bool:
    return bool(value) and 20 <= len(value) <= 64 and value.replace("-", "").replace("_", "").isalnum()


@app.middleware("http")
async def session_and_rate_limit(request: Request, call_next):
    path = request.url.path
    if not path.startswith("/api/"):
        return await call_next(request)
    sid = request.cookies.get(COOKIE)
    is_new = not _valid_sid(sid)
    if is_new:
        sid = secrets.token_urlsafe(24)
        try:
            async with sessionmaker()() as db:
                db.add(Session(id=sid))
                await db.commit()
        except Exception:  # noqa: BLE001 - never fail a request because of bookkeeping
            log.exception("could not store session")
    request.state.session_id = sid

    limit = get_settings().rate_limit_per_minute
    if limit and not path.startswith(NO_RATE_LIMIT) and not path.endswith("/events"):
        try:
            key = f"bk:rl:{sid}:{int(time.time() // 60)}"
            r = get_redis()
            count = await r.incr(key)
            if count == 1:
                await r.expire(key, 90)
            if count > limit:
                return JSONResponse(
                    {"error": {"code": "rate_limited", "message": "Слишком много запросов. Подождите минуту."}},
                    status_code=429,
                )
        except Exception:  # noqa: BLE001 - Redis down: fail open
            pass

    response = await call_next(request)
    if is_new:
        response.set_cookie(
            COOKIE, sid, max_age=365 * 24 * 3600, httponly=True, samesite="lax",
            secure=get_settings().cookie_secure, path="/",
        )
    return response


@app.exception_handler(UserError)
async def user_error_handler(_request: Request, exc: UserError) -> JSONResponse:
    return JSONResponse({"error": {"code": exc.code, "message": exc.message}}, status_code=exc.status)


@app.exception_handler(RequestValidationError)
async def validation_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
    details = [{"loc": list(e.get("loc", [])), "msg": e.get("msg", "")} for e in exc.errors()][:10]
    return JSONResponse(
        {"error": {"code": "validation", "message": "Некорректные данные запроса.", "details": details}},
        status_code=422,
    )


@app.get("/api/health")
async def health() -> dict:
    redis_ok = True
    try:
        await get_redis().ping()
    except Exception:  # noqa: BLE001
        redis_ok = False
    return {"ok": True, "redis": redis_ok}


@app.get("/api/config")
async def config() -> dict:
    s = get_settings()
    return {
        "maxClipSeconds": s.max_clip_seconds,
        "maxBannerMb": s.max_banner_mb,
        "maxUploadMb": s.max_upload_mb,
        "languages": [
            {"code": "auto", "name": "Автоопределение"},
            {"code": "ru", "name": "Русский"},
            {"code": "en", "name": "English"},
            {"code": "uk", "name": "Українська"},
            {"code": "kk", "name": "Қазақша"},
            {"code": "de", "name": "Deutsch"},
            {"code": "es", "name": "Español"},
        ],
    }


class ClientError(BaseModel):
    message: str = Field("", max_length=500)
    stack: str = Field("", max_length=2000)
    context: str = Field("", max_length=100)
    url: str = Field("", max_length=300)


@app.post("/api/client-log", status_code=204)
async def client_log(body: ClientError, request: Request) -> Response:
    """Errors from browsers end up here: the only trace of what broke on a phone."""
    ua = request.headers.get("user-agent", "")[:200]
    log.warning("client error [%s] %s at %s | %s\n%s", body.context, body.message, body.url, ua, body.stack)
    return Response(status_code=204)


for r in (source.router, projects.router, assets.router, jobs.router, files.router):
    app.include_router(r, prefix="/api")
