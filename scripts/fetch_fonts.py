#!/usr/bin/env python3
"""Download subtitle fonts (static TTF instances with Cyrillic) and normalise them.

The same files are used by the browser preview (canvas) and by libass at export
time, so subtitles look identical. For each font weight we:

* rename the internal family/full/postscript names to a unique "BK <Family> <weight>"
  so that libass selects exactly that file by name;
* normalise vertical metrics (hhea / OS/2 typo := OS/2 win, line gap 0,
  USE_TYPO_METRICS) so that browsers lay out lines exactly like libass does
  (line height == ASS font size, baseline at winAscent);
* write ``fonts.json`` with the metrics both renderers need.

Usage: python scripts/fetch_fonts.py [output_dir]
Requires: fonttools.
"""
from __future__ import annotations

import io
import json
import re
import sys
import urllib.request
from pathlib import Path

from fontTools.ttLib import TTFont

UA = "Mozilla/5.0 (Unknown; Linux x86_64) AppleWebKit/538.1 (KHTML, like Gecko) Safari/538.1 Daum/4.1"

# id, Google family name, weights to fetch
FAMILIES: list[tuple[str, str, list[int]]] = [
    ("montserrat", "Montserrat", [400, 700, 900]),
    ("inter", "Inter", [400, 700, 900]),
    ("roboto", "Roboto", [400, 700, 900]),
    ("rubik", "Rubik", [400, 700, 900]),
    ("oswald", "Oswald", [400, 700]),
    ("manrope", "Manrope", [400, 700, 800]),
    ("unbounded", "Unbounded", [400, 700, 900]),
    ("nunito", "Nunito", [400, 700, 900]),
    ("comfortaa", "Comfortaa", [400, 700]),
    ("russo-one", "Russo One", [400]),
]

FACE_RE = re.compile(r"font-weight:\s*(\d+);.*?src:\s*url\(([^)]+)\)", re.S)


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


def set_name(font: TTFont, name_id: int, value: str) -> None:
    table = font["name"]
    table.names = [n for n in table.names if n.nameID != name_id]
    table.setName(value, name_id, 3, 1, 0x409)  # Windows, Unicode BMP, en-US
    table.setName(value, name_id, 1, 0, 0)  # Mac Roman


def normalise(data: bytes, family: str, weight: int) -> tuple[TTFont, dict]:
    font = TTFont(io.BytesIO(data))
    cmap = font.getBestCmap()
    if 0x0416 not in cmap:  # "Ж"
        raise RuntimeError(f"{family} {weight}: no Cyrillic glyphs")

    internal = f"BK {family} {weight}"
    ps_name = re.sub(r"[^A-Za-z0-9-]", "", f"BK-{family}-{weight}")
    for nid in (16, 17, 21, 22):  # typographic / WWS names would confuse matching
        font["name"].names = [n for n in font["name"].names if n.nameID != nid]
    set_name(font, 1, internal)
    set_name(font, 2, "Regular")
    set_name(font, 3, f"{ps_name};bannerka")
    set_name(font, 4, internal)
    set_name(font, 6, ps_name)

    os2 = font["OS/2"]
    hhea = font["hhea"]
    upm = font["head"].unitsPerEm
    win_a, win_d = os2.usWinAscent, os2.usWinDescent
    hhea.ascent, hhea.descent, hhea.lineGap = win_a, -win_d, 0
    os2.sTypoAscender, os2.sTypoDescender, os2.sTypoLineGap = win_a, -win_d, 0
    if os2.version < 4:
        os2.version = 4
    os2.fsSelection |= 1 << 7  # USE_TYPO_METRICS
    os2.fsSelection |= 1 << 6  # REGULAR
    os2.fsSelection &= ~((1 << 0) | (1 << 5))  # not italic, not bold (style linking)
    font["head"].macStyle = 0

    metrics = {
        "unitsPerEm": upm,
        "ascent": win_a,
        "descent": win_d,
        # libass: em size = ASS size * upm / (winAscent + winDescent)
        "assRatio": round((win_a + win_d) / upm, 6),
    }
    return font, metrics


def main() -> None:
    out_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "frontend/public/fonts")
    out_dir.mkdir(parents=True, exist_ok=True)
    catalog = []
    for fid, family, weights in FAMILIES:
        css_url = (
            "https://fonts.googleapis.com/css?family="
            + family.replace(" ", "+")
            + ":"
            + ",".join(str(w) for w in weights)
            + "&subset=cyrillic,latin"
        )
        css = fetch(css_url).decode()
        faces = {int(w): u for w, u in FACE_RE.findall(css)}
        entry = {"id": fid, "name": family, "weights": []}
        for w in weights:
            if w not in faces:
                print(f"  ! {family} {w} not available, skipped")
                continue
            font, metrics = normalise(fetch(faces[w]), family, w)
            file_name = f"{fid}-{w}.ttf"
            font.save(out_dir / file_name)
            entry["weights"].append(
                {"weight": w, "file": file_name, "internalName": f"BK {family} {w}", **metrics}
            )
            print(f"  + {file_name} ({(out_dir / file_name).stat().st_size // 1024} KB)")
        catalog.append(entry)
    (out_dir / "fonts.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n")
    print(f"wrote {out_dir / 'fonts.json'}")


if __name__ == "__main__":
    main()
