"""yt-dlp integration: metadata, storyboards, section download.

yt-dlp runs as a subprocess. The only user-derived argument is the URL, which
was validated and normalised by ``urls.parse_source_url`` and is passed after
``--`` so it can never be interpreted as an option."""

from __future__ import annotations

import asyncio
import json
import re
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from ..config import get_settings
from .errors import UserError
from .quality import quality_class
from .urls import SourceRef

ERROR_MAP: list[tuple[re.Pattern[str], str, str]] = [
    (re.compile(r"private video|is private|this account is private", re.I),
     "Это приватное видео — доступ к нему ограничен.", "private"),
    (re.compile(r"confirm (?:you(?:’|')re|that you are|you are) not a bot", re.I),
     "Платформа временно ограничила доступ серверу. Попробуйте позже.", "bot_check"),
    (re.compile(r"confirm your age|age[- ]restricted|inappropriate for some users", re.I),
     "У видео возрастное ограничение — скачать его без входа в аккаунт нельзя.", "age"),
    (re.compile(r"available in your country|geo.?restrict|blocked it in your country|not available from your location", re.I),
     "Видео заблокировано в регионе сервера.", "geo"),
    (re.compile(r"members[- ]only|join this channel|subscriber[- ]only|only available to subscribers", re.I),
     "Видео доступно только платным подписчикам канала.", "members"),
    (re.compile(r"live event will begin|premieres in|is (?:currently )?live|live stream|is_live|currently live", re.I),
     "Прямые трансляции не поддерживаются. Дождитесь окончания эфира и вставьте ссылку на запись.", "live"),
    (re.compile(r"video unavailable|has been removed|no longer available|does not exist|not found|http error 404|"
                r"unable to find video|status code 10204|video currently unavailable", re.I),
     "Видео недоступно или удалено.", "unavailable"),
    (re.compile(r"unsupported url", re.I), "Ссылка не поддерживается.", "bad_url"),
    (re.compile(r"timed? ?out|temporary failure|connection (?:reset|refused)|name resolution", re.I),
     "Платформа не ответила вовремя. Попробуйте ещё раз.", "network"),
]
DEFAULT_ERROR = "Не удалось получить видео. Проверьте ссылку и попробуйте снова."


def map_error(stderr: str) -> UserError:
    for pattern, message, code in ERROR_MAP:
        if pattern.search(stderr):
            return UserError(message, code=code, status=422)
    return UserError(DEFAULT_ERROR, code="download_failed", status=422)


def _base_args() -> list[str]:
    s = get_settings()
    args = [s.ytdlp_bin, "--no-playlist", "--no-warnings", "--ignore-config", "--no-cache-dir",
            "--socket-timeout", "20", "--retries", "3"]
    if s.ytdlp_cookies_file and Path(s.ytdlp_cookies_file).exists():
        args += ["--cookies", str(s.ytdlp_cookies_file)]
    return args


async def _run(args: list[str], timeout: float) -> tuple[int, str, str]:
    proc = await asyncio.create_subprocess_exec(
        *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout)
    except TimeoutError:
        proc.kill()
        await proc.wait()
        raise UserError("Платформа не ответила вовремя. Попробуйте ещё раз.", code="network", status=504) from None
    except asyncio.CancelledError:
        proc.kill()
        raise
    return proc.returncode or 0, out.decode(errors="replace"), err.decode(errors="replace")


async def fetch_info(ref: SourceRef, timeout: float = 60) -> dict[str, Any]:
    code, out, err = await _run([*_base_args(), "-J", "--skip-download", "--", ref.url], timeout)
    if code != 0 or not out.strip():
        raise map_error(err)
    try:
        info = json.loads(out)
    except json.JSONDecodeError as exc:
        raise UserError(DEFAULT_ERROR, code="download_failed", status=422) from exc
    if info.get("is_live") or info.get("live_status") in ("is_live", "is_upcoming", "post_live"):
        raise UserError(
            "Прямые трансляции не поддерживаются. Дождитесь окончания эфира и вставьте ссылку на запись.",
            code="live", status=422,
        )
    return info


