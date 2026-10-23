"""Thin async wrappers around ffmpeg/ffprobe.

All arguments are built by the application — user input never reaches the
command line except validated numbers and paths we generated ourselves."""

from __future__ import annotations

import asyncio
import json
import math
import re
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

from ..config import get_settings
from .errors import UserError

ProgressCb = Callable[[float], Awaitable[None] | None]


@dataclass
class Probe:
    duration: float
    width: int
    height: int
    fps: float
    fps_str: str
    has_audio: bool
    has_video: bool
    vcodec: str
    pix_fmt: str
    start_time: float
    rotation: int = 0

    def as_media(self) -> dict:
        return {
            "duration": round(self.duration, 3),
            "width": self.width,
            "height": self.height,
            "fps": round(self.fps, 3),
            "hasAudio": self.has_audio,
        }


class FFmpegError(RuntimeError):
    def __init__(self, message: str, stderr: str = "") -> None:
        super().__init__(message)
        self.stderr = stderr


def _parse_rate(value: str | None) -> float:
    if not value or value in ("0/0", "0"):
        return 0.0
    if "/" in value:
        n, d = value.split("/", 1)
        try:
            return float(n) / float(d) if float(d) else 0.0
        except ValueError:
            return 0.0
    try:
        return float(value)
    except ValueError:
        return 0.0


def _rotation(stream: dict) -> int:
    rot = 0
    for sd in stream.get("side_data_list") or []:
        if "rotation" in sd:
            rot = int(round(float(sd["rotation"])))
    if not rot:
        try:
            rot = int((stream.get("tags") or {}).get("rotate", 0))
        except ValueError:
            rot = 0
    return rot % 360


async def probe(path: Path | str, timeout: float = 60) -> Probe:
    s = get_settings()
    proc = await asyncio.create_subprocess_exec(
        s.ffprobe_bin,
        "-v", "error",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        str(path),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout)
    except TimeoutError:
        proc.kill()
        raise FFmpegError("ffprobe timeout") from None
    if proc.returncode != 0:
        raise FFmpegError("ffprobe failed", err.decode(errors="replace"))
    data = json.loads(out or b"{}")
    streams = data.get("streams") or []
    fmt = data.get("format") or {}
    v = next((st for st in streams if st.get("codec_type") == "video" and not (st.get("disposition") or {}).get("attached_pic")), None)
    a = next((st for st in streams if st.get("codec_type") == "audio"), None)
    duration = _parse_rate(fmt.get("duration")) or _parse_rate((v or {}).get("duration")) or 0.0
    width = height = 0
    fps = 0.0
    fps_str = "30"
    rotation = 0
    if v:
        width, height = int(v.get("width") or 0), int(v.get("height") or 0)
        rotation = _rotation(v)
        if rotation in (90, 270):
            width, height = height, width
        rate = v.get("avg_frame_rate") if _parse_rate(v.get("avg_frame_rate")) else v.get("r_frame_rate")
        fps = _parse_rate(rate)
        if not (1 <= fps <= 240):
            fps, rate = 30.0, "30"
        fps_str = rate or "30"
    return Probe(
        duration=duration,
        width=width,
        height=height,
        fps=fps or 30.0,
        fps_str=fps_str,
        has_audio=a is not None,
        has_video=v is not None,
        vcodec=(v or {}).get("codec_name", ""),
        pix_fmt=(v or {}).get("pix_fmt", ""),
        start_time=_parse_rate(fmt.get("start_time")),
        rotation=rotation,
    )


_TIME_RE = re.compile(r"out_time_(?:us|ms)=(\d+)")


