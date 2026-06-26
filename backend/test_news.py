"""M5+ — news headlines for the morning briefing (free RSS, world+India mix). Network is mocked."""

from unittest import mock

import google_service
import news_service
import tools
import weather_service


class _Parsed:
    def __init__(self, titles):
        self.entries = [{"title": t} for t in titles]


def test_headlines_interleave_world_and_india(monkeypatch):
    monkeypatch.setattr(news_service, "_feeds", lambda: [("World", "w"), ("India", "i")])
    monkeypatch.setattr(news_service, "_fetch",
                        lambda url: _Parsed(["W1", "W2", "W3"] if url == "w" else ["I1", "I2", "I3"]))
    h = news_service.get_headlines(5)
    assert [x["source"] for x in h] == ["World", "India", "World", "India", "World"]
    assert [x["title"] for x in h] == ["W1", "I1", "W2", "I2", "W3"]


def test_headlines_one_dead_feed_still_works(monkeypatch):
    def fetch(url):
        if url == "w":
            return _Parsed(["W1", "W2"])
        raise RuntimeError("india feed down")
    monkeypatch.setattr(news_service, "_feeds", lambda: [("World", "w"), ("India", "i")])
    monkeypatch.setattr(news_service, "_fetch", fetch)
    h = news_service.get_headlines(5)
    assert [x["title"] for x in h] == ["W1", "W2"]      # survives one bad feed


def test_headlines_all_dead_raises(monkeypatch):
    def boom(url):
        raise RuntimeError("down")
    monkeypatch.setattr(news_service, "_feeds", lambda: [("World", "w")])
    monkeypatch.setattr(news_service, "_fetch", boom)
    import pytest
    with pytest.raises(news_service.NewsUnavailable):
        news_service.get_headlines()


def test_get_news_tool_formats_and_is_fenced(monkeypatch):
    monkeypatch.setattr(news_service, "get_headlines",
                        lambda limit=5: [{"title": "Markets rally", "source": "World"},
                                         {"title": "Monsoon arrives", "source": "India"}])
    res = tools.run_tool("get_news", {})
    assert "Markets rally" in res and "Monsoon arrives" in res
    assert res.lstrip().startswith("<external-content")    # headlines are external content -> fenced


def test_briefing_includes_headlines(monkeypatch):
    monkeypatch.setattr(news_service, "get_headlines", lambda limit=5: [{"title": "World news A", "source": "World"}])
    with mock.patch.object(google_service, "get_events", side_effect=google_service.NotConnected("x")), \
         mock.patch.object(google_service, "get_emails", side_effect=google_service.NotConnected("x")), \
         mock.patch.object(weather_service, "get_weather", side_effect=weather_service.WeatherUnavailable("x")):
        out = tools.build_briefing()
    assert "World news A" in out and "headlines" in out.lower()


def test_briefing_degrades_when_news_down(monkeypatch):
    def boom(limit=5):
        raise news_service.NewsUnavailable("feeds down")
    monkeypatch.setattr(news_service, "get_headlines", boom)
    with mock.patch.object(google_service, "get_events", side_effect=google_service.NotConnected("x")), \
         mock.patch.object(google_service, "get_emails", side_effect=google_service.NotConnected("x")), \
         mock.patch.object(weather_service, "get_weather", side_effect=weather_service.WeatherUnavailable("x")):
        out = tools.build_briefing()
    assert "feeds down" in out                              # degrades, never crashes
