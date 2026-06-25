"""M4 Discord tool-layer tests: registry, action classification, formatting, graceful
degradation, and activity mapping. discord_service is mocked — no bot, token, or network."""

from unittest import mock

import activity_log
import discord_service
import tools


def test_discord_tools_registered():
    names = {t["name"] for t in tools.TOOLS}
    assert {"list_discord_channels", "get_discord_messages", "search_discord_messages", "send_discord_message"} <= names
    assert "send_discord_message" in tools.ACTION_TOOLS
    for n in ("list_discord_channels", "get_discord_messages", "search_discord_messages", "send_discord_message"):
        assert n in tools._EXECUTORS


def test_get_discord_messages_formats():
    fake = [
        {"id": "1", "author": "Rahul", "text": "deploy done", "time": "2026-06-25T14:00:00+05:30", "channel": "general"},
        {"id": "2", "author": "Me", "text": "nice", "time": "2026-06-25T14:01:00+05:30", "channel": "general"},
    ]
    with mock.patch.object(discord_service, "get_messages", return_value=fake) as m:
        out = tools.run_tool("get_discord_messages", {"channel": "#general", "limit": 5})
    m.assert_called_once_with("#general", 5)
    assert "Rahul" in out and "deploy done" in out and "id:1" in out


def test_send_discord_passthrough():
    with mock.patch.object(discord_service, "send_message", return_value={"id": "9", "channel": "team", "guild": "Zen"}) as m:
        out = tools.run_tool("send_discord_message", {"channel": "#team", "text": "on my way"})
    m.assert_called_once_with("#team", "on my way")
    assert "Posted to #team" in out


def test_send_discord_requires_fields():
    assert "needs" in tools.run_tool("send_discord_message", {"channel": "#team"}).lower()


def test_discord_disconnected_graceful():
    with mock.patch.object(discord_service, "list_channels",
                           side_effect=discord_service.DiscordNotConnected("Discord is not configured.")):
        out = tools.run_tool("list_discord_channels", {})
    assert "not configured" in out.lower()


def test_discord_channel_not_found_graceful():
    with mock.patch.object(discord_service, "get_messages",
                           side_effect=discord_service.DiscordChannelNotFound("No channel matching 'nope'.")):
        out = tools.run_tool("get_discord_messages", {"channel": "nope"})
    assert "No channel matching" in out


def test_discord_activity_recording():
    before = len(activity_log.entries())
    with mock.patch.object(discord_service, "send_message", return_value={"id": "9", "channel": "team", "guild": "Zen"}):
        tools.run_tool("send_discord_message", {"channel": "#team", "text": "hi"})
    after = activity_log.entries()
    assert len(after) == before + 1
    assert after[0]["type"] == "message" and after[0]["tone"] == "ok" and after[0]["target"] == "#team"
    # a disconnected read returns a string but must NOT be logged
    with mock.patch.object(discord_service, "list_channels", side_effect=discord_service.DiscordNotConnected("x")):
        tools.run_tool("list_discord_channels", {})
    assert len(activity_log.entries()) == before + 1
