"""Zenith — weather for the morning briefing (Milestone 3).

OpenWeatherMap current-weather over plain HTTP. `WEATHER_API_KEY` + `WEATHER_DEFAULT_LOCATION`
live in `.env`. Degrades to a clear "set WEATHER_API_KEY" message rather than crashing, so a
missing key never breaks the briefing.
"""

from __future__ import annotations

import os

import requests
from dotenv import load_dotenv

load_dotenv()

_API = "https://api.openweathermap.org/data/2.5/weather"
_DEFAULT_LOCATION = "Hyderabad,IN"


class WeatherUnavailable(Exception):
    """Key missing/rejected or location not found — surfaced to the user, not a crash."""


def _round(value):
    return round(value) if value is not None else None


def _query() -> tuple[dict, str]:
    """OWM query params + a label for messages. Precedence: an explicit caller location wins (handled
    by get_weather); else hyperlocal WEATHER_LAT/WEATHER_LON (the owner's exact spot, e.g. Jangpura
    rather than the Delhi centroid); else WEATHER_DEFAULT_LOCATION; else the built-in default."""
    lat, lon = os.getenv("WEATHER_LAT"), os.getenv("WEATHER_LON")
    if lat and lon:
        return {"lat": lat, "lon": lon}, f"{lat},{lon}"
    loc = os.getenv("WEATHER_DEFAULT_LOCATION") or _DEFAULT_LOCATION
    return {"q": loc}, loc


def get_weather(location: str | None = None) -> dict:
    key = os.getenv("WEATHER_API_KEY")
    if not key:
        raise WeatherUnavailable("Weather unavailable — set WEATHER_API_KEY in backend/.env.")
    if location:
        query, loc = {"q": location}, location
    else:
        query, loc = _query()
    resp = requests.get(_API, params={**query, "appid": key, "units": "metric"}, timeout=10)
    if resp.status_code == 401:
        raise WeatherUnavailable("Weather API key rejected (401) — check WEATHER_API_KEY.")
    if resp.status_code == 404:
        raise WeatherUnavailable(f"Weather: location '{loc}' not found.")
    resp.raise_for_status()
    data = resp.json()
    main = data.get("main", {})
    weather = (data.get("weather") or [{}])[0]
    return {
        "location": data.get("name", loc),
        "condition": (weather.get("description") or "").title(),
        "temp_c": _round(main.get("temp")),
        "feels_like_c": _round(main.get("feels_like")),
        "temp_min_c": _round(main.get("temp_min")),
        "temp_max_c": _round(main.get("temp_max")),
        "humidity": main.get("humidity"),
    }
