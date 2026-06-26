"""M4 Telegram tests: the security allow-list (fail-closed), the confirm-summary rendering, the
chat_core refactor (per-channel memory, pending stores its channel), and the first-contact welcome.
PTB/Claude are not called."""

import asyncio
import os
from unittest import mock

import chat_core
import memory_service
import telegram_service


# ---- minimal PTB stand-ins (no network) ----

class _FakeMsg:
    def __init__(self, text):
        self.text = text
        self.sent: list[str] = []

    async def reply_text(self, text, **_kw):
        self.sent.append(text)


class _FakeUser:
    def __init__(self, uid):
        self.id = uid


class _FakeUpdate:
    def __init__(self, user, msg):
        self.effective_user = user
        self.message = msg


def test_allow_list_fail_closed():
    os.environ.pop("TELEGRAM_ALLOWED_USER_IDS", None)
    assert telegram_service._allowed_ids() == set()

    class U:  # noqa: D401 - stub
        id = 5

    assert telegram_service._is_allowed(U()) is False          # empty list rejects everyone
    assert telegram_service._is_allowed(None) is False
    os.environ["TELEGRAM_ALLOWED_USER_IDS"] = "5, 9"
    assert telegram_service._is_allowed(U()) is True

    class V:
        id = 7

    assert telegram_service._is_allowed(V()) is False           # unlisted id rejected


def test_action_summary():
    s = telegram_service._action_summary("send_email", {"to": "rahul@x.com", "subject": "Hi", "body": "Late"})
    assert "rahul@x.com" in s and "Late" in s


def test_process_chat_reply_isolated_per_channel():
    memory_service._history.clear()
    with mock.patch.object(chat_core, "run_loop", return_value={"reply": "hi from zenith"}):
        out = chat_core.process_chat("hello", "telegram")
    assert out["reply"] == "hi from zenith"
    assert [m["content"] for m in memory_service.snapshot("telegram")] == ["hello"]
    assert memory_service.snapshot("hud") == []                 # channels don't bleed


def test_process_chat_pending_stores_channel():
    chat_core.PENDING.clear()
    with mock.patch.object(chat_core, "run_loop",
                           return_value={"pending": {"to": "x"}, "tool": "send_email", "id": "abc"}):
        out = chat_core.process_chat("email x", "telegram")
    assert out["pending"] == {"to": "x"} and out["tool"] == "send_email" and out["id"] == "abc"
    assert chat_core.PENDING["abc"]["channel"] == "telegram"    # confirm will commit to the right channel


# ---- first-contact welcome ----

def test_start_command_sends_welcome(monkeypatch):
    monkeypatch.setenv("TELEGRAM_ALLOWED_USER_IDS", "5")
    telegram_service._seen_users.clear()
    msg = _FakeMsg("/start")
    asyncio.run(telegram_service._on_start(_FakeUpdate(_FakeUser(5), msg), None))
    assert msg.sent == [telegram_service.WELCOME]


def test_first_message_greets_once_then_answers(monkeypatch):
    monkeypatch.setenv("TELEGRAM_ALLOWED_USER_IDS", "5")
    telegram_service._seen_users.clear()
    monkeypatch.setattr(chat_core, "process_chat", lambda text, ch: {"reply": "ok"})
    user = _FakeUser(5)

    m1 = _FakeMsg("hello")
    asyncio.run(telegram_service._on_message(_FakeUpdate(user, m1), None))
    assert m1.sent == [telegram_service.WELCOME, "ok"]   # greeted, then the real answer

    m2 = _FakeMsg("again")
    asyncio.run(telegram_service._on_message(_FakeUpdate(user, m2), None))
    assert m2.sent == ["ok"]                             # no re-greet on later messages


def test_welcome_not_sent_to_unauthorized(monkeypatch):
    monkeypatch.setenv("TELEGRAM_ALLOWED_USER_IDS", "5")
    telegram_service._seen_users.clear()
    msg = _FakeMsg("hi")
    asyncio.run(telegram_service._on_message(_FakeUpdate(_FakeUser(99), msg), None))
    asyncio.run(telegram_service._on_start(_FakeUpdate(_FakeUser(99), msg), None))
    assert msg.sent == []                               # unlisted id gets nothing
