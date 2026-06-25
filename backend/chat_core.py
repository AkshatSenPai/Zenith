"""Zenith — channel-agnostic chat core.

The HUD (POST /chat) and the Telegram remote BOTH call process_chat / process_confirm, so the loop
(Claude + last-20 history + rate limit + tools + confirm gate) is shared, never forked. Each channel
keeps its own history via memory_service; the rate limiter + token budget are shared across channels.
"""

import anthropic

import activity_log
import memory_service
from claude_service import run_loop, BudgetExceeded
from rate_limiter import RateLimiter
from tools import run_tool

limiter = RateLimiter()
# pending action id -> {"working": <history>, "channel": <str>} awaiting confirm (shared across channels)
PENDING: dict[str, dict] = {}


class RateLimited(Exception):
    """Per-request rate limit or daily token budget hit (→ HTTP 429 / a Telegram notice)."""


class ClaudeUnavailable(Exception):
    """The Claude API errored (→ HTTP 502 / a Telegram notice)."""


def _finish(working: list, outcome: dict, channel: str, warning: str | None = None) -> dict:
    """Commit history on a final reply, or stash the working history + channel and surface pending."""
    if "reply" in outcome:
        memory_service.commit(channel, working)
        return {"reply": outcome["reply"], "warning": warning}
    PENDING[outcome["id"]] = {"working": working, "channel": channel}
    return {"pending": outcome["pending"], "tool": outcome["tool"], "id": outcome["id"], "warning": warning}


def process_chat(message: str, channel: str = "hud") -> dict:
    """Run one user message through the loop for a channel. Returns {reply,warning} OR
    {pending,tool,id,warning}. Raises ValueError (empty) / RateLimited / ClaudeUnavailable."""
    message = message.strip()
    if not message:
        raise ValueError("Message is empty.")
    allowed, reason, warning = limiter.check_request()
    if not allowed:
        raise RateLimited(reason)
    working = memory_service.snapshot(channel) + [{"role": "user", "content": message}]
    try:
        outcome = run_loop(working, limiter)
    except BudgetExceeded as exc:
        raise RateLimited(str(exc)) from exc
    except anthropic.APIError as exc:
        raise ClaudeUnavailable(f"Claude API error: {exc}") from exc
    return _finish(working, outcome, channel, warning)


def process_confirm(action_id: str, approved: bool) -> dict:
    """Resolve a pending action (approve→run / cancel) and resume the loop, committing to the
    channel the action came from. Raises KeyError (no such pending) / ValueError (malformed) /
    RateLimited / ClaudeUnavailable."""
    entry = PENDING.pop(action_id, None)
    if entry is None:
        raise KeyError("No pending action with that id.")
    working, channel = entry["working"], entry["channel"]
    block = next((b for b in working[-1]["content"] if getattr(b, "type", None) == "tool_use"), None)
    if block is None:
        raise ValueError("Pending action is malformed.")
    ok, reason = limiter.ensure_budget()
    if not ok:
        raise RateLimited(reason)
    if approved:
        result = run_tool(block.name, block.input)
    else:
        result = "The user cancelled this action. Do not retry it; acknowledge briefly."
        activity_log.record(block.name, "by user", ok=False)
    working.append({"role": "user", "content": [
        {"type": "tool_result", "tool_use_id": block.id, "content": result}
    ]})
    try:
        outcome = run_loop(working, limiter)
    except BudgetExceeded as exc:
        raise RateLimited(str(exc)) from exc
    except anthropic.APIError as exc:
        raise ClaudeUnavailable(f"Claude API error: {exc}") from exc
    return _finish(working, outcome, channel)
