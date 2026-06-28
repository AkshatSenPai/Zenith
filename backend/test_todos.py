"""Vault-backed to-dos: todo_service round-trips (parse/add/toggle/remove/complete-by-text,
non-checklist lines preserved), the 3 Claude tools, and the HTTP routes. Filesystem only — no Claude."""

import pytest

import todo_service
import vault_service  # noqa: F401  (kept for parity / future use)


@pytest.fixture(autouse=True)
def _vault(tmp_path, monkeypatch):
    root = tmp_path / "Zenith Vault"   # a path WITH A SPACE, like the real vault
    root.mkdir()
    monkeypatch.setenv("ZENITH_VAULT_PATH", str(root))
    return root


# ---------- Task 2: service ----------

def test_empty_when_no_file(_vault):
    assert todo_service.list_todos() == []


def test_add_then_list_roundtrip(_vault):
    todo_service.add_todo("Send Shadnagar proposal")
    todos = todo_service.list_todos()
    assert todos == [{"index": 0, "text": "Send Shadnagar proposal", "done": False}]
    assert (_vault / "Todos.md").exists()


def test_add_rejects_blank(_vault):
    with pytest.raises(ValueError):
        todo_service.add_todo("   ")


def test_set_done_toggles(_vault):
    todo_service.add_todo("a")
    todo_service.add_todo("b")
    todo_service.set_done(1, True)
    todos = todo_service.list_todos()
    assert todos[1]["done"] is True and todos[0]["done"] is False
    todo_service.set_done(1, False)
    assert todo_service.list_todos()[1]["done"] is False


def test_remove_drops_item(_vault):
    todo_service.add_todo("a")
    todo_service.add_todo("b")
    todo_service.remove(0)
    assert [t["text"] for t in todo_service.list_todos()] == ["b"]


def test_bad_index_raises(_vault):
    with pytest.raises(IndexError):
        todo_service.set_done(5, True)
    with pytest.raises(IndexError):
        todo_service.remove(0)


def test_complete_by_text_first_open_case_insensitive(_vault):
    todo_service.add_todo("Call Rahul")
    todo_service.add_todo("Email Venkata")
    hit = todo_service.complete_by_text("venkata")
    assert hit and hit["text"] == "Email Venkata" and hit["done"] is True
    assert todo_service.list_todos()[1]["done"] is True
    assert todo_service.complete_by_text("nope") is None


def test_non_checklist_lines_preserved(_vault):
    (_vault / "Todos.md").write_text("# My list\n\n- [ ] keep me\nsome note\n", encoding="utf-8")
    todo_service.add_todo("new one")
    todo_service.set_done(0, True)
    raw = (_vault / "Todos.md").read_text(encoding="utf-8")
    assert "# My list" in raw and "some note" in raw
    assert "- [x] keep me" in raw and "- [ ] new one" in raw


# ---------- Task 3: tools ----------

import tools  # noqa: E402


def test_todo_tools_registered_not_gated(_vault):
    for t in ("add_todo", "list_todos", "complete_todo"):
        assert t in tools._EXECUTORS
        assert t not in tools.ACTION_TOOLS         # local writes — never gated
        assert t not in tools.UNTRUSTED_TOOLS      # owner's own to-dos are trusted


def test_add_and_list_tools(_vault):
    assert "Added to your to-do list: Pay GST" in tools.run_tool("add_todo", {"text": "Pay GST"})
    listed = tools.run_tool("list_todos", {})
    assert "Pay GST" in listed and "- [ ]" in listed


def test_complete_tool(_vault):
    tools.run_tool("add_todo", {"text": "Call Rahul"})
    assert "Marked done: Call Rahul" in tools.run_tool("complete_todo", {"task": "rahul"})
    assert tools.run_tool("complete_todo", {"task": "ghost"}).startswith("Couldn't find")
