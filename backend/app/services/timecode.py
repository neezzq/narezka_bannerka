"""Timecode parsing/formatting: ``ss``, ``mm:ss``, ``hh:mm:ss`` with optional
fractions (``1:23.5`` or ``1:23,5``) and ranges like ``1:23-2:10``.

Mirrored on the frontend in ``frontend/src/lib/timecode.ts``."""

from __future__ import annotations

import math
import re

from .errors import UserError

_PART = r"\d+(?:[.,]\d+)?"
_TC = re.compile(rf"^\s*(?:(\d+):)?(?:(\d+):)?({_PART})\s*$")
_RANGE_SEP = re.compile(r"\s*(?:-|–|—|\.\.|\bto\b|\bдо\b)\s*", re.I)


def parse_timecode(value: str) -> float:
    """Parse a single timecode into seconds. Raises ``UserError``."""
    text = (value or "").strip()
    m = _TC.match(text)
    if not m:
        raise UserError(f"Неверный таймкод «{text}». Используйте формат мм:сс или чч:мм:сс.", code="bad_timecode")
    a, b, last = m.groups()
    seconds = float(last.replace(",", "."))
    if a is not None and b is not None:
        hours, minutes = int(a), int(b)
    elif a is not None:
        hours, minutes = 0, int(a)
    else:
        hours, minutes = 0, 0
    if a is not None:
        if seconds >= 60:
            raise UserError(f"Секунд не может быть больше 59 в «{text}».", code="bad_timecode")
        if b is not None and minutes >= 60:
            raise UserError(f"Минут не может быть больше 59 в «{text}».", code="bad_timecode")
    return hours * 3600 + minutes * 60 + seconds


def parse_range(value: str) -> tuple[float, float]:
    """Parse ``"1:23-2:10"`` into ``(83.0, 130.0)``."""
    parts = [p for p in _RANGE_SEP.split((value or "").strip()) if p.strip()]
    if len(parts) != 2:
        raise UserError("Укажите отрезок в формате «1:23-2:10».", code="bad_range")
    start, end = parse_timecode(parts[0]), parse_timecode(parts[1])
    if end <= start:
        raise UserError("Конец отрезка должен быть позже начала.", code="bad_range")
    return start, end


def format_timecode(seconds: float, fraction: bool = False) -> str:
    """``83.4 -> "1:23"`` (``"1:23.4"`` with ``fraction``), ``3723 -> "1:02:03"``."""
    seconds = max(0.0, float(seconds))
    if fraction:
        total_tenths = int(round(seconds * 10))
        whole, tenths = divmod(total_tenths, 10)
    else:
        whole, tenths = int(math.floor(seconds + 1e-6)), 0
    h, rem = divmod(whole, 3600)
    m, s = divmod(rem, 60)
    base = f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"
    return f"{base}.{tenths}" if fraction else base


def validate_range(start: float, end: float, duration: float | None, limit: float) -> tuple[float, float]:
    if start < 0 or end <= start:
        raise UserError("Конец отрезка должен быть позже начала.", code="bad_range")
    if duration is not None and duration > 0:
        if start >= duration:
            raise UserError("Начало отрезка за пределами видео.", code="bad_range")
        end = min(end, duration)
    if end - start < 0.5:
        raise UserError("Отрезок слишком короткий — минимум полсекунды.", code="bad_range")
    if end - start > limit + 0.05:
        raise UserError(
            f"Отрезок длиннее лимита {format_timecode(limit)}. Сократите выбор.", code="range_too_long"
        )
    return round(start, 3), round(end, 3)
