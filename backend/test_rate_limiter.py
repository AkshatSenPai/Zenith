"""M5 — rate limiter / kill-switch: the caps, the token budget, the warning, and thread-safety
(HUD + Telegram share one limiter instance)."""

import threading

from rate_limiter import (
    DAILY_TOKEN_BUDGET,
    MAX_REQUESTS_PER_DAY,
    MAX_REQUESTS_PER_MINUTE,
    WARNING_THRESHOLD,
    RateLimiter,
)


def test_per_minute_cap_blocks_the_sixth():
    rl = RateLimiter()
    for _ in range(MAX_REQUESTS_PER_MINUTE):
        allowed, reason, _ = rl.check_request()
        assert allowed, reason
    allowed, reason, _ = rl.check_request()
    assert not allowed and "minute" in reason.lower()


def test_daily_cap_blocks():
    rl = RateLimiter()
    rl._day_count = MAX_REQUESTS_PER_DAY          # at the daily cap, minute window empty
    allowed, reason, _ = rl.check_request()
    assert not allowed and "daily" in reason.lower()


def test_token_budget_killswitch():
    rl = RateLimiter()
    rl._day_tokens = DAILY_TOKEN_BUDGET
    allowed, reason, _ = rl.check_request()
    assert not allowed and "budget" in reason.lower()
    ok, reason2 = rl.ensure_budget()              # also blocks confirm continuations
    assert not ok and "budget" in reason2.lower()


def test_warning_near_daily_cap():
    rl = RateLimiter()
    rl._day_count = WARNING_THRESHOLD - 1         # next allowed request crosses the warn line
    allowed, _, warning = rl.check_request()
    assert allowed and warning is not None


def test_concurrent_requests_never_exceed_minute_cap():
    rl = RateLimiter()
    results: list[bool] = []
    guard = threading.Lock()

    def worker() -> None:
        allowed, _, _ = rl.check_request()
        with guard:
            results.append(allowed)

    threads = [threading.Thread(target=worker) for _ in range(50)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sum(results) == MAX_REQUESTS_PER_MINUTE   # the lock prevents over-admission


def test_concurrent_token_accounting_has_no_lost_updates():
    rl = RateLimiter()

    def worker() -> None:
        for _ in range(100):
            rl.record_usage(1, 1)

    threads = [threading.Thread(target=worker) for _ in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert rl._day_tokens == 20 * 100 * 2            # 4000; no increments lost to races
