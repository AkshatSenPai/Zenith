"""M5 — conversation memory must survive a backend restart (JSON persistence per channel).

This is the fix for "Zenith forgot the conversation after a restart": memory_service kept the last-20
history in an in-memory dict that vanished when the process died. It now mirrors to a JSON file and
reloads it on boot.
"""

import memory_service


def test_commit_persists_and_reloads(tmp_path, monkeypatch):
    monkeypatch.setattr(memory_service, "_STORE", tmp_path / "history.json")
    memory_service._history.clear()
    memory_service.commit("hud", [{"role": "user", "content": "deal X is 5 lakh"}])
    memory_service._history.clear()                 # simulate a restart (wipe in-memory)
    assert memory_service.snapshot("hud") == []
    memory_service.load()                            # reload from disk
    assert memory_service.snapshot("hud") == [{"role": "user", "content": "deal X is 5 lakh"}]


def test_per_channel_isolation_persists(tmp_path, monkeypatch):
    monkeypatch.setattr(memory_service, "_STORE", tmp_path / "history.json")
    memory_service._history.clear()
    memory_service.commit("hud", [{"role": "user", "content": "hud msg"}])
    memory_service.commit("telegram", [{"role": "user", "content": "tg msg"}])
    memory_service._history.clear()
    memory_service.load()
    assert [m["content"] for m in memory_service.snapshot("hud")] == ["hud msg"]
    assert [m["content"] for m in memory_service.snapshot("telegram")] == ["tg msg"]


def test_tool_blocks_serialize_to_dicts(tmp_path, monkeypatch):
    # assistant turns hold SDK content-block OBJECTS (.type/.id/.name/.input). They must serialize to
    # plain dicts so JSON round-trips AND the API still accepts the reloaded history.
    monkeypatch.setattr(memory_service, "_STORE", tmp_path / "history.json")
    memory_service._history.clear()

    class _Text:
        type = "text"; text = "Drafting that now."

    class _ToolUse:
        type = "tool_use"; id = "t1"; name = "send_email"; input = {"to": "x@y.com"}

    working = [
        {"role": "user", "content": "email x"},
        {"role": "assistant", "content": [_Text(), _ToolUse()]},
        {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t1", "content": "sent"}]},
    ]
    memory_service.commit("hud", working)
    memory_service._history.clear()
    memory_service.load()
    snap = memory_service.snapshot("hud")
    asst = snap[1]["content"]
    assert {"type": "text", "text": "Drafting that now."} in asst
    assert {"type": "tool_use", "id": "t1", "name": "send_email", "input": {"to": "x@y.com"}} in asst
    assert snap[2]["content"][0]["tool_use_id"] == "t1"     # tool_result dict preserved


def test_corrupt_file_starts_fresh(tmp_path, monkeypatch):
    store = tmp_path / "history.json"
    store.write_text("{ not valid json", encoding="utf-8")
    monkeypatch.setattr(memory_service, "_STORE", store)
    memory_service._history.clear()
    memory_service.load()                            # must NOT raise
    assert memory_service.snapshot("hud") == []
