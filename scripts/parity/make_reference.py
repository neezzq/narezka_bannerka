#!/usr/bin/env python3
"""Reference renders made by the export pipeline (libass / ffmpeg filters).

    python scripts/parity/make_reference.py OUT_DIR

Writes:  sub-<case>-export.png, chroma-<case>-export.png, chroma-src.png, cases.json
The browser side is rendered by render_preview.mjs, then compare.py checks both.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from PIL import Image, ImageDraw, ImageFilter  # noqa: E402

from app.render.ass import build_ass  # noqa: E402
from app.render.graph import chroma_filters  # noqa: E402
from app.schemas import ChromaSettings, Cut, Line, SubtitleStyle  # noqa: E402

FONTS = ROOT / "frontend" / "public" / "fonts"
LINES = [Line(id="l", words=[{"text": "Пример", "start": 0, "end": 1}, {"text": "жирных", "start": 1, "end": 2},
                             {"text": "субтитров", "start": 2, "end": 3}])]
CHROMA = [
    {"name": "soft", "c": {"color": "#28C83C", "similarity": 0.12, "blend": 0.08, "spill": 0.5}},
    {"name": "hard", "c": {"color": "#00FF00", "similarity": 0.25, "blend": 0.0, "spill": 0.0}},
    {"name": "spill", "c": {"color": "#2EBE46", "similarity": 0.08, "blend": 0.2, "spill": 1.0}},
]


def ffmpeg(*args: str) -> None:
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def green_screen(path: Path) -> None:
    im = Image.new("RGB", (400, 300), (40, 200, 60))
    d = ImageDraw.Draw(im)
    for i in range(0, 400, 4):
        d.line([(i, 0), (i, 300)], fill=(30 + i % 30, 190 + (i // 4) % 40, 50 + i % 25))
    subj = Image.new("RGB", (400, 300))
    mask = Image.new("L", (400, 300), 0)
    ImageDraw.Draw(subj).ellipse((110, 60, 290, 240), fill=(220, 170, 140))
    ImageDraw.Draw(subj).rectangle((170, 120, 230, 180), fill=(90, 170, 80))
    ImageDraw.Draw(mask).ellipse((110, 60, 290, 240), fill=255)
    im.paste(subj, (0, 0), mask.filter(ImageFilter.GaussianBlur(6)))
    im.save(path)


def main() -> None:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "parity-out").resolve()
    out.mkdir(parents=True, exist_ok=True)
    cases = json.loads((Path(__file__).parent / "subtitle_cases.json").read_text())
    subs = []
    for case in cases:
        style = SubtitleStyle.model_validate(case["style"])
        ass = out / f"sub-{case['name']}.ass"
        ass.write_text(build_ass(LINES, [Cut(id="c", start=0, end=10)], style, (1080, 1920), FONTS))
        ffmpeg("-f", "lavfi", "-i", "color=c=black:s=720x1280:r=30:d=3", "-vf", f"ass={ass}:fontsdir={FONTS}",
               "-ss", "1.5", "-frames:v", "1", str(out / f"sub-{case['name']}-export.png"))
        subs.append({"name": case["name"], "style": style.model_dump(mode="json")})
    green_screen(out / "chroma-src.png")
    chroma = []
    for case in CHROMA:
        cs = ChromaSettings.model_validate(case["c"])
        ffmpeg("-i", str(out / "chroma-src.png"), "-vf", ",".join([*chroma_filters(cs), "format=rgba"]),
               "-frames:v", "1", str(out / f"chroma-{case['name']}-export.png"))
        chroma.append({"name": case["name"], "c": cs.model_dump(mode="json")})
    (out / "cases.json").write_text(json.dumps({"subtitles": subs, "lines": [x.model_dump(mode="json") for x in LINES],
                                                "chroma": chroma}, ensure_ascii=False))
    print(f"reference renders in {out}")


if __name__ == "__main__":
    main()
