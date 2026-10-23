#!/usr/bin/env python3
"""Compare preview vs export renders; exits 1 if any case exceeds the tolerance.

    python scripts/parity/compare.py OUT_DIR
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image, ImageChops

BBOX_TOL_PX = 4  # at 720×1280
DIFF_TOL = 1.0  # % of pixels differing by more than 25 %
ALPHA_TOL = 2.0  # mean |alpha diff| (0..255)


def bbox(path: Path) -> tuple[int, int, int, int]:
    return Image.open(path).convert("L").point(lambda v: 255 if v > 40 else 0).getbbox() or (0, 0, 0, 0)


def main() -> int:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "parity-out")
    cases = json.loads((out / "cases.json").read_text())
    ok = True
    print("subtitles (canvas vs libass)")
    for c in cases["subtitles"]:
        a, b = out / f"sub-{c['name']}-export.png", out / f"sub-{c['name']}-preview.png"
        d = [y - x for x, y in zip(bbox(a), bbox(b), strict=True)]
        hist = ImageChops.difference(Image.open(a).convert("RGB"), Image.open(b).convert("RGB")).convert("L").histogram()
        pct = sum(hist[64:]) / sum(hist) * 100
        good = max(map(abs, d)) <= BBOX_TOL_PX and pct <= DIFF_TOL
        ok &= good
        print(f"  {'✓' if good else '✗'} {c['name']:10s} bbox delta {d} px, differing pixels {pct:.2f}%")
    print("chroma key (WebGL vs ffmpeg chromakey+despill)")
    for c in cases["chroma"]:
        a = Image.open(out / f"chroma-{c['name']}-export.png").convert("RGBA")
        b = Image.open(out / f"chroma-{c['name']}-preview.png").convert("RGBA")
        alpha = ImageChops.difference(a.getchannel("A"), b.getchannel("A")).histogram()
        mean = sum(i * n for i, n in enumerate(alpha)) / sum(alpha)
        good = mean <= ALPHA_TOL
        ok &= good
        print(f"  {'✓' if good else '✗'} {c['name']:10s} mean |alpha diff| {mean:.2f}/255")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