async def run_ffmpeg(
    args: Sequence[str],
    *,
    duration: float | None = None,
    on_progress: ProgressCb | None = None,
    timeout: float | None = None,
) -> None:
    """Run ffmpeg with ``-progress pipe:1`` and report progress 0..1."""
    s = get_settings()
    cmd = [s.ffmpeg_bin, "-hide_banner", "-nostdin", "-y", "-loglevel", "error"]
    if on_progress and duration:
        cmd += ["-progress", "pipe:1", "-stats_period", "0.5"]
    cmd += list(args)
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    stderr_chunks: list[bytes] = []

    async def read_stdout() -> None:
        assert proc.stdout
        last = -1.0
        async for raw in proc.stdout:
            if not (on_progress and duration):
                continue
            m = _TIME_RE.search(raw.decode(errors="ignore"))
            if m:
                frac = min(1.0, max(0.0, int(m.group(1)) / 1e6 / duration))
                if frac - last >= 0.005:
                    last = frac
                    res = on_progress(frac)
                    if asyncio.iscoroutine(res):
                        await res

    async def read_stderr() -> None:
        assert proc.stderr
        async for raw in proc.stderr:
            if sum(len(c) for c in stderr_chunks) < 64_000:
                stderr_chunks.append(raw)

    try:
        await asyncio.wait_for(asyncio.gather(read_stdout(), read_stderr(), proc.wait()), timeout)
    except TimeoutError:
        proc.kill()
        await proc.wait()
        raise FFmpegError("ffmpeg timeout") from None
    except asyncio.CancelledError:
        proc.kill()  # job was aborted: do not leave ffmpeg running
        raise
    if proc.returncode != 0:
        err = b"".join(stderr_chunks).decode(errors="replace")
        raise FFmpegError(f"ffmpeg exited with {proc.returncode}", err[-4000:])


def even(n: float) -> int:
    v = int(round(n))
    return max(2, v - (v % 2))


def short_side_scale(width: int, height: int, short: int) -> tuple[int, int]:
    """Scale so that the short side is at most ``short`` (never upscale)."""
    if min(width, height) <= short:
        return even(width), even(height)
    k = short / min(width, height)
    return even(width * k), even(height * k)


async def make_previews(
    src: Path,
    probe_: Probe,
    *,
    proxy: Path,
    sprite: Path,
    original: Path | None = None,
    quality: int = 1080,
    start: float = 0.0,
    duration: float | None = None,
    on_progress: ProgressCb | None = None,
    tile_height: int = 96,
    max_count: int = 120,
    columns: int = 10,
) -> dict:
    """One decode of ``src`` → the preview proxy and the timeline sprite, plus
    (when ``original`` is given) the trimmed working copy for renders, its short
    side at most ``quality``.

    The proxy is light H.264 with frequent keyframes for scrubbing; decoding the
    source once is most of the cost, so every output shares it."""
    s = get_settings()
    dur = duration if duration is not None else max(0.0, probe_.duration - start)
    count, interval = sprite_layout(dur, max_count)
    rows = math.ceil(count / columns)
    cols = min(columns, count)
    if original is not None:
        ow, oh = short_side_scale(probe_.width, probe_.height, quality)
    else:
        ow, oh = probe_.width, probe_.height
    pw, ph = short_side_scale(ow, oh, s.proxy_short_side)
    tw = even(tile_height * pw / max(1, ph))
    thumbs = f"fps=1/{interval:.4f}:round=down,scale={tw}:{tile_height},tile={cols}x{rows}[sp]"
    if original is not None:
        graph = (f"[0:v]scale={ow}:{oh}:flags=bicubic,format=yuv420p,split=2[o][x];"
                 f"[x]scale={pw}:{ph}:flags=bicubic,split=2[p][s];[s]{thumbs}")
    else:
        graph = f"[0:v]scale={pw}:{ph}:flags=bicubic,format=yuv420p,split=2[p][s];[s]{thumbs}"
    args: list[str] = []
    if start > 0:
        args += ["-ss", f"{start:.3f}"]
    if duration is not None:
        args += ["-t", f"{duration:.3f}"]
    args += ["-i", str(src), "-filter_complex", graph]
    audio = ["-map", "0:a:0"] if probe_.has_audio else []
    if original is not None:
        args += ["-map", "[o]", *audio, "-c:v", "libx264", "-preset", s.source_preset, "-crf", "18",
                 "-movflags", "+faststart"]
        args += (["-c:a", "aac", "-b:a", "192k"] if probe_.has_audio else []) + [str(original)]
    args += ["-map", "[p]", *audio, "-c:v", "libx264", "-preset", "veryfast", "-crf", "26",
             "-g", "15", "-keyint_min", "15", "-sc_threshold", "0", "-profile:v", "main", "-movflags", "+faststart"]
    args += (["-c:a", "aac", "-b:a", "96k", "-ac", "2"] if probe_.has_audio else []) + [str(proxy)]
    args += ["-map", "[sp]", "-frames:v", "1", "-q:v", "5", str(sprite)]
    await run_ffmpeg(args, duration=dur, on_progress=on_progress)
    return {"columns": cols, "rows": rows, "count": count, "start": 0.0, "interval": interval,
            "tileWidth": tw, "tileHeight": tile_height}