def storyboards(info: dict[str, Any]) -> list[dict]:
    """YouTube storyboard sprites (``sb0``...) → generic sprite list for the strip."""
    boards = [
        f for f in info.get("formats") or []
        if f.get("format_note") == "storyboard" or str(f.get("format_id", "")).startswith("sb")
    ]
    boards = [b for b in boards if b.get("fragments") and b.get("columns") and b.get("rows")]
    if not boards:
        return []
    best = max(boards, key=lambda b: (b.get("width") or 0) * (b.get("height") or 0))
    fps = float(best.get("fps") or 0) or 0.5
    interval = 1.0 / fps
    sprites = []
    t = 0.0
    per_sprite = int(best["columns"]) * int(best["rows"])
    for frag in best["fragments"]:
        dur = float(frag.get("duration") or per_sprite * interval)
        url = frag.get("url") or ""
        if not url.startswith("https://"):
            continue
        sprites.append({
            "url": url,
            "columns": int(best["columns"]),
            "rows": int(best["rows"]),
            "count": max(1, min(per_sprite, round(dur / interval))),
            "start": round(t, 3),
            "interval": interval,
            "tileWidth": int(best.get("width") or 160),
            "tileHeight": int(best.get("height") or 90),
        })
        t += dur
    return sprites


def qualities(info: dict[str, Any], limit: int) -> list[int]:
    """Distinct quality classes of the video formats, best first, up to ``limit``."""
    found = {
        quality_class(int(f.get("width") or 0), int(f.get("height") or 0))
        for f in info.get("formats") or []
        if f.get("vcodec") not in (None, "none") and f.get("format_note") != "storyboard"
    }
    if not found - {0}:
        found = {quality_class(int(info.get("width") or 0), int(info.get("height") or 0))}
    return sorted((q for q in found if 0 < q <= limit), reverse=True)


def format_sort(quality: int) -> str:
    """yt-dlp sort for a quality class: the best format whose short side fits."""
    return f"res:{round(quality * 1.05)},vcodec:h264,acodec:aac"


def summarize(ref: SourceRef, info: dict[str, Any]) -> dict[str, Any]:
    duration = float(info.get("duration") or 0)
    width = int(info.get("width") or 0)
    height = int(info.get("height") or 0)
    if ref.platform == "youtube":
        player = {"type": "youtube", "id": ref.id}
    elif ref.platform == "twitch" and ref.kind == "vod":
        player = {"type": "twitch", "id": ref.id}
    else:
        player = {"type": "video"}  # needs a server-side preview
    return {
        "platform": ref.platform,
        "kind": ref.kind,
        "id": ref.id,
        "url": ref.url,
        "title": (info.get("title") or info.get("fulltitle") or "Видео")[:300],
        "uploader": (info.get("uploader") or info.get("channel") or "")[:200],
        "duration": duration,
        "width": width,
        "height": height,
        "thumbnail": info.get("thumbnail") if str(info.get("thumbnail") or "").startswith("https://") else None,
        "player": player,
        "startHint": ref.start_hint if ref.start_hint < duration else 0,
        "storyboard": storyboards(info) if ref.platform == "youtube" else [],
        "qualities": qualities(info, get_settings().max_quality),
    }


def stream_url(info: dict[str, Any], max_short: int = 360) -> str | None:
    """A direct (or HLS) URL of a small rendition, used to grab strip frames."""
    candidates = []
    for f in info.get("formats") or []:
        if f.get("vcodec") in (None, "none") or not str(f.get("url", "")).startswith("https://"):
            continue
        w, h = f.get("width") or 0, f.get("height") or 0
        short = min(w, h) if w and h else (h or 9999)
        candidates.append((abs(short - max_short), f["url"]))
    return min(candidates)[1] if candidates else None


ProgressCb = Callable[[float], Awaitable[None]]
_PROG = re.compile(r"^BKPROG (\S+) (\S+) (\S+) (\S+)")
# ffmpeg stats line (used by yt-dlp for --download-sections): "... time=00:00:12.34 ..."
_FFTIME = re.compile(r"time=(\d+):(\d+):(\d+(?:\.\d+)?)")
_LINE_SPLIT = re.compile(r"[\r\n]+")


