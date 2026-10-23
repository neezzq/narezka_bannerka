"""Banner assets: type sniffing and conversion into render/preview friendly files.

* image (png/jpg/webp)  → normalised PNG/JPEG (EXIF orientation applied) — used as is
* gif (and animated webp) → original GIF for ffmpeg + sprite sheet PNG with
  frame durations so the preview can show the exact frame for any time
* video (mp4/webm/mov)  → H.264 "mezzanine" used by both preview and render
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageOps, ImageSequence

from .errors import UserError
from .ffmpeg import FFmpegError, even, probe, run_ffmpeg, short_side_scale

MAX_IMAGE_SIDE = 2160
MAX_GIF_FRAMES = 300
MAX_SPRITE_PIXELS = 16_000_000
VIDEO_SHORT_SIDE = 1080
MAX_VIDEO_SECONDS = 300

ALLOWED_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm", ".mov", ".m4v"}


def sniff(head: bytes) -> tuple[str, str] | None:
    """Return (kind, mime) by magic bytes, or None if not allowed."""
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image", "image/png"
    if head.startswith(b"\xff\xd8\xff"):
        return "image", "image/jpeg"
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return "gif", "image/gif"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image", "image/webp"
    if head[4:8] == b"ftyp":
        brand = head[8:12]
        return "video", "video/quicktime" if brand == b"qt  " else "video/mp4"
    if head[4:8] in (b"moov", b"wide", b"mdat", b"free"):
        return "video", "video/quicktime"
    if head.startswith(b"\x1a\x45\xdf\xa3"):
        return "video", "video/webm"
    return None


def _open_image(path: Path) -> Image.Image:
    try:
        im = Image.open(path)
        im.load()
        return im
    except Exception as exc:  # noqa: BLE001
        raise UserError("Не удалось прочитать изображение — файл повреждён?", code="bad_asset") from exc


def process_image(src: Path, out_dir: Path) -> dict:
    im = _open_image(src)
    if getattr(im, "is_animated", False) and im.format == "WEBP":
        gif = out_dir / "banner.gif"
        frames = [f.convert("RGBA") for f in ImageSequence.Iterator(im)]
        durations = [f.info.get("duration", 100) for f in ImageSequence.Iterator(im)]
        frames[0].save(gif, save_all=True, append_images=frames[1:], duration=durations, loop=0, disposal=2)
        return process_gif(gif, out_dir)
    im = ImageOps.exif_transpose(im)
    has_alpha = im.mode in ("RGBA", "LA", "P") and (im.mode != "P" or "transparency" in im.info)
    im = im.convert("RGBA" if has_alpha else "RGB")
    if max(im.size) > MAX_IMAGE_SIDE:
        im.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE), Image.Resampling.LANCZOS)
    if has_alpha:
        out = out_dir / "banner.png"
        im.save(out, optimize=True)
        mime = "image/png"
    else:
        out = out_dir / "banner.jpg"
        im.save(out, quality=94)
        mime = "image/jpeg"
    thumb = out_dir / "thumb.png"
    t = im.copy()
    t.thumbnail((320, 320))
    t.save(thumb)
    return {"kind": "image", "render": out, "preview": out, "previewMime": mime, "renderMime": mime,
            "thumb": thumb, "width": im.width, "height": im.height, "duration": None, "meta": {}}


def process_gif(src: Path, out_dir: Path) -> dict:
    im = _open_image(src)
    width, height = im.size
    frames: list[Image.Image] = []
    durations: list[int] = []
    for i, frame in enumerate(ImageSequence.Iterator(im)):
        if i >= MAX_GIF_FRAMES:
            break
        d = int(frame.info.get("duration", 100) or 0)
        durations.append(100 if d < 20 else d)  # same rule as browsers and ffmpeg (min_delay)
        frames.append(frame.convert("RGBA"))
    if not frames:
        raise UserError("GIF не содержит кадров.", code="bad_asset")
    n = len(frames)
    cols = math.ceil(math.sqrt(n))
    rows = math.ceil(n / cols)
    scale = min(1.0, math.sqrt(MAX_SPRITE_PIXELS / max(1, n * width * height)))
    fw, fh = max(1, int(width * scale)), max(1, int(height * scale))
    sheet = Image.new("RGBA", (cols * fw, rows * fh), (0, 0, 0, 0))
    for i, fr in enumerate(frames):
        if (fw, fh) != (width, height):
            fr = fr.resize((fw, fh), Image.Resampling.LANCZOS)
        sheet.paste(fr, ((i % cols) * fw, (i // cols) * fh))
    sprite = out_dir / "sprite.png"
    sheet.save(sprite, optimize=True)
    thumb = out_dir / "thumb.png"
    t = frames[0].copy()
    t.thumbnail((320, 320))
    t.save(thumb)
    render = out_dir / "banner.gif"
    if src != render:
        render.write_bytes(src.read_bytes())
    meta = {"frames": durations, "columns": cols, "rows": rows, "frameWidth": fw, "frameHeight": fh}
    return {"kind": "gif", "render": render, "preview": sprite, "previewMime": "image/png", "renderMime": "image/gif",
            "thumb": thumb, "width": width, "height": height, "duration": sum(durations) / 1000, "meta": meta}


async def process_video(src: Path, out_dir: Path, on_progress=None) -> dict:
    try:
        p = await probe(src)
    except FFmpegError as exc:
        raise UserError("Не удалось прочитать видео — формат не поддерживается.", code="bad_asset") from exc
    if not p.has_video or p.width <= 0 or p.duration <= 0:
        raise UserError("В файле нет видеодорожки.", code="bad_asset")
    if p.duration > MAX_VIDEO_SECONDS:
        raise UserError("Видео-баннер слишком длинный — максимум 5 минут.", code="bad_asset")
    w, h = short_side_scale(p.width, p.height, VIDEO_SHORT_SIDE)
    out = out_dir / "banner.mp4"
    await run_ffmpeg(
        ["-i", str(src), "-map", "0:v:0", "-an",
         "-vf", f"scale={w}:{h}:flags=bicubic,format=yuv420p",
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-g", "30", "-movflags", "+faststart", str(out)],
        duration=p.duration, on_progress=on_progress,
    )
    thumb = out_dir / "thumb.jpg"
    await run_ffmpeg(["-ss", f"{min(0.5, p.duration / 2):.2f}", "-i", str(out), "-frames:v", "1",
                      "-vf", f"scale={even(min(320, w))}:-2", str(thumb)])
    return {"kind": "video", "render": out, "preview": out, "previewMime": "video/mp4", "renderMime": "video/mp4",
            "thumb": thumb, "width": w, "height": h, "duration": round(p.duration, 3), "meta": {}}
