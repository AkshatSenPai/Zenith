"""Notion integration — requests is mocked, no live network (mirrors test_weather.py)."""

import notion_service


class _Resp:
    def __init__(self, data, status_code=200):
        self._data = data
        self.status_code = status_code
        self.text = str(data)

    def json(self):
        return self._data


def _mock_request(monkeypatch, handler):
    """Patch notion_service.requests.request with a handler(method, url, **kw) -> _Resp."""
    def fake(method, url, **kw):
        return handler(method, url, **kw)
    monkeypatch.setattr(notion_service.requests, "request", fake)


def test_configured(monkeypatch):
    monkeypatch.delenv("NOTION_API_KEY", raising=False)
    assert notion_service.configured() is False
    monkeypatch.setenv("NOTION_API_KEY", "secret")
    assert notion_service.configured() is True


def test_status_not_configured(monkeypatch):
    monkeypatch.delenv("NOTION_API_KEY", raising=False)
    notion_service._status_cache["value"] = None
    s = notion_service.status()
    assert s == {"configured": False, "connected": False, "workspace": None, "last_error": None}


def test_status_connected(monkeypatch):
    monkeypatch.setenv("NOTION_API_KEY", "secret")
    notion_service._status_cache["value"] = None
    _mock_request(monkeypatch, lambda m, u, **k: _Resp({"name": "Zenith", "bot": {"workspace_name": "Akshat's Notion"}}))
    s = notion_service.status()
    assert s["configured"] and s["connected"]
    assert s["workspace"] == "Akshat's Notion"


def test_title_of_page_and_database():
    page = {"object": "page", "properties": {"Name": {"type": "title", "title": [{"plain_text": "Hello"}]}}}
    db = {"object": "database", "title": [{"plain_text": "Tasks DB"}]}
    assert notion_service._title_of(page) == "Hello"
    assert notion_service._title_of(db) == "Tasks DB"


def test_request_raises_on_error(monkeypatch):
    monkeypatch.setenv("NOTION_API_KEY", "secret")
    _mock_request(monkeypatch, lambda m, u, **k: _Resp({"message": "Unauthorized"}, status_code=401))
    try:
        notion_service._request("GET", "/users/me")
        assert False, "expected NotionError"
    except notion_service.NotionError as exc:
        assert "401" in str(exc)