def parse_progress_line(line: str, clip_seconds: float | None) -> float | None:
    """Progress 0..1 from a yt-dlp template line or an ffmpeg stats line."""
    m = _PROG.match(line.strip())
    if m:
        done, total, estimate, _elapsed = (_num(g) for g in m.groups())
        total = total or estimate
        return done / total if total and done else None
    m = _FFTIME.search(line)
    if m and clip_seconds:
        t = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
        return t / clip_seconds
    return None


async def download(
    ref: SourceRef,
    out_dir: Path,
    *,
    start: float | None,
    end: float | None,
    quality: int,
    on_progress: ProgressCb | None = None,
    expected_seconds: float = 60.0,
    info_json: Path | None = None,
) -> Path:
    """Download the whole video or only ``[start, end]`` into ``out_dir/source.mp4``.

    Sections are stream-copied, not re-encoded: ffmpeg seeks to the keyframe
    before ``start`` and the MP4 edit list hides the pre-roll, so every later
    ffmpeg read starts exactly at ``start``. ``info_json`` (the cached ``-J``
    output) skips the second extraction, which on YouTube costs seconds.

    Progress comes from yt-dlp's template (whole files) or ffmpeg's ``time=`` stats
    (sections); when neither reports anything a time-based estimate keeps moving."""
    s = get_settings()
    args = [
        *_base_args(), "--newline", "--no-part", "--no-mtime",
        "-f", "bv*+ba/b",
        "-S", format_sort(quality),
        "--merge-output-format", "mp4",
        "-o", str(out_dir / "source.%(ext)s"),
        "--progress-template",
        "download:BKPROG %(progress.downloaded_bytes)s %(progress.total_bytes)s "
        "%(progress.total_bytes_estimate)s %(progress.elapsed)s",
    ]
    clip = None
    if start is not None and end is not None:
        clip = max(0.5, end - start)
        args += ["--download-sections", f"*{start:.3f}-{end:.3f}"]
    else:
        args += ["--concurrent-fragments", "4"]
    args += ["--load-info-json", str(info_json)] if info_json else ["--", ref.url]
    proc = await asyncio.create_subprocess_exec(
        *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    err_tail: list[str] = []
    state = {"best": 0.0, "real_at": 0.0}
    loop = asyncio.get_running_loop()
    t0 = loop.time()

    async def report(frac: float, real: bool) -> None:
        if real:
            state["real_at"] = loop.time()
        frac = min(0.97, frac)
        if on_progress and frac - state["best"] > 0.01:
            state["best"] = frac
            await on_progress(frac)

    async def read(stream: asyncio.StreamReader, keep: bool) -> None:
        buf = ""
        while chunk := await stream.read(4096):
            buf += chunk.decode(errors="replace")
            *lines, buf = _LINE_SPLIT.split(buf)
            for line in lines:
                if keep and line.strip():
                    err_tail.append(line)
                    del err_tail[:-200]
                frac = parse_progress_line(line, clip)
                if frac is not None:
                    await report(frac, real=True)

    async def estimate() -> None:
        # asymptotic estimate when the tools stay silent (e.g. while seeking a long VOD)
        while True:
            await asyncio.sleep(2)
            if loop.time() - state["real_at"] > 6:
                elapsed = loop.time() - t0
                await report(1 - 1 / (1 + elapsed / max(10.0, expected_seconds)), real=False)

    ticker = asyncio.create_task(estimate())
    try:
        await asyncio.wait_for(asyncio.gather(read(proc.stdout, False), read(proc.stderr, True), proc.wait()),
                               s.ytdlp_timeout)
    except TimeoutError:
        proc.kill()
        await proc.wait()
        raise UserError("Скачивание заняло слишком много времени. Попробуйте отрезок короче.", code="timeout") from None
    except asyncio.CancelledError:
        proc.kill()
        raise
    finally:
        ticker.cancel()
    if proc.returncode != 0:
        raise map_error("\n".join(err_tail))
    files = sorted(out_dir.glob("source.*"), key=lambda p: p.stat().st_size, reverse=True)
    files = [f for f in files if f.suffix in (".mp4", ".mkv", ".webm", ".mov")]
    if not files:
        raise UserError(DEFAULT_ERROR, code="download_failed")
    return files[0]


def _num(v: str) -> float:
    try:
        return float(v)
    except ValueError:
        return 0.0
