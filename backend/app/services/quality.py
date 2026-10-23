"""Video quality classes ("1080p"), shared by downloads and exports."""

from __future__ import annotations

# quality classes by short side; the long side catches letterboxed formats
# (1920×804 is "1080p", as YouTube labels it)
LADDER = (144, 240, 360, 480, 720, 1080, 1440, 2160, 4320)
_LONG = {256: 144, 426: 240, 640: 360, 854: 480, 1280: 720, 1920: 1080, 2560: 1440, 3840: 2160, 7680: 4320}


def quality_class(width: int, height: int) -> int:
    """1920×1080, 1080×1920 and 1920×804 → 1080; 0 when unknown."""
    if not width or not height:
        return 0
    short, long_ = min(width, height), max(width, height)
    by_short = max((q for q in LADDER if q <= short * 1.05), default=0)
    by_long = max((q for side, q in _LONG.items() if side <= long_ * 1.05), default=0)
    return max(by_short, by_long)
