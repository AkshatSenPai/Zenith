"""Zenith — in-memory rate limiter + daily token-budget kill-switch."""

import time
from collections import deque
from threading import Lock

MAX_REQUESTS_PER_MINUTE = 5
MAX_REQUESTS_PER_DAY = 150
WARNING_THRESHOLD = 120
DAILY_TOKEN_BUDGET = 300_000   # hard cap — tool results balloon fast (PRD §10)


class RateLimiter:
    """5 requests/min, 150 requests/day, and a daily token kill-switch. In-memory and
    thread-safe — a single Lock guards every read/mutate, so the HUD and Telegram threads
    can't race (check-and-record is one atomic critical section)."""

    def __init__(self) -> None:
        self._minute: deque[float] = deque()
        self._day_count = 0
        self._day_tokens = 0
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
            self._day_tokens += (input_tokens or 0) + (output_tokens or 0)

    def stats(self) -> dict:
        """Current usage WITHOUT consuming a request slot (for GET /usage)."""
        with self._lock:
            self._roll()
            now = time.monotonic()
            while self._minute and now - self._minute[0] >= 60:
                self._minute.popleft()
            return {
                "requests_today": self._day_count,
                "daily_request_cap": MAX_REQUESTS_PER_DAY,
                "requests_last_minute": len(self._minute),
                "per_minute_cap": MAX_REQUESTS_PER_MINUTE,
                "tokens_today": self._day_tokens,
                "daily_token_budget": DAILY_TOKEN_BUDGET,
            }
