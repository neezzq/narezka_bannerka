"""Speech recognition with faster-whisper (word-level timestamps)."""

from __future__ import annotations

import asyncio
import re
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any

from ..config import get_settings

_model: Any = None
_model_lock = threading.Lock()

SENTENCE_END = re.compile(r"[.!?…]+[»\"')]*$")


def _get_model() -> Any:
    global _model
    with _model_lock:
        if _model is None:
            from faster_whisper import WhisperModel  # heavy import, only in the worker

            s = get_settings()
            s.models_dir.mkdir(parents=True, exist_ok=True)
            _model = WhisperModel(
                s.whisper_model,
                device=s.whisper_device,
                compute_type=s.whisper_compute_type,
                cpu_threads=s.whisper_cpu_threads,
                download_root=str(s.models_dir),
            )
        return _model


def _transcribe_sync(audio: Path, language: str | None, duration: float, report: Callable[[float], None]) -> dict:
    model = _get_model()
    segments, info = model.transcribe(
        str(audio),
        language=language,
        word_timestamps=True,
        vad_filter=True,
        beam_size=5,
        condition_on_previous_text=False,
    )
    words: list[dict] = []
    for seg in segments:
        for w in seg.words or []:
            text = (w.word or "").strip()
            if not text:
                continue
            start, end = float(w.start), float(w.end)
            if end <= start:
                end = start + 0.05
            words.append({"text": text, "start": round(start, 3), "end": round(end, 3)})
        if duration > 0:
            report(min(0.99, float(seg.end) / duration))
    return {"language": info.language, "words": words}


async def transcribe(audio: Path, language: str | None, duration: float, on_progress) -> dict:
    loop = asyncio.get_running_loop()

    def report(frac: float) -> None:
        asyncio.run_coroutine_threadsafe(on_progress(frac), loop)

    return await asyncio.to_thread(_transcribe_sync, audio, language, duration, report)


def group_words(
    words: list[dict],
    *,
    max_words: int = 7,
    max_chars: int = 36,
    max_gap: float = 0.7,
    max_duration: float = 4.0,
) -> list[list[dict]]:
    """Split a word stream into lines (phrases) by pauses, punctuation and length.

    Mirrored in ``frontend/src/lib/subtitles.ts`` (regroup)."""
    lines: list[list[dict]] = []
    cur: list[dict] = []
    for w in words:
        if cur:
            chars = sum(len(x["text"]) + 1 for x in cur) + len(w["text"])
            if (
                len(cur) >= max_words
                or chars > max_chars
                or w["start"] - cur[-1]["end"] > max_gap
                or w["end"] - cur[0]["start"] > max_duration
            ):
                lines.append(cur)
                cur = []
        cur.append(w)
        if SENTENCE_END.search(w["text"]):
            lines.append(cur)
            cur = []
    if cur:
        lines.append(cur)
    return lines
