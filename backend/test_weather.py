"""Weather: hyperlocal via WEATHER_LAT/WEATHER_LON (the owner is in Jangpura, not the Delhi centroid).

Precedence: an explicit location arg > WEATHER_LAT/WEATHER_LON > WEATHER_DEFAULT_LOCATION > built-in
default. requests is mocked — no network."""

import pytest

import weather_service


class _Resp:
    status_code = 200

    def __init__(self, data):
        self._data = data

    def json(self):
        return self._data

    def raise_for_status(self):
        pass


_OK = {
    "name": "Jangpura",
    "main": {"temp": 34, "feels_like": 38, "temp_min": 33, "temp_max": 36, "humidity": 40},
    "weather": [{"description": "haze"}],
}


def _capture(monkeypatch):
    seen = {}

    def fake_get(url, params=None, timeout=None):
        seen["params"] = params
        return _Resp(_OK)

    monkeypatch.setattr(weather_service.requests, "get", fake_get)
    return seen


def test_uses_latlon_when_set(monkeypatch):
    monkeypatch.setenv("WEATHER_API_KEY", "k")
    monkeypatch.setenv("WEATHER_LAT", "28.5836")
    monkeypatch.setenv("WEATHER_LON", "77.2410")
    monkeypatch.delenv("WEATHER_DEFAULT_LOCATION", raising=False)
    seen = _capture(monkeypatch)

    w = weather_service.get_weather()

    assert seen["params"]["lat"] == "28.5836" and seen["params"]["lon"] == "77.2410"
    assert "q" not in seen["params"]
    assert w["location"] == "Jangpura" and w["temp_c"] == 34


def test_explicit_location_overrides_latlon(monkeypatch):
    monkeypatch.setenv("WEATHER_API_KEY", "k")
    monkeypatch.setenv("WEATHER_LAT", "28.5836")
    monkeypatch.setenv("WEATHER_LON", "77.2410")
    seen = _capture(monkeypatch)

    weather_service.get_weather("Mumbai,IN")

    assert seen["params"]["q"] == "Mumbai,IN" and "lat" not in seen["params"]


def test_falls_back_to_city_without_latlon(monkeypatch):
    monkeypatch.setenv("WEATHER_API_KEY", "k")
    monkeypatch.delenv("WEATHER_LAT", raising=False)
    monkeypatch.delenv("WEATHER_LON", raising=False)
    monkeypatch.setenv("WEATHER_DEFAULT_LOCATION", "Delhi,IN")
    seen = _capture(monkeypatch)

    weather_service.get_weather()

    assert seen["params"]["q"] == "Delhi,IN" and "lat" not in seen["params"]


def test_missing_key_raises(monkeypatch):
    monkeypatch.delenv("WEATHER_API_KEY", raising=False)
    with pytest.raises(weather_service.WeatherUnavailable):
        weather_service.get_weather()
