import types

import stt_service


class _Seg:
    def __init__(self, text):
        self.text = text


class _Model:
    """Fake whisper model. `script` maps the `language` arg passed to transcribe()
    to (text, detected_language). Records which languages it was called with."""

    def __init__(self, script):
        self.script = script
        self.calls = []

    def transcribe(self, audio, language=None, **kwargs):
        self.calls.append(language)
        text, detected = self.script.get(language, ("UNSCRIPTED", "en"))
        return [_Seg(text)], types.SimpleNamespace(language=detected)


def _use(monkeypatch, script, lang=None):
    monkeypatch.setattr(stt_service, "WHISPER_LANGUAGE", lang)
    model = _Model(script)
    monkeypatch.setattr(stt_service, "get_model", lambda: model)
    return model


def test_english_is_kept_as_latin(monkeypatch):
    _use(monkeypatch, {None: ("Send a message to Rahul", "en")})
    assert stt_service.transcribe_audio(b"x") == "Send a message to Rahul"


def test_empty_audio_returns_blank(monkeypatch):
    _use(monkeypatch, {None: ("", "en")})
    assert stt_service.transcribe_audio(b"x") == ""


def test_strips_whitespace(monkeypatch):
    _use(monkeypatch, {None: ("  hello boss  ", "en")})
    assert stt_service.transcribe_audio(b"x") == "hello boss"


def test_undecodable_clip_returns_blank(monkeypatch):
    # An accidental mic tap is a header-only webm; faster-whisper's decoder raises
    # (av.error.EOFError in prod). Treat it as "no speech", never a 500.
    class _Boom:
        def transcribe(self, *a, **k):
            raise EOFError("End of file: '<none>'")

    monkeypatch.setattr(stt_service, "WHISPER_LANGUAGE", None)
    monkeypatch.setattr(stt_service, "get_model", lambda: _Boom())
    assert stt_service.transcribe_audio(b"\x00" * 110) == ""


def test_hindi_is_romanized_to_latin(monkeypatch):
    # Auto-detected Hindi → Devanagari → romanized to Latin (faithful words, Roman script).
    model = _use(monkeypatch, {None: ("अपने बारे में बताओ", "hi")})
    out = stt_service.transcribe_audio(b"x")
    assert out.isascii(), f"expected Latin, got {out!r}"
    assert out  # non-empty
    assert model.calls == [None]  # single pass — hi is acceptable


def test_urdu_drift_is_reforced_to_hindi(monkeypatch):
    # If auto-detect drifts to Urdu (Arabic script), re-transcribe forced to Hindi.
    model = _use(monkeypatch, {
        None: ("اردو ٹیکسٹ", "ur"),            # auto pass → Urdu (rejected)
        "hi": ("अपने बारे में बताओ", "hi"),    # forced-hi pass → Devanagari
    })
    out = stt_service.transcribe_audio(b"x")
    assert out.isascii(), f"expected Latin, got {out!r}"
    assert model.calls == [None, "hi"], model.calls  # two passes
    assert "اردو" not in out


def test_explicit_language_is_respected(monkeypatch):
    # If the user forces a language via .env, don't second-guess it (no re-forcing).
    model = _use(monkeypatch, {"hi": ("नमस्ते", "hi")}, lang="hi")
    out = stt_service.transcribe_audio(b"x")
    assert out.isascii()
    assert model.calls == ["hi"]


def test_get_model_falls_back_to_cpu_when_cuda_unavailable(monkeypatch):
    # Opting into GPU via .env must not brick startup if CUDA/cuDNN is missing.
    devices = []

    class _FakeWhisperModel:
        def __init__(self, model, device="cpu", compute_type="default"):
            devices.append(device)
            if device != "cpu":
                raise RuntimeError("CUDA driver / cuDNN not available")

    monkeypatch.setattr(stt_service, "WhisperModel", _FakeWhisperModel)
    monkeypatch.setattr(stt_service, "WHISPER_DEVICE", "cuda")
    monkeypatch.setattr(stt_service, "WHISPER_COMPUTE", "float16")
    stt_service.get_model.cache_clear()
    try:
        stt_service.get_model()
        assert devices == ["cuda", "cpu"]  # tried GPU, fell back to CPU
    finally:
        stt_service.get_model.cache_clear()
