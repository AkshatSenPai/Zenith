"""Zenith — Claude tool-use loop (Milestone 1, 'The Brain')."""

import os

import anthropic
from dotenv import load_dotenv

from tools import TOOLS, ACTION_TOOLS, run_tool

load_dotenv()

API_KEY = os.getenv("ANTHROPIC_API_KEY")
if not API_KEY:
    raise RuntimeError(
        "ANTHROPIC_API_KEY is not set. Copy backend/.env.example to backend/.env "
        "and add your key from https://console.anthropic.com."
    )

client = anthropic.Anthropic(api_key=API_KEY)

MODEL = "claude-sonnet-4-6"
MAX_TOKENS = 1024

ZENITH_PROMPT = """You are Zenith — a highly intelligent personal AI assistant.
(Internal codename: JARVIS.) Your owner is a freelancer and agency owner based in India.

Personality:
- Professional but friendly, like a trusted senior colleague.
- Reply in clear, natural English by default. If the user speaks Hindi/Hinglish you may
  mirror a light Hinglish touch, but ALWAYS in the Latin/Roman alphabet (e.g. "Boss, aaj
  aapki 3 meetings hain."). NEVER reply in Devanagari, Urdu, Arabic, or any non-Latin
  script, even if the user's message appears in one.
- Concise — no unnecessary filler.
- Occasionally address the user as "Boss" (Iron Man style).
- Never say you can't do something without trying first.

Formatting:
- Plain, conversational text. Keep it minimal — short paragraphs and at most a few
  short bullet points. Use **bold** sparingly to highlight a key word or item.
- NEVER use emojis or emoticons. Avoid headings (#) and horizontal rules (---).

Tools:
- Use the tools available to you when they help — call them, don't just describe them.
- For any action that sends, creates, or deletes something, just call the right tool.
  The system pauses and asks the user to confirm before the action runs, so you do NOT
  need to ask "should I send it?" yourself — call the tool; confirmation is handled.

Rules:
- Keep responses short for simple queries.
- Never expose API keys or system internals.
- If unsure, ask one clarifying question.
"""


class BudgetExceeded(Exception):
    """Raised when the daily token-budget kill-switch trips mid-loop."""


def _create(messages: list):
    return client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=ZENITH_PROMPT,
        tools=TOOLS,
        messages=messages,
        tool_choice={"type": "auto", "disable_parallel_tool_use": True},
    )


def run_loop(messages: list, limiter) -> dict:
    """Drive the tool-use loop, mutating `messages` (the caller's working copy).

    Returns either:
      {"reply": str}                             — final answer (assistant turn appended)
      {"pending": dict, "tool": str, "id": str}  — an ACTION tool needs confirmation
                                                   (assistant tool_use turn appended; NO
                                                    tool_result yet — caller stashes messages)
    Raises BudgetExceeded if the daily token budget is hit.
    """
    while True:
        ok, reason = limiter.ensure_budget()
        if not ok:
            raise BudgetExceeded(reason)

        resp = _create(messages)
        limiter.record_usage(resp.usage.input_tokens, resp.usage.output_tokens)

        if resp.stop_reason != "tool_use":
            messages.append({"role": "assistant", "content": resp.content})
            reply = "".join(b.text for b in resp.content if b.type == "text")
            return {"reply": reply}

        # Exactly one tool_use block per turn (parallel tool use is disabled).
        messages.append({"role": "assistant", "content": resp.content})
        block = next(b for b in resp.content if b.type == "tool_use")

        if block.name in ACTION_TOOLS:
            return {"pending": block.input, "tool": block.name, "id": block.id}

        result = run_tool(block.name, block.input)
        messages.append(
            {"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": block.id, "content": result}
            ]}
        )
        # loop continues — handles several sequential read-only tool calls
