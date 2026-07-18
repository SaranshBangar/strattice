"""Candle-integrity validation: the gate between the exchange's candle feed and decide().

The engine must never trade on garbage bars. This module normalizes the benign feed
quirks (exact-duplicate timestamps, out-of-order pages) and REJECTS the dangerous ones -
malformed OHLC, gapped history, and a stale feed - so the caller can HOLD + alert instead
of running indicator math over corrupted data.

Verdict model:
  normalize(bars)       -> (clean_bars, notes)  dedupe + sort; notes say what was fixed
  validate(bars, ...)   -> Report(ok, problems, bars)
    ok=False on: empty feed, malformed bar fields, non-positive prices, inverted OHLC,
    a gap larger than `max_gap_bars` missing bars, or a last bar older than
    `max_stale_bars` intervals from `now`. Duplicates/out-of-order alone are normalized
    and reported as notes, not failures (pagination artifacts, deterministic fix).

Backtest parity note: the backtester replays CI-fetched snapshots that already pass these
checks; live-only rejection of bad feeds cannot diverge from the backtest because a
rejected cycle places no orders at all (identical to the bar never having closed).
"""
from __future__ import annotations

from dataclasses import dataclass, field

_REQUIRED = ("time", "open", "high", "low", "close", "volume")


@dataclass
class Report:
    ok: bool
    problems: list[str] = field(default_factory=list)   # fatal: do NOT trade this cycle
    notes: list[str] = field(default_factory=list)      # normalized quirks: safe to proceed
    bars: list[dict] = field(default_factory=list)      # cleaned, oldest-first

    def summary(self) -> str:
        return "; ".join(self.problems + self.notes) or "ok"


def _bar_ok(b: dict) -> str | None:
    """None if the bar is well-formed, else a short reason."""
    if not isinstance(b, dict):
        return "not a dict"
    for k in _REQUIRED:
        if k not in b:
            return f"missing field {k}"
        try:
            float(b[k])
        except (TypeError, ValueError):
            return f"non-numeric {k}={b[k]!r}"
    o, h, low, c = float(b["open"]), float(b["high"]), float(b["low"]), float(b["close"])
    if min(o, h, low, c) <= 0:
        return "non-positive price"
    if float(b["volume"]) < 0:
        return "negative volume"
    if h < low or h < max(o, c) - 1e-12 or low > min(o, c) + 1e-12:
        return f"inverted OHLC (o={o} h={h} l={low} c={c})"
    return None


def normalize(bars: list[dict]) -> tuple[list[dict], list[str]]:
    """Sort oldest-first and drop exact-duplicate timestamps (keeping the LAST occurrence,
    matching how the client's pagination dedupe behaves). Returns (clean, notes)."""
    notes: list[str] = []
    times = [int(b["time"]) for b in bars]
    unordered = any(times[i] > times[i + 1] for i in range(len(times) - 1))
    seen: dict[int, dict] = {}
    dups = 0
    for b in bars:
        t = int(b["time"])
        if t in seen:
            dups += 1
        seen[t] = b
    clean = [seen[t] for t in sorted(seen)]
    if dups:
        notes.append(f"{dups} duplicate bar(s) dropped")
    if unordered:
        notes.append("bars re-sorted (out-of-order feed)")
    return clean, notes


def validate(bars: list[dict], interval_ms: int, now_ms: int | None = None, *,
             max_gap_bars: int = 1, max_stale_bars: float = 3.0) -> Report:
    """Full integrity check for a candle series about to feed decide().

    interval_ms: expected bar spacing. max_gap_bars: how many MISSING bars between two
    consecutive bars are tolerated (thin markets can skip a truly empty bar; more than
    that means the feed lost history and every lookback indicator is silently wrong).
    max_stale_bars: how many intervals the newest bar may lag `now` before the feed is
    declared stale (bar timestamps are open-times: the in-progress bar's open is at most
    1 interval old, so 3 intervals of slack only fires when the feed has genuinely
    stopped updating)."""
    if not bars:
        return Report(False, problems=["empty candle feed"])

    # per-bar structural checks BEFORE touching b["time"] anywhere
    for i, b in enumerate(bars):
        reason = _bar_ok(b)
        if reason:
            return Report(False, problems=[f"bar[{i}]: {reason}"])

    clean, notes = normalize(bars)
    problems: list[str] = []

    # spacing / gaps on the normalized series
    for i in range(1, len(clean)):
        dt = int(clean[i]["time"]) - int(clean[i - 1]["time"])
        if dt <= 0:  # normalize() guarantees strictly increasing; belt and braces
            problems.append(f"non-increasing timestamps at index {i}")
            break
        ratio = dt / interval_ms
        if abs(ratio - round(ratio)) > 0.01:
            problems.append(f"misaligned bar spacing ({dt}ms) at index {i}")
            break
        missing = round(ratio) - 1
        if missing > max_gap_bars:
            problems.append(
                f"gap of {missing} missing bar(s) before ts {int(clean[i]['time'])}")
            break

    # staleness of the newest bar vs the wall clock
    if now_ms is not None:
        age = now_ms - int(clean[-1]["time"])
        if age > max_stale_bars * interval_ms:
            problems.append(
                f"stale feed: newest bar is {age / interval_ms:.1f} intervals old")

    return Report(not problems, problems=problems, notes=notes, bars=clean)
