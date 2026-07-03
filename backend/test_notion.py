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


def test_list_pages_parses(monkeypatch):
    monkeypatch.setenv("NOTION_API_KEY", "secret")
    results = {"results": [
        {"object": "page", "id": "p1", "last_edited_time": "2026-07-03T00:00:00Z",
         "properties": {"Name": {"type": "title", "title": [{"plain_text": "My Page"}]}}},
    ]}
    _mock_request(monkeypatch, lambda m, u, **k: _Resp(results))
    pages = notion_service.list_pages()
    assert pages == [{"id": "p1", "title": "My Page", "last_edited": "2026-07-03T00:00:00Z"}]


def test_read_page_extracts_text(monkeypatch):
    monkeypatch.setenv("NOTION_API_KEY", "secret")

    def handler(method, url, **kw):
        if url.endswith("/pages/pg"):
            return _Resp({"object": "page", "properties": {"Name": {"type": "title", "title": [{"plain_text": "Notes"}]}}})
        if "/blocks/pg/children" in url:
            return _Resp({"results": [
                {"type": "heading_1", "heading_1": {"rich_text": [{"plain_text": "Heading"}]}},
                {"type": "paragraph", "paragraph": {"rich_text": [{"plain_text": "Body line."}]}},
                {"type": "to_do", "to_do": {"rich_text": [{"plain_text": "task"}], "checked": True}},
                {"type": "unsupported_widget", "unsupported_widget": {}},
            ], "has_more": False})
        raise AssertionError(url)

    _mock_request(monkeypatch, handler)
    text = notion_service.read_page("pg")
    assert "# Notes" in text and "Heading" in text and "Body line." in text and "[x] task" in text
    assert "unsupported" not in text


def test_read_page_respects_max_blocks(monkeypatch):
    monkeypatch.setenv("NOTION_API_KEY", "secret")
    many = [{"type": "paragraph", "paragraph": {"rich_text": [{"plain_text": f"line {i}"}]}} for i in range(100)]

    def handler(method, url, **kw):
        if url.endswith("/pages/pg"):
            return _Resp({"object": "page", "properties": {"Name": {"type": "title", "title": [{"plain_text": "T"}]}}})
        if "/blocks/pg/children" in url:
            return _Resp({"results": many, "has_more": True, "next_cursor": "c"})
        raise AssertionError(url)

    _mock_request(monkeypatch, handler)
    text = notion_service.read_page("pg", max_blocks=10)
    body = text.split("\n\n", 1)[1]
    assert len(body.splitlines()) == 10  # capped at max_blocks, not 100


def test_query_database_flattens(monkeypatch):
    monkeypatch.setenv("NOTION_API_KEY", "secret")
    rows = {"results": [
        {"id": "r1", "properties": {
            "Name": {"type": "title", "title": [{"plain_text": "Row one"}]},
            "Status": {"type": "select", "select": {"name": "Done"}},
            "Count": {"type": "number", "number": 3},
        }},
    ]}
    _mock_request(monkeypatch, lambda m, u, **k: _Resp(rows))
    out = notion_service.query_database("db")
    assert out[0]["id"] == "r1" and out[0]["title"] == "Row one"
    assert out[0]["properties"]["Status"] == "Done" and out[0]["properties"]["Count"] == "3"
