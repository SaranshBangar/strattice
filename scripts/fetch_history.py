"""Fetch deep OHLCV history for backtesting and write compressed CSVs.

Designed to run in CI (GitHub Actions) where outbound internet is unrestricted.
Primary source: CoinDCX public candles (the venue the bot actually trades) using
endTime paging. If the API ignores endTime (no deep paging), falls back to the
Binance public archive (data.binance.vision) for the USDT twins so strategy
research still has multi-year history to chew on.

Output: <out>/{PAIR}_{INTERVAL}.csv.gz with header time,open,high,low,close,volume
(time = bar open, ms, oldest-first). Also writes markets_details.json.gz.

Usage: python scripts/fetch_history.py --out research/data
"""
import argparse
import csv
import gzip
import io
import json
import time as _time
import zipfile
from datetime import datetime, timedelta, timezone

import requests

PUBLIC = "https://public.coindcx.com/market_data/candles"
MARKETS = "https://api.coindcx.com/exchange/v1/markets_details"
BINANCE_ARCHIVE = "https://data.binance.vision/data/spot/monthly/klines"

# INR pairs are what the bot trades; USDT twins give liquidity + deep-history cross-checks.
PAIRS = [
    "I-BTC_INR", "I-ETH_INR", "I-XRP_INR", "I-SOL_INR", "I-DOGE_INR",
    "I-BNB_INR", "I-ADA_INR",
    "B-BTC_USDT", "B-ETH_USDT", "B-XRP_USDT", "B-SOL_USDT", "B-DOGE_USDT",
    "B-BNB_USDT", "B-ADA_USDT",
]
# interval -> days of history wanted
DEPTH_DAYS = {"1h": 1095, "15m": 400, "1d": 1460}

S = requests.Session()
S.headers["User-Agent"] = "strattice-research/1.0"


def _get(url: str, **params) -> requests.Response:
    for attempt in range(5):
        try:
            r = S.get(url, params=params or None, timeout=30)
            if r.status_code == 429:
                _time.sleep(2 ** attempt)
                continue
            return r
        except requests.RequestException:
            _time.sleep(2 ** attempt)
    raise RuntimeError(f"gave up on {url}")


def fetch_coindcx(pair: str, interval: str, since_ms: int) -> list[dict]:
    """Page backwards with endTime until since_ms or history runs out."""
    out: dict[int, dict] = {}
    cursor = None  # None = newest page
    while True:
        params = {"pair": pair, "interval": interval, "limit": 1000}
        if cursor is not None:
            params["endTime"] = cursor
        r = _get(PUBLIC, **params)
        if r.status_code != 200:
            print(f"  {pair} {interval}: HTTP {r.status_code}, stopping")
            break
        try:
            batch = r.json()
        except ValueError:
            print(f"  {pair} {interval}: non-JSON body, stopping")
            break
        if not isinstance(batch, list) or not batch:
            break
        times = [int(c["time"]) for c in batch]
        oldest = min(times)
        newest = max(times)
        # endTime ignored? (page newer than requested cursor) -> no deep paging
        if cursor is not None and oldest >= cursor:
            print(f"  {pair} {interval}: endTime not honored (oldest {oldest} >= cursor {cursor})")
            for c in batch:
                out[int(c["time"])] = c
            break
        for c in batch:
            out[int(c["time"])] = c
        if oldest <= since_ms or len(batch) < 2:
            break
        cursor = oldest - 1
        _time.sleep(0.25)
        if len(out) > 250_000:  # sanity ceiling
            break
    rows = [out[t] for t in sorted(out)]
    print(f"  {pair} {interval}: {len(rows)} bars "
          f"({_dt(rows[0]['time'])} .. {_dt(rows[-1]['time'])})" if rows else
          f"  {pair} {interval}: EMPTY")
    return rows


def _dt(ms) -> str:
    return datetime.fromtimestamp(int(ms) / 1000, tz=timezone.utc).strftime("%Y-%m-%d")


