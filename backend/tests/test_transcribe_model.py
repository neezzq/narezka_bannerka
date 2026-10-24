import functools
import subprocess

import pytest

from .conftest import HAS_FFMPEG


def test_model_download_failure_is_explained(env, monkeypatch):
    utils = pytest.importorskip("faster_whisper.utils")
    from app.worker import transcribe

    def offline(name, local_files_only=False, cache_dir=None, **_kw):
        raise OSError("not cached" if local_files_only else "Connection refused")

    monkeypatch.setattr(utils, "download_model", offline)
    monkeypatch.setattr(transcribe, "_model", None)
    with pytest.raises(transcribe.ModelError, match="huggingface.co"):
        transcribe._get_model()


@pytest.mark.ffmpeg
@pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg not installed")
async def test_real_faster_whisper_pipeline(env, monkeypatch):
    """faster-whisper end to end on a tiny random model: catches breaking
    changes in its dependencies (PyAV 19 broke audio decoding with TypeError)."""
    pytest.importorskip("faster_whisper")
    from app.config import get_settings
    from app.worker import transcribe

    from .fake_whisper import build_fake_whisper

    model_dir = build_fake_whisper(env["tmp"] / "fake-whisper")
    monkeypatch.setenv("WHISPER_MODEL", str(model_dir))
    get_settings.cache_clear()
    monkeypatch.setattr(transcribe, "_model", None)
    wav = env["tmp"] / "speech.wav"
    # synthetic speech, so that the VAD lets it through to the decoder
    made = subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "flite=text='Hello world, this is a test.'",
                           "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(wav)], capture_output=True)
    if made.returncode != 0:
        pytest.skip("ffmpeg has no flite speech synthesis")
    # random weights never stop on their own: one temperature, a few tokens
    model = transcribe._get_model()
    monkeypatch.setattr(model, "transcribe", functools.partial(model.transcribe, temperature=0.0, max_new_tokens=20))
    progress = []

    async def on_progress(frac):
        progress.append(frac)

    for language in ("ru", None):  # forced language and auto-detection
        result = await transcribe.transcribe(wav, language, 2.0, on_progress)
        assert isinstance(result["language"], str) and result["words"]
        for w in result["words"]:
            assert w["end"] > w["start"] >= 0 and w["text"]
    monkeypatch.setattr(transcribe, "_model", None)


def test_read_wav(env):
    import wave

    np = pytest.importorskip("numpy")
    from app.worker.transcribe import read_wav

    path = env["tmp"] / "a.wav"
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(np.array([0, 16384, -32768], dtype="<i2").tobytes())
    assert read_wav(path).tolist() == [0.0, 0.5, -1.0]
