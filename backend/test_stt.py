import stt_service


class _Seg:
    def __init__(self, text):
        self.text = text


class _FakeModel:
    def __init__(self, segments):
        self._segments = segments

    def transcribe(self, audio, language=None, beam_size=1):
        return self._segments, None


def test_transcribe_joins_and_strips(monkeypatch):
    monkeypatch.setattr(stt_service, "get_model", lambda: _FakeModel([_Seg(" namaste "), _Seg("boss")]))
    assert stt_service.transcribe_audio(b"fake-bytes") == "namaste boss"


def test_transcribe_empty_returns_blank(monkeypatch):
    monkeypatch.setattr(stt_service, "get_model", lambda: _FakeModel([]))
    assert stt_service.transcribe_audio(b"fake-bytes") == ""
