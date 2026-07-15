"""Zenith — web search via Tavily (an LLM-agent search API). Read-only; results are third-party web
content, fenced as <external-content> by run_tool. Mirrors news_service: module-level requests + a
custom exception. Graceful when TAVILY_API_KEY is unset."""

from __future__ import annotations

import os

import requests

API_URL = "https://api.tavily.com/search"
_TIMEOUT = 12
_MAX_RESULTS = 5


class SearchUnavailable(Exception):
    """Web search is not configured or the provider failed."""


def _api_key() -> str:
    return (os.getenv("TAVILY_API_KEY") or "").strip()


def search(query: str) -> str:
    key = _api_key()
    if not key:
        raise SearchUnavailable("Web search isn't configured — add TAVILY_API_KEY to backend/.env.")
    try:
        # Current Tavily API wants the key in an Authorization: Bearer header; older
        # integrations passed it as "api_key" in the body. Send both so it works either way.
        resp = requests.post(API_URL, timeout=_TIMEOUT,
            headers={"Authorization": f"Bearer {key}"},
            json={
                "api_key": key, "query": query, "max_results": _MAX_RESULTS,
                "include_answer": True, "search_depth": "basic",
            })
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException as exc:
        raise SearchUnavailable(f"Web search failed: {exc}") from exc
    return _format(query, data)


def _format(query: str, data: dict) -> str:
    answer = (data.get("answer") or "").strip()
    results = data.get("results") or []
    if not answer and not results:
        return f"No web results for '{query}'."
    lines = [f"Web results for '{query}':"]
    if answer:
        lines.append(f"\nSummary: {answer}")
    for r in results[:_MAX_RESULTS]:
        title = (r.get("title") or "").strip() or "(untitled)"
        url = (r.get("url") or "").strip()
        snippet = " ".join((r.get("content") or "").split())[:300]
        lines.append(f"\n- {title}\n  {url}\n  {snippet}")
    return "\n".join(lines)
