"""Speech recognition with faster-whisper (word-level timestamps)."""

from __future__ import annotations

import asyncio
import logging
import re
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any

from ..config import get_settings

log = logging.getLogger("bannerka.whisper")
_model: Any = None
_model_lock = threading.Lock()

SENTENCE_END = re.compile(r"[.!?…]+[»\"')]*$")


class ModelError(Exception):
    """The speech model could not be fetched or started; the message is user-facing."""


def _get_model() -> Any:
    global _model
    with _model_lock:
        if _model is None:
            try:  # heavy import, only in the worker
                from faster_whisper import WhisperModel
                from faster_whisper.utils import download_model
            except ImportError as exc:
                raise ModelError("Распознавание речи не установлено на сервере: соберите образ с WITH_WHISPER=1.") from exc

            s = get_settings()
            s.models_dir.mkdir(parents=True, exist_ok=True)
            name = s.whisper_model
            path = name if Path(name).is_dir() else None
            if path is None:
                try:  # cached copy first: no network round trip on every worker start
                    path = download_model(name, local_files_only=True, cache_dir=str(s.models_dir))
                except Exception:  # noqa: BLE001 - not cached yet
                    log.info("downloading whisper model %s into %s", name, s.models_dir)
                    try:
                        path = download_model(name, cache_dir=str(s.models_dir))
                    except Exception as exc:
                        log.exception("whisper model %s download failed", name)
                        raise ModelError(
                            f"Не удалось скачать модель распознавания речи «{name}»: сервер не достучался "
                            "до huggingface.co. Попробуйте позже."
                        ) from exc
            try:
                _model = WhisperModel(
                    path,
                    device=s.whisper_device,
                    compute_type=s.whisper_compute_type,
                    cpu_threads=s.whisper_cpu_threads,
                )
            except Exception as exc:
                log.exception("whisper model %s failed to load", name)
                raise ModelError(
                    "Не удалось запустить модель распознавания речи на сервере. Если на сервере мало памяти, "
                    "укажите WHISPER_MODEL=base в .env."
                ) from exc
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