def _norm_ts(t: float) -> int:
    """Normalize seconds/ms/us timestamps to ms."""
    t = float(t)
    if t > 1e14:
        return int(t // 1000)
    if t > 1e11:
        return int(t)
    return int(t * 1000)


def fetch_binance_archive(symbol: str, interval: str, since_ms: int) -> list[dict]:
    """Monthly kline ZIPs from data.binance.vision (public S3 mirror, no geo wall)."""
    out: list[dict] = []
    cur = datetime.fromtimestamp(since_ms / 1000, tz=timezone.utc).replace(day=1)
    now = datetime.now(tz=timezone.utc)
    while cur <= now:
        ym = cur.strftime("%Y-%m")
        url = f"{BINANCE_ARCHIVE}/{symbol}/{interval}/{symbol}-{interval}-{ym}.zip"
        r = _get(url)
        if r.status_code == 200:
            with zipfile.ZipFile(io.BytesIO(r.content)) as z:
                with z.open(z.namelist()[0]) as f:
                    for line in io.TextIOWrapper(f, encoding="utf-8"):
                        p = line.strip().split(",")
                        if len(p) < 6 or not p[0][0].isdigit():
                            continue
                        out.append({
                            "time": _norm_ts(p[0]), "open": float(p[1]), "high": float(p[2]),
                            "low": float(p[3]), "close": float(p[4]), "volume": float(p[5]),
                        })
        cur = (cur + timedelta(days=32)).replace(day=1)
        _time.sleep(0.1)
    out.sort(key=lambda c: c["time"])
    print(f"  binance {symbol} {interval}: {len(out)} bars")
    return out


def write_csv_gz(path: str, rows: list[dict]) -> None:
    with gzip.open(path, "wt", newline="") as f:
        w = csv.writer(f)
        w.writerow(["time", "open", "high", "low", "close", "volume"])
        for c in rows:
            w.writerow([int(c["time"]), c["open"], c["high"], c["low"], c["close"], c["volume"]])


BINANCE_KLINES = "https://data-api.binance.vision/api/v3/klines"
# v9 deep-history universe: every coin the platform offers that has a long Binance
# USDT listing. Daily bars from listing day cover the 2018 and 2022 bear markets,
# which the 2.8-year CoinDCX window (2023-09 onward, mostly bull) never saw.
DEEP_SYMBOLS = ["BTC", "ETH", "XRP", "SOL", "DOGE", "BNB", "ADA",
                "AVAX", "LINK", "DOT", "LTC", "TRX"]
DEEP_INR = ["I-BTC_INR", "I-ETH_INR", "I-XRP_INR", "I-SOL_INR", "I-DOGE_INR",
            "I-BNB_INR", "I-ADA_INR"]


def fetch_binance_daily(symbol: str) -> list[dict]:
    """Every daily kline since listing, paged forward with startTime (1000 per call)."""
    out: dict[int, dict] = {}
    start = 0
    while True:
        r = _get(BINANCE_KLINES, symbol=symbol, interval="1d", startTime=start, limit=1000)
        if r.status_code != 200:
            print(f"  {symbol}: HTTP {r.status_code}, stopping")
            break
        batch = r.json()
        if not batch:
            break
        for k in batch:
            out[int(k[0])] = {"time": int(k[0]), "open": float(k[1]), "high": float(k[2]),
                              "low": float(k[3]), "close": float(k[4]),
                              "volume": float(k[5])}
        if len(batch) < 1000:
            break
        start = int(batch[-1][0]) + 1
        _time.sleep(0.2)
    rows = [out[t] for t in sorted(out)]
    # drop the in-progress bar: research only ever scores closed days
    if rows and rows[-1]["time"] + 86_400_000 > _time.time() * 1000:
        rows = rows[:-1]
    if rows:
        print(f"  binance {symbol} 1d: {len(rows)} bars "
              f"({_dt(rows[0]['time'])} .. {_dt(rows[-1]['time'])})")
    return rows


def fetch_deep(out_dir: str) -> None:
    """research/data/deep/: Binance USDT dailies since listing + the full CoinDCX INR
    daily history. Used by research/v9_study.py (multi-cycle, two-venue study)."""
    import os
    os.makedirs(out_dir, exist_ok=True)
    for base in DEEP_SYMBOLS:
        rows = fetch_binance_daily(f"{base}USDT")
        if rows:
            write_csv_gz(f"{out_dir}/BN-{base}_USDT_1d.csv.gz", rows)
    # CoinDCX ignores endTime unless startTime bounds the window - the bot's client
    # already pages it correctly, so reuse that instead of fetch_coindcx's endTime walk.
    import sys
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from bot.client import Client
    since = int(datetime(2017, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)
    for pair in DEEP_INR:
        rows = Client().candles(pair, "1d", since_ms=since)
        print(f"  coindcx {pair} 1d: {len(rows)} bars"
              + (f" ({_dt(rows[0]['time'])} .. {_dt(rows[-1]['time'])})" if rows else ""))
        # The INR feed carries stray duplicate bars stamped 23:59:59 (and a few other
        # odd offsets) next to the real midnight-UTC bar - keep the day-aligned ones.
        rows = [r for r in rows if int(r["time"]) % 86_400_000 == 0]
        if rows and rows[-1]["time"] + 86_400_000 > _time.time() * 1000:
            rows = rows[:-1]
        rows = _trim_corrupt_prefix(rows, f"{out_dir}/BN-{pair[2:].replace('_INR', '')}"
                                    "_USDT_1d.csv.gz")
        if rows:
            print(f"    kept {len(rows)} clean bars from {_dt(rows[0]['time'])}")
            write_csv_gz(f"{out_dir}/{pair}_1d.csv.gz", rows)


def _trim_corrupt_prefix(rows: list[dict], twin_path: str, tol: float = 0.15) -> list[dict]:
    """CoinDCX's INR candles before ~2021 are corrupt for several pairs (closes of 0.22
    on ETH/INR, other coins' prices mixed in). Cross-check every bar's daily return
    against the Binance USDT twin on the same UTC day (returns are quote-free, so INR
    vs USDT levels cancel) and drop everything up to the LAST bar that diverges by
    more than `tol` - the kept series is clean end to end."""
    import os
    if not rows or not os.path.exists(twin_path):
        return rows
    with gzip.open(twin_path, "rt", newline="") as f:
        twin = {int(r["time"]): float(r["close"]) for r in csv.DictReader(f)}
    last_bad = -1
    for i in range(1, len(rows)):
        a, b = rows[i - 1], rows[i]
        if a["close"] <= 0 or b["close"] <= 0:
            last_bad = i
            continue
        r = b["close"] / a["close"] - 1
        u0, u1 = twin.get(int(a["time"])), twin.get(int(b["time"]))
        ref = (u1 / u0 - 1) if u0 and u1 else 0.0
        if abs(r - ref) > (tol if u0 and u1 else 0.4):
            last_bad = i
    return rows[last_bad + 1:]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="research/data")
    ap.add_argument("--deep", action="store_true",
                    help="fetch the v9 deep daily universe into <out>/deep and exit")
    a = ap.parse_args()
    import os
    os.makedirs(a.out, exist_ok=True)
    if a.deep:
        fetch_deep(os.path.join(a.out, "deep"))
        return

    # markets snapshot (min_notional, precision, listed pairs)
    r = _get(MARKETS)
    if r.status_code == 200:
        keep = [m for m in r.json() if m.get("pair") in PAIRS]
        with gzip.open(f"{a.out}/markets_details.json.gz", "wt") as f:
            json.dump(keep, f)
        print(f"markets_details: kept {len(keep)}/{len(PAIRS)} configured pairs:",
              sorted(m["pair"] for m in keep))

    now_ms = int(_time.time() * 1000)
    for pair in PAIRS:
        for interval, days in DEPTH_DAYS.items():
            since = now_ms - days * 86_400_000
            rows = fetch_coindcx(pair, interval, since)
            need_fallback = (
                pair.startswith("B-") and interval in ("1h", "15m")
                and (not rows or (now_ms - int(rows[0]["time"])) < 0.5 * days * 86_400_000)
            )
            if need_fallback:
                sym = pair[2:].replace("_", "")  # B-BTC_USDT -> BTCUSDT
                rows = fetch_binance_archive(sym, interval, since) or rows
            if rows:
                write_csv_gz(f"{a.out}/{pair}_{interval}.csv.gz", rows)


if __name__ == "__main__":
    main()
