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


def test_coerce_properties_types():
    schema = {"properties": {
        "Name": {"type": "title"}, "Notes": {"type": "rich_text"}, "Count": {"type": "number"},
        "Status": {"type": "select"}, "Due": {"type": "date"}, "Done": {"type": "checkbox"},
    }}
    payload, skipped = notion_service._coerce_properties(schema, {
        "name": "Task", "Count": 5, "Status": "Open", "Due": "2026-07-10", "Done": "yes", "Ghost": "x",
    })
    assert payload["Name"]["title"][0]["text"]["content"] == "Task"   # case-insensitive name match
    assert payload["Count"]["number"] == 5.0
    assert payload["Status"]["select"]["name"] == "Open"
    assert payload["Due"]["date"]["start"] == "2026-07-10"
    assert payload["Done"]["checkbox"] is True
    assert "Ghost" in skipped


def test_create_page_builds_body(monkeypatch):
    monkeypatch.setenv("NOTION_API_KEY", "secret")
    seen = {}

    def handler(method, url, **kw):
        if url.endswith("/pages") and method == "POST":
            seen["body"] = kw.get("json")
            return _Resp({"id": "new1", "url": "http://n/new1"})
        raise AssertionError(url)

    _mock_request(monkeypatch, handler)
    msg = notion_service.create_page("11111111111111111111111111111111", "Title", "Line 1\n\nLine 2")
    assert "new1" in msg
    assert seen["body"]["parent"] == {"page_id": "11111111111111111111111111111111"}
    assert seen["body"]["properties"]["title"]["title"][0]["text"]["content"] == "Title"
    assert len(seen["body"]["children"]) == 2


def test_create_page_unresolved_name(monkeypatch):
    monkeypatch.setenv("NOTION_API_KEY", "secret")
    _mock_request(monkeypatch, lambda m, u, **k: _Resp({"results": []}))  # search finds nothing
    msg = notion_service.create_page("Nonexistent Page", "T", "")
    assert "Couldn't find" in msg and "share it" in msg.lower()


def test_create_database_item_coerces(monkeypatch):
    monkeypatch.setenv("NOTION_API_KEY", "secret")
    seen = {}

    def handler(method, url, **kw):
        if url.endswith("/search") and method == "POST":  # name -> id resolution
            return _Resp({"results": [{"object": "database", "id": "db1"}]})
        if "/databases/db1" in url and method == "GET":
            return _Resp({"properties": {"Name": {"type": "title"}, "Count": {"type": "number"}}})
        if url.endswith("/pages") and method == "POST":
            seen["body"] = kw.get("json")
            return _Resp({"id": "row1", "url": "http://n/row1"})
        raise AssertionError(url)

    _mock_request(monkeypatch, handler)
    msg = notion_service.create_database_item("db1", {"Name": "Widget", "Count": 7})
    assert "row1" in msg
    assert seen["body"]["parent"] == {"database_id": "db1"}
    assert seen["body"]["properties"]["Name"]["title"][0]["text"]["content"] == "Widget"
    assert seen["body"]["properties"]["Count"]["number"] == 7.0


import tools


def test_gate_and_untrusted_membership():
    assert {"create_notion_page", "create_notion_database_item"} <= tools.ACTION_TOOLS
    reads = {"list_notion_pages", "list_notion_databases", "search_notion", "read_notion_page", "query_notion_database"}
    assert reads <= tools.UNTRUSTED_TOOLS


def test_all_notion_tools_registered():
    names = {t["name"] for t in tools.TOOLS}
    expected = {"list_notion_pages", "list_notion_databases", "search_notion", "read_notion_page",
                "query_notion_database", "create_notion_page", "create_notion_database_item"}
    assert expected <= names
    assert expected <= set(tools._EXECUTORS)


def test_read_notion_page_executor(monkeypatch):
    monkeypatch.setattr(tools.notion_service, "read_page", lambda pid: f"# Page {pid}")
    out = tools.run_tool("read_notion_page", {"page_id": "abc"})
    assert "# Page abc" in out                 # executor wired to notion_service.read_page
    assert out.startswith("<external-content")  # ...and fenced as untrusted (read tool)


def test_notion_activity_mapped():
    import activity_log
    for name in ("read_notion_page", "create_notion_page", "create_notion_database_item"):
        assert name in activity_log._MAP


def test_notion_status_route(monkeypatch):
    import main
    monkeypatch.setattr(main.notion_service, "status", lambda: {"configured": True, "connected": True, "workspace": "W", "last_error": None})
    assert main.notion_status() == {"configured": True, "connected": True, "workspace": "W", "last_error": None}


# ---------- Phase 2: edit / delete / structure / comments ----------


def test_db_indirection_shapes(monkeypatch):
    monkeypatch.setenv("NOTION_API_KEY", "secret")
    seen = {}
    def handler(method, url, **kw):
        seen["last"] = (method, url)
        if url.endswith("/databases/db/query"):
            return _Resp({"results": []})
        return _Resp({"properties": {}})
    _mock_request(monkeypatch, handler)
    assert notion_service._db_parent("db") == {"database_id": "db"}
    notion_service._db_query("db", {"page_size": 1})
    assert seen["last"] == ("POST", "https://api.notion.com/v1/databases/db/query")
    notion_service._db_schema("db")
    assert seen["last"] == ("GET", "https://api.notion.com/v1/databases/db")


def test_blocks_from_spec_types():
    blocks = notion_service._blocks_from_spec([
        {"type": "heading_2", "text": "Plan"},
        {"type": "to_do", "text": "book flights", "checked": True},
        {"type": "bulleted_list_item", "text": "pack"},
        {"type": "divider"},
        {"type": "weird", "text": "fallback to paragraph"},
        {"type": "paragraph", "text": ""},  # empty -> dropped
    ])
    types = [b["type"] for b in blocks]
    assert types == ["heading_2", "to_do", "bulleted_list_item", "divider", "paragraph"]
    assert blocks[1]["to_do"]["checked"] is True
    assert blocks[0]["heading_2"]["rich_text"][0]["text"]["content"] == "Plan"


def test_append_to_page(monkeypatch):
    monkeypatch.setenv("NOTION_API_KEY", "secret")
    seen = {}
    def handler(method, url, **kw):
        if url.endswith("/search"):
            return _Resp({"results": [{"object": "page", "id": "pg"}]})
        if "/blocks/pg/children" in url and method == "PATCH":
            seen["body"] = kw.get("json")
            return _Resp({"results": []})
        raise AssertionError((method, url))
    _mock_request(monkeypatch, handler)
    msg = notion_service.append_to_page("My Page", content="line one\n\nline two")
    assert "2 block" in msg
    assert len(seen["body"]["children"]) == 2
