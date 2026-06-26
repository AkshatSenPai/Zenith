"""M5 Part 2 — usage/cost accounting: record_usage splits input vs output, stats() computes
a Sonnet-4.6-priced cost (USD + est. INR), and the kill-switch flips at either hard cap."""

from rate_limiter import (
    DAILY_TOKEN_BUDGET,
    MAX_REQUESTS_PER_DAY,
    PRICE_IN_PER_MTOK,
    PRICE_OUT_PER_MTOK,
    USD_TO_INR,
    RateLimiter,
)


def test_record_usage_splits_input_and_output():
    rl = RateLimiter()
    rl.record_usage(1000, 200)
    rl.record_usage(500, 50)
    s = rl.stats()
    assert s["input_tokens_today"] == 1500
    assert s["output_tokens_today"] == 250
    assert s["tokens_today"] == 1750            # total still the sum


def test_stats_costs_price_input_and_output_separately():
    rl = RateLimiter()
    rl.record_usage(1_000_000, 1_000_000)       # 1M each
    s = rl.stats()
    expected_usd = PRICE_IN_PER_MTOK + PRICE_OUT_PER_MTOK   # $3 + $15
    assert s["cost_usd"] == round(expected_usd, 4)
    assert s["cost_inr"] == round(expected_usd * USD_TO_INR, 2)
    # output is 5× input — the split must matter, not just the total
    assert PRICE_OUT_PER_MTOK == 5 * PRICE_IN_PER_MTOK


def test_zero_usage_is_free():
    s = RateLimiter().stats()
    assert s["cost_usd"] == 0
    assert s["cost_inr"] == 0
    assert s["killswitch"] is False


def test_killswitch_trips_on_token_budget():
    rl = RateLimiter()
    rl.record_usage(DAILY_TOKEN_BUDGET, 0)      # at the token cap
    assert rl.stats()["killswitch"] is True


def test_killswitch_trips_on_daily_request_cap():
    rl = RateLimiter()
    rl._day_count = MAX_REQUESTS_PER_DAY        # at the request cap, no tokens spent
    assert rl.stats()["killswitch"] is True


def test_killswitch_clear_below_caps():
    rl = RateLimiter()
    rl.record_usage(DAILY_TOKEN_BUDGET - 1, 0)
    rl._day_count = MAX_REQUESTS_PER_DAY - 1
    assert rl.stats()["killswitch"] is False
