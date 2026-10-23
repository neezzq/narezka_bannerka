"""Timeline semantics shared by the preview (frontend/src/lib/timeline.ts) and
the export. Keep both implementations in sync — they are checked against the
same fixtures (shared/fixtures/*.json).

* ``cuts`` are kept pieces of the source clip (source time), ordered and
  non-overlapping. The output timeline is their concatenation.
* Subtitle words are stored in source time and mapped to output time.
* Banners are stored in output time.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..schemas import Cut, Line, SubtitleStyle

# Subtitle page timing
GAP_FILL = 0.4  # close gaps between consecutive pages shorter than this (s)
MIN_PAGE = 0.1
# Animations
LINE_ANIM = 0.2  # line appearance duration (s)
POP_SCALE_FROM = 0.6  # "pop" appearance starts from this scale
SLIDE_PX = 40.0  # "slide" appearance offset in reference px
WORD_POP = 1.2  # active word scale with wordPop
WORD_POP_DUR = 0.1
# Lines wider than this fraction of the frame are scaled down to fit
MAX_LINE_WIDTH = 0.92


def output_duration(cuts: list[Cut]) -> float:
    return sum(c.end - c.start for c in cuts)


def source_to_output(cuts: list[Cut], t: float) -> float | None:
    offset = 0.0
    for c in cuts:
        if c.start <= t < c.end:
            return offset + (t - c.start)
        offset += c.end - c.start
    return None


def map_interval(cuts: list[Cut], start: float, end: float) -> tuple[float, float] | None:
    """Map a source interval to output time: the part inside the first cut it overlaps."""
    offset = 0.0
    if end <= start:
        end = start + 0.05
    for c in cuts:
        a, b = max(start, c.start), min(end, c.end)
        if b - a > 0.01:
            return round(offset + a - c.start, 4), round(offset + b - c.start, 4)
        offset += c.end - c.start
    return None


@dataclass
class PWord:
    text: str
    start: float
    end: float


@dataclass
class Page:
    words: list[PWord]
    start: float
    end: float
    line_id: str = ""
    text: str = field(init=False, default="")

    def __post_init__(self) -> None:
        self.text = " ".join(w.text for w in self.words)


def transform_text(text: str, style: SubtitleStyle) -> str:
    text = " ".join(text.split())
    return text.upper() if style.uppercase else text


def build_pages(lines: list[Line], cuts: list[Cut], style: SubtitleStyle) -> list[Page]:
    n = max(1, style.wordsPerScreen)
    pages: list[Page] = []
    for line in lines:
        mapped: list[PWord] = []
        for w in line.words:
            text = transform_text(w.text, style)
            if not text:
                continue
            iv = map_interval(cuts, w.start, w.end)
            if iv is None:
                continue
            mapped.append(PWord(text, iv[0], iv[1]))
        mapped.sort(key=lambda w: w.start)
        for i in range(0, len(mapped), n):
            chunk = mapped[i : i + n]
            pages.append(Page(chunk, chunk[0].start, max(w.end for w in chunk), line.id))
    pages.sort(key=lambda p: p.start)
    for i, page in enumerate(pages):
        nxt = pages[i + 1] if i + 1 < len(pages) else None
        if page.end - page.start < MIN_PAGE:
            page.end = page.start + MIN_PAGE
        if nxt is not None:
            if nxt.start - page.end < GAP_FILL:
                page.end = nxt.start
            page.end = min(page.end, nxt.start)
        page.start, page.end = round(page.start, 4), round(page.end, 4)
    return [p for p in pages if p.end > p.start]


def fit_scale(text_w: float, style: SubtitleStyle, frame_w: float) -> float:
    """Uniform scale (≤ 1) that keeps the page (text + box + outline) inside the frame."""
    w = text_w + 2 * style.outlineWidth + (2 * style.box.paddingX if style.box.enabled else 0)
    if w <= 0:
        return 1.0
    return min(1.0, MAX_LINE_WIDTH * frame_w / w)


def clamp01(v: float) -> float:
    return 0.0 if v < 0 else 1.0 if v > 1 else v


def line_anim_state(style: SubtitleStyle, page_start: float, t: float) -> tuple[float, float, float]:
    """(alpha 0..1, scale, y offset px) of the line at time ``t``."""
    if style.animation == "none":
        return 1.0, 1.0, 0.0
    p = clamp01((t - page_start) / LINE_ANIM)
    if style.animation == "fade":
        return p, 1.0, 0.0
    if style.animation == "pop":
        return p, POP_SCALE_FROM + (1 - POP_SCALE_FROM) * p, 0.0
    return p, 1.0, SLIDE_PX * (1 - p)  # slide


def active_word(page: Page, t: float) -> int:
    k = 0
    for i, w in enumerate(page.words):
        if w.start <= t:
            k = i
    return k


def word_scale(style: SubtitleStyle, word_start: float, t: float) -> float:
    if not style.wordPop:
        return 1.0
    return 1 + (WORD_POP - 1) * clamp01((t - word_start) / WORD_POP_DUR)


def segments(page: Page, style: SubtitleStyle) -> list[tuple[float, float, int]]:
    """Time slices of a page with a constant active word: (start, end, index)."""
    if not (style.karaoke or style.wordPop) or len(page.words) == 1:
        return [(page.start, page.end, 0 if (style.karaoke or style.wordPop) else -1)]
    out = []
    for i, w in enumerate(page.words):
        a = page.start if i == 0 else max(page.start, w.start)
        b = page.end if i == len(page.words) - 1 else min(page.end, page.words[i + 1].start)
        if b - a > 0.005:
            out.append((a, b, i))
    return out