@dataclass
class Sprite:
    url: str
    columns: int
    rows: int
    count: int
    start: float
    interval: float
    tileWidth: int
    tileHeight: int

    def as_dict(self) -> dict:
        return dict(self.__dict__)


def sprite_layout(duration: float, max_count: int = 120, min_interval: float = 0.5) -> tuple[int, float]:
    interval = max(min_interval, duration / max_count) if duration > 0 else 1.0
    count = max(1, min(max_count, math.ceil(duration / interval))) if duration > 0 else 1
    return count, interval


async def make_sprite(
    src: Path, dst: Path, probe_: Probe, *, tile_height: int = 96, max_count: int = 120, columns: int = 10
) -> dict:
    """Thumbnail strip for the timeline: one JPEG, frames tiled ``columns`` wide."""
    count, interval = sprite_layout(probe_.duration, max_count)
    rows = math.ceil(count / columns)
    cols = min(columns, count)
    tw = even(tile_height * probe_.width / max(1, probe_.height))
    vf = f"fps=1/{interval:.4f}:round=down,scale={tw}:{tile_height},tile={cols}x{rows}"
    await run_ffmpeg(["-i", str(src), "-an", "-vf", vf, "-frames:v", "1", "-q:v", "5", str(dst)])
    return {"columns": cols, "rows": rows, "count": count, "start": 0.0, "interval": interval,
            "tileWidth": tw, "tileHeight": tile_height}


async def grab_frames_sprite(
    src: str, dst: Path, times: list[float], width: int, height: int, *, tile_height: int = 96, columns: int = 10,
    timeout: float = 120,
) -> dict:
    """Build a sprite from frames grabbed at given times with fast input seeking
    (works for long local files and HLS streams without decoding everything)."""
    tw = even(tile_height * width / max(1, height)) if width and height else even(tile_height * 16 / 9)
    tmp = dst.parent / f"{dst.stem}_frames"
    tmp.mkdir(parents=True, exist_ok=True)
    sem = asyncio.Semaphore(4)

    async def grab(i: int, t: float) -> None:
        async with sem:
            try:
                await run_ffmpeg(
                    ["-ss", f"{t:.3f}", "-i", src, "-frames:v", "1", "-an",
                     "-vf", f"scale={tw}:{tile_height}:force_original_aspect_ratio=decrease,"
                            f"pad={tw}:{tile_height}:(ow-iw)/2:(oh-ih)/2",
                     "-q:v", "6", str(tmp / f"{i:04d}.jpg")],
                    timeout=timeout,
                )
            except FFmpegError:
                pass

    await asyncio.gather(*(grab(i, t) for i, t in enumerate(times)))
    # fill missing frames with the previous one so the tile grid stays aligned
    prev = None
    for i in range(len(times)):
        f = tmp / f"{i:04d}.jpg"
        if f.exists():
            prev = f
        elif prev is not None:
            f.write_bytes(prev.read_bytes())
    first = next((tmp / f"{i:04d}.jpg" for i in range(len(times)) if (tmp / f"{i:04d}.jpg").exists()), None)
    if first is None:
        raise UserError("Не удалось получить кадры превью.", code="strip_failed")
    for i in range(len(times)):
        f = tmp / f"{i:04d}.jpg"
        if not f.exists():
            f.write_bytes(first.read_bytes())
    count = len(times)
    cols = min(columns, count)
    rows = math.ceil(count / cols)
    await run_ffmpeg(
        ["-framerate", "1", "-i", str(tmp / "%04d.jpg"), "-vf", f"tile={cols}x{rows}", "-frames:v", "1",
         "-q:v", "5", str(dst)]
    )
    for f in tmp.iterdir():
        f.unlink(missing_ok=True)
    tmp.rmdir()
    interval = (times[1] - times[0]) if count > 1 else 1.0
    return {"columns": cols, "rows": rows, "count": count, "start": times[0], "interval": interval,
            "tileWidth": tw, "tileHeight": tile_height}
