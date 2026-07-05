"""Zenith — in-memory rate limiter + daily token-budget kill-switch."""

import os
import time
from collections import deque
from threading import Lock

MAX_REQUESTS_PER_MINUTE = 5
MAX_REQUESTS_PER_DAY = 150
WARNING_THRESHOLD = 120
# Hard cap — tool results balloon fast (PRD §10). Env-overridable so the owner can tune the
# ceiling without a code edit (raised to 500k on 2026-07-05 to trial heavier days).
DAILY_TOKEN_BUDGET = int(os.getenv("ZENITH_DAILY_TOKEN_BUDGET", "500000"))

# Claude Sonnet 4.6 pricing (per 1M tokens) — input/output differ ~5×, so the split matters
# even for a rough estimate. Kept here so cost lives in ONE place (see stats()).
PRICE_IN_PER_MTOK = 3.0
PRICE_OUT_PER_MTOK = 15.0
USD_TO_INR = 86.0              # approximate; the HUD labels the figure "est."


class RateLimiter:
    """5 requests/min, 150 requests/day, and a daily token kill-switch. In-memory and
    thread-safe — a single Lock guards every read/mutate, so the HUD and Telegram threads
    can't race (check-and-record is one atomic critical section)."""

    def __init__(self) -> None:
        self._minute: deque[float] = deque()
        self._day_count = 0
        self._day_tokens = 0
        self._day_input = 0
        self._day_output = 0
        self._day_key = self._today()
        self._lock = Lock()

    @staticmethod
    def _today() -> str:
        return time.strftime("%Y-%m-%d", time.localtime())

    def _roll(self) -> None:
        today = self._today()
        if today != self._day_key:
            self._day_key = today
            self._day_count = 0
            self._day_tokens = 0
            self._day_input = 0
            self._day_output = 0
            self._minute.clear()

    def check_request(self) -> tuple[bool, str | None, str | None]:
        """For a NEW request: enforce token budget, then 5/min, then 150/day.
        Records the request when allowed. Returns (allowed, denial_reason, warning)."""
        with self._lock:
            self._roll()
            now = time.monotonic()

            if self._day_tokens >= DAILY_TOKEN_BUDGET:
                return False, "Daily token budget reached — kill-switch engaged. Resets tomorrow, Boss.", None

            while self._minute and now - self._minute[0] >= 60:
                self._minute.popleft()

            if len(self._minute) >= MAX_REQUESTS_PER_MINUTE:
                retry_in = int(60 - (now - self._minute[0])) + 1
                return False, f"Rate limit: max {MAX_REQUESTS_PER_MINUTE} requests/minute. Try again in ~{retry_in}s, Boss.", None

            if self._day_count >= MAX_REQUESTS_PER_DAY:
                return False, f"Daily limit reached: max {MAX_REQUESTS_PER_DAY} requests/day. Resets tomorrow.", None

            self._minute.append(now)
            self._day_count += 1

            warning = None
            if self._day_count >= WARNING_THRESHOLD:
                warning = f"Heads up Boss — {MAX_REQUESTS_PER_DAY - self._day_count} requests left today."
            return True, None, warning

    def ensure_budget(self) -> tuple[bool, str | None]:
        """Token kill-switch check before each Claude call (incl. confirm continuations)."""
        with self._lock:
            self._roll()
            if self._day_tokens >= DAILY_TOKEN_BUDGET:
                return False, "Daily token budget reached — kill-switch engaged. Resets tomorrow, Boss."
            return True, None

    def record_usage(self, input_tokens: int, output_tokens: int) -> None:
        with self._lock:
            self._roll()
            inp = input_tokens or 0
            out = output_tokens or 0
            self._day_input += inp
            self._day_output += out
            self._day_tokens += inp + out

    def stats(self) -> dict:
        """Current usage WITHOUT consuming a request slot (for GET /usage).

        Cost is computed here so pricing lives in one place. Input/output are priced
        separately (~5× apart) and returned as both USD and an approximate INR figure
        (the HUD labels it "est."). ``killswitch`` reflects whether either hard cap is hit.
        """
        with self._lock:
            self._roll()
            now = time.monotonic()
            while self._minute and now - self._minute[0] >= 60:
                self._minute.popleft()
            cost_usd = (
                self._day_input / 1_000_000 * PRICE_IN_PER_MTOK
                + self._day_output / 1_000_000 * PRICE_OUT_PER_MTOK
            )
            killswitch = (
                self._day_tokens >= DAILY_TOKEN_BUDGET
                or self._day_count >= MAX_REQUESTS_PER_DAY
            )
            return {
                "requests_today": self._day_count,
                "daily_request_cap": MAX_REQUESTS_PER_DAY,
                "requests_last_minute": len(self._minute),
                "per_minute_cap": MAX_REQUESTS_PER_MINUTE,
                "tokens_today": self._day_tokens,
                "daily_token_budget": DAILY_TOKEN_BUDGET,
                "input_tokens_today": self._day_input,
                "output_tokens_today": self._day_output,
                "cost_usd": round(cost_usd, 4),
                "cost_inr": round(cost_usd * USD_TO_INR, 2),
                "killswitch": killswitch,
            }
