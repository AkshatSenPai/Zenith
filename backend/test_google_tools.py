"""Milestone 3 tool-layer tests: registry, action classification, formatting, briefing
assembly, and graceful degradation. The Google/weather service layers are mocked, so this
runs with no credentials and no network."""

from unittest import mock

import google_service
import tools
import weather_service


def test_registry_complete():
    names = {t["name"] for t in tools.TOOLS}
    expected = {
        "get_calendar_events", "search_calendar", "create_event", "update_event", "delete_event",
        "get_emails", "search_emails", "read_email", "send_email", "get_weather", "get_briefing",
    }
    assert expected <= names
    for t in tools.TOOLS:                       # every schema has an executor
        assert t["name"] in tools._EXECUTORS


def test_action_tools_set():
    assert tools.ACTION_TOOLS == {"send_message", "create_event", "update_event", "delete_event", "send_email"}


def test_get_calendar_events_formats():
    fake = [{
        "id": "e1", "title": "Funnel call", "start": "2026-06-26T10:00:00+05:30",
        "end": "2026-06-26T10:45:00+05:30", "all_day": False, "location": "Zoom", "attendees": [],
    }]
    with mock.patch.object(google_service, "get_events", return_value=fake):
        out = tools.run_tool("get_calendar_events", {"when": "today"})
    assert "Funnel call" in out and "10:00" in out and "id:e1" in out


def test_create_event_passthrough():
    with mock.patch.object(
        google_service, "create_event",
        return_value={"id": "x", "title": "Call", "start": "2026-06-26T16:00:00", "end": "2026-06-26T17:00:00"},
    ) as m:
        out = tools.run_tool("create_event", {"summary": "Call", "start": "2026-06-26T16:00:00"})
    m.assert_called_once()
    assert "Created" in out and "Call" in out


def test_create_event_requires_fields():
    out = tools.run_tool("create_event", {"summary": "Call"})   # missing start
    assert "needs" in out.lower()


def test_disconnected_is_graceful():
    with mock.patch.object(google_service, "get_emails", side_effect=google_service.NotConnected("Not connected to Google.")):
        out = tools.run_tool("get_emails", {"filter": "unread"})
    assert "Not connected to Google." in out   # surfaced as text, not raised


def test_weather_unavailable_graceful():
    with mock.patch.object(weather_service, "get_weather", side_effect=weather_service.WeatherUnavailable("set WEATHER_API_KEY")):
        out = tools.run_tool("get_weather", {})
    assert "WEATHER_API_KEY" in out


def test_briefing_assembles_all_sections():
    events = [{"id": "e1", "title": "Standup", "start": "2026-06-26T09:00:00+05:30",
               "end": "2026-06-26T09:15:00+05:30", "all_day": False, "location": None, "attendees": []}]
    unread = [{"id": "m1", "from": "rahul@x.com", "subject": "Invoice due", "snippet": "please find", "unread": True}]
    wx = {"location": "Hyderabad", "condition": "Clear", "temp_c": 31, "feels_like_c": 34,
          "temp_min_c": 28, "temp_max_c": 33, "humidity": 40}
    with mock.patch.object(google_service, "get_events", return_value=events), \
         mock.patch.object(google_service, "get_emails", return_value=unread), \
         mock.patch.object(weather_service, "get_weather", return_value=wx):
        out = tools.build_briefing()
    assert "Standup" in out and "Invoice due" in out and "Hyderabad" in out


def test_briefing_degrades_per_section():
    with mock.patch.object(google_service, "get_events", side_effect=google_service.NotConnected("x")), \
         mock.patch.object(google_service, "get_emails", side_effect=google_service.NotConnected("x")), \
         mock.patch.object(weather_service, "get_weather", side_effect=weather_service.WeatherUnavailable("set key")):
        out = tools.build_briefing()
    assert "Calendar: not connected." in out
    assert "Email: not connected." in out
    assert "set key" in out
