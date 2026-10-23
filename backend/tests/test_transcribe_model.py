import pytest


def test_model_download_failure_is_explained(env, monkeypatch):
    utils = pytest.importorskip("faster_whisper.utils")
    from app.worker import transcribe

    def offline(name, local_files_only=False, cache_dir=None, **_kw):
        raise OSError("not cached" if local_files_only else "Connection refused")

    monkeypatch.setattr(utils, "download_model", offline)
    monkeypatch.setattr(transcribe, "_model", None)
    with pytest.raises(transcribe.ModelError, match="huggingface.co"):
        transcribe._get_model()
