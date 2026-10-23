"""Build the ffmpeg command for the final render from the project document.

Pipeline (all compositing in RGB so colours match the browser preview):

    source ─trim/concat (cuts)─ fps ─ [chroma] ─ crop+scale (videoTransform) ┐
    colour background W×H ───────────────────────────────────────────── overlay ─ banners… ─ ass ─ yuv420p(bt709)

Geometry mirrors ``frontend/src/editor/geometry.ts``:
* frame W×H from aspect + quality (short side 720/1080);
* video scale = (contain ? min : max)(W/vw, H/vh) * transform.scale,
  centre at (W/2 + x·W, H/2 + y·H);
* banner box (x, y, w, h) normalised to the frame, rotation around its centre.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path

from ..schemas import QUALITY_SHORT_SIDE, Banner, ChromaSettings, ProjectDoc, frame_size
from . import timeline as tl

SLIDE_KINDS = {"slide-left", "slide-right", "slide-up", "slide-down"}


@dataclass
class SourceInfo:
    path: Path
    width: int
    height: int
    fps: float
    fps_str: str
    duration: float
    has_audio: bool


@dataclass
class AssetInfo:
    path: Path
    kind: str  # image | gif | video
    width: int
    height: int


@dataclass
class RenderPlan:
    args: list[str]
    duration: float
    width: int
    height: int
    fps: str
    filter_complex: str = ""
    inputs: list[list[str]] = field(default_factory=list)


def _n(v: float, digits: int = 4) -> str:
    s = f"{v:.{digits}f}".rstrip("0").rstrip(".")
    return s if s not in ("", "-0") else "0"


def spill_kind(color: str) -> str:
    """Despill the dominant screen channel: blue screens vs green (everything else)."""
    h = color.lstrip("#")
    g, b = int(h[2:4], 16), int(h[4:6], 16)
    return "blue" if b > g else "green"


def chroma_filters(c: ChromaSettings) -> list[str]:
    """ffmpeg equivalent of the WebGL chroma shader (frontend/src/editor/chroma/shader.ts).

    chromakey computes the key colour's U/V with full-range BT.601 coefficients,
    so the frame is converted to RGB and then explicitly to full-range yuv444p
    BT.601 — pixel and key U/V use the same maths (the shader does too)."""
    key = c.color.lstrip("#").upper()
    out = [
        "format=gbrap",
        "scale=out_color_matrix=bt601:out_range=pc",
        "format=yuva444p",
        f"chromakey=color=0x{key}:similarity={_n(max(0.00001, c.similarity))}:blend={_n(c.blend)}",
        "format=gbrap",
    ]
    if c.spill > 0.001:
        kind = spill_kind(c.color)
        scales = "green=0:blue=" if kind == "blue" else "blue=0:green="
        out.append(f"despill=type={kind}:mix=0.5:expand=0:red=0:{scales}{_n(-c.spill)}:brightness=0:alpha=0")
    return out


def output_fps(doc: ProjectDoc, src: SourceInfo) -> str:
    fps = doc.export.fps
    if fps == "source":
        return src.fps_str if src.fps <= 61 else "60"
    return str(fps)


def video_placement(doc: ProjectDoc, src: SourceInfo, W: int, H: int) -> dict:
    """Placed rectangle of the video in the frame, and the visible part of it."""
    t = doc.videoTransform
    base = (min if t.fit == "contain" else max)(W / src.width, H / src.height)
    s = base * t.scale
    sw, sh = src.width * s, src.height * s
    cx, cy = W / 2 + t.x * W, H / 2 + t.y * H
    x0, y0 = cx - sw / 2, cy - sh / 2
    vx0, vy0 = max(0.0, x0), max(0.0, y0)
    vx1, vy1 = min(float(W), x0 + sw), min(float(H), y0 + sh)
    visible = vx1 - vx0 > 1 and vy1 - vy0 > 1
    return {
        "scale": s, "x0": x0, "y0": y0, "sw": sw, "sh": sh, "visible": visible,
        "vx0": vx0, "vy0": vy0, "vx1": vx1, "vy1": vy1,
        # crop of the source that ends up visible
        "cx": (vx0 - x0) / s, "cy": (vy0 - y0) / s, "cw": (vx1 - vx0) / s, "ch": (vy1 - vy0) / s,
    }


def _ease(u: str) -> str:
    """ease-out cubic of a clipped progress expression (same as the preview)."""
    return f"(1-pow(1-{u},3))"


def banner_motion(b: Banner, W: int, H: int) -> tuple[str, str]:
    """overlay x/y expressions (time-dependent for slide animations)."""
    cx = (b.x + b.w / 2) * W
    cy = (b.y + b.h / 2) * H
    x = f"{_n(cx, 2)}-overlay_w/2"
    y = f"{_n(cy, 2)}-overlay_h/2"
    d = b.animDuration
    s, e = b.start, b.end
    offs = {
        "slide-left": (-(b.x + b.w) * W, 0.0),
        "slide-right": ((1 - b.x) * W, 0.0),
        "slide-up": (0.0, (1 - b.y) * H),
        "slide-down": (0.0, -(b.y + b.h) * H),
    }
    for kind, phase in ((b.animIn, "in"), (b.animOut, "out")):
        if kind not in SLIDE_KINDS:
            continue
        dx, dy = offs[kind]
        if phase == "in":
            u = f"clip((t-{_n(s)})/{_n(d)},0,1)"
            k = f"(1-{_ease(u)})"
        else:
            u = f"clip(({_n(e)}-t)/{_n(d)},0,1)"
            k = f"(1-{_ease(u)})"
        if dx:
            x += f"+({_n(dx, 2)})*{k}"
        if dy:
            y += f"+({_n(dy, 2)})*{k}"
    return x, y


def banner_chain(b: Banner, asset: AssetInfo, W: int, H: int) -> list[str]:
    chain = [f"setpts=PTS-STARTPTS+{_n(b.start)}/TB"]
    if b.chroma and b.chroma.enabled:
        chain += chroma_filters(b.chroma)
    chain.append("format=rgba")
    bw, bh = max(2, round(b.w * W)), max(2, round(b.h * H))
    scale_anim = b.animIn == "scale" or b.animOut == "scale"
    if scale_anim:
        d, s, e = _n(b.animDuration), _n(b.start), _n(b.end)
        k = []
        if b.animIn == "scale":
            k.append(_ease(f"clip((t-{s})/{d},0,1)"))
        if b.animOut == "scale":
            k.append(_ease(f"clip(({e}-t)/{d},0,1)"))
        f = "*".join(k)
        chain.append(f"scale=w='max(2,{bw}*{f})':h='max(2,{bh}*{f})':eval=frame:flags=bicubic")
    else:
        chain.append(f"scale={bw}:{bh}:flags=bicubic")
    if b.opacity < 0.999:
        chain.append(f"colorchannelmixer=aa={_n(b.opacity)}")
    if abs(b.rotation) > 0.01:
        rad = _n(math.radians(b.rotation), 6)
        chain.append(f"rotate=a={rad}:ow=rotw({rad}):oh=roth({rad}):c=none:bilinear=1")
    d = b.animDuration
    if b.animIn in ("fade", "scale"):
        chain.append(f"fade=t=in:st={_n(b.start)}:d={_n(d)}:alpha=1")
    if b.animOut in ("fade", "scale"):
        chain.append(f"fade=t=out:st={_n(max(b.start, b.end - d))}:d={_n(d)}:alpha=1")
    return chain


def build_render(
    doc: ProjectDoc,
    src: SourceInfo,
    assets: dict[str, AssetInfo],
    output: Path,
    ass_path: Path | None = None,
    fonts_dir: Path | None = None,
    preset: str = "veryfast",
    threads: int = 0,
) -> RenderPlan:
    short = QUALITY_SHORT_SIDE[doc.export.quality]
    W, H = frame_size(doc.aspect, short)
    fps = output_fps(doc, src)
    cuts = [c for c in doc.cuts if c.end > c.start] or []
    if not cuts:
        raise ValueError("project has no cuts")
    # cuts may not exceed the real media length
    cuts = [c.model_copy(update={"end": min(c.end, src.duration)}) for c in cuts if c.start < src.duration - 0.02]
    total = tl.output_duration(cuts)

    inputs: list[list[str]] = [["-i", str(src.path)]]
    fc: list[str] = []

    # 1. cuts → concat
    if len(cuts) == 1:
        c = cuts[0]
        fc.append(f"[0:v]trim=start={_n(c.start)}:end={_n(c.end)},setpts=PTS-STARTPTS[vcat]")
        if src.has_audio:
            fc.append(f"[0:a]atrim=start={_n(c.start)}:end={_n(c.end)},asetpts=PTS-STARTPTS[acat]")
    else:
        pads = []
        for i, c in enumerate(cuts):
            fc.append(f"[0:v]trim=start={_n(c.start)}:end={_n(c.end)},setpts=PTS-STARTPTS[v{i}]")
            pads.append(f"[v{i}]")
            if src.has_audio:
                fc.append(f"[0:a]atrim=start={_n(c.start)}:end={_n(c.end)},asetpts=PTS-STARTPTS[a{i}]")
                pads.append(f"[a{i}]")
        fc.append(f"{''.join(pads)}concat=n={len(cuts)}:v=1:a={1 if src.has_audio else 0}"
                  + ("[vcat][acat]" if src.has_audio else "[vcat]"))
    if not src.has_audio:
        fc.append(f"anullsrc=r=48000:cl=stereo,atrim=duration={_n(total)}[acat]")

    # 2. background + placed video
    bg = doc.background.lstrip("#")
    fc.append(f"color=c=0x{bg}:s={W}x{H}:r={fps}:d={_n(total + 1)},format=rgba[bg]")
    place = video_placement(doc, src, W, H)
    vchain = [f"fps={fps}"]
    if doc.videoChroma and doc.videoChroma.enabled:
        vchain += chroma_filters(doc.videoChroma)
    if place["visible"]:
        cw, ch = max(1, round(place["cw"])), max(1, round(place["ch"]))
        cx, cy = round(place["cx"]), round(place["cy"])
        cw, ch = min(cw, src.width - cx), min(ch, src.height - cy)
        ow, oh = max(1, round(place["vx1"] - place["vx0"])), max(1, round(place["vy1"] - place["vy0"]))
        vchain += ["format=rgba", f"crop={cw}:{ch}:{cx}:{cy}:exact=1", f"scale={ow}:{oh}:flags=bicubic"]
        fc.append(f"[vcat]{','.join(vchain)}[vid]")
        fc.append(f"[bg][vid]overlay=x={round(place['vx0'])}:y={round(place['vy0'])}:format=rgb:shortest=1[base0]")
    else:
        fc.append("[vcat]nullsink")
        fc.append(f"[bg]trim=duration={_n(total)}[base0]")

    # 3. banners (array order = z order)
    base = "base0"
    for j, b in enumerate(doc.banners):
        asset = assets.get(b.assetId)
        if asset is None or b.start >= total:
            continue
        idx = len(inputs)
        if asset.kind == "image":
            inputs.append(["-loop", "1", "-framerate", fps, "-i", str(asset.path)])
        elif asset.kind == "gif":
            inputs.append(["-ignore_loop", "0", "-i", str(asset.path)])
        else:
            inputs.append(["-stream_loop", "-1", "-i", str(asset.path)])
        fc.append(f"[{idx}:v]{','.join(banner_chain(b, asset, W, H))}[bn{j}]")
        x, y = banner_motion(b, W, H)
        end = min(b.end, total)
        nxt = f"base{j + 1}"
        fc.append(
            f"[{base}][bn{j}]overlay=x='{x}':y='{y}':eval=frame:format=rgb:shortest=1:"
            f"enable='between(t,{_n(b.start)},{_n(end)})'[{nxt}]"
        )
        base = nxt

    # 4. subtitles + output colourspace
    post = []
    if ass_path is not None:
        post.append(f"ass=filename={_escape_path(ass_path)}" + (f":fontsdir={_escape_path(fonts_dir)}" if fonts_dir else ""))
    post.append("scale=out_color_matrix=bt709:out_range=tv,format=yuv420p")
    fc.append(f"[{base}]{','.join(post)}[vout]")

    filter_complex = ";\n".join(fc)
    args: list[str] = []
    for inp in inputs:
        args += inp
    args += [
        "-filter_complex", filter_complex,
        "-map", "[vout]", "-map", "[acat]",
        "-t", _n(total),
        "-c:v", "libx264", "-preset", preset, "-crf", "19" if short >= 1080 else "21",
        "-profile:v", "high", "-pix_fmt", "yuv420p",
        "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
        "-r", fps,
        "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
        "-movflags", "+faststart",
    ]
    if threads:
        args += ["-threads", str(threads)]
    args.append(str(output))
    return RenderPlan(args=args, duration=total, width=W, height=H, fps=fps, filter_complex=filter_complex,
                      inputs=inputs)


def _escape_path(p: Path) -> str:
    """Escape a path for use inside a filtergraph option value."""
    s = str(p)
    for ch in ("\\", ":", "'", ",", ";", "[", "]", "="):
        s = s.replace(ch, "\\" + ch)
    return s
