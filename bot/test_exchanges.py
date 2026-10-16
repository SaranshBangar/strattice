"""Exchange-layer tests: the Binance client speaks the same interface as the CoinDCX
client, so the engine/executor/reconcile code runs unchanged on either venue. All HTTP
is stubbed - no network.

Run: python -m bot.test_exchanges
"""
import json
import tempfile
import time as _time
from pathlib import Path
from urllib.parse import urlsplit

from . import config, costs
from .binance_client import BinanceClient, BinanceError, symbol_of
from .client import Client, make_client


class _Resp:
    def __init__(self, status: int, body, headers: dict | None = None):
        self.status_code = status
        self._body = body
        self.text = json.dumps(body)
        self.headers = headers or {}

    def json(self):
        return self._body

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(self.status_code)


class _FakeHTTP:
    """Records every request; answers from a (method, path) -> response table."""

    def __init__(self, table: dict):
        self.table = table
        self.calls: list[tuple[str, str, dict | None]] = []

    def _answer(self, method: str, url: str, params=None):
        path = urlsplit(url).path
        self.calls.append((method, url, params))
        r = self.table[(method, path)]
        return r(url, params) if callable(r) else r

    def get(self, url, params=None, timeout=None):
        return self._answer("GET", url, params)

    def request(self, method, url, headers=None, timeout=None):
        assert headers and headers.get("X-MBX-APIKEY"), "signed calls carry the API key"
        return self._answer(method, url)


EXCHANGE_INFO = {"symbols": [
    {"symbol": "BTCUSDT", "status": "TRADING", "baseAsset": "BTC", "quoteAsset": "USDT",
     "filters": [{"filterType": "LOT_SIZE", "minQty": "0.00001000",
                  "stepSize": "0.00001000"},
                 {"filterType": "NOTIONAL", "minNotional": "5.00000000"}]},
    {"symbol": "OLDUSDT", "status": "BREAK", "baseAsset": "OLD", "quoteAsset": "USDT",
     "filters": []},
]}


def _client(table: dict) -> tuple[BinanceClient, _FakeHTTP]:
    c = BinanceClient(key="k" * 16, secret="s" * 16)
    http = _FakeHTTP({("GET", "/api/v3/exchangeInfo"): _Resp(200, EXCHANGE_INFO), **table})
    c._http = http
    return c, http


def test_signature_matches_binance_spec() -> None:
    """The worked example from Binance's API docs (HMAC over the exact query string).
    The key/secret are Binance's published documentation sample, not credentials."""
    secret = "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j"  # ggignore
    c = BinanceClient(key="vmPUZE6mv9SD5VNHk4HlWFsOr6aKE2zvsw0MuIgwCIPy6utIco14y7Ju91duEh8A",  # ggignore
                      secret=secret)
    seen = {}

    def answer(url, _params):
        seen["url"] = url
        return _Resp(200, {})

    c._http = _FakeHTTP({("POST", "/api/v3/order"): answer})
    real_time = _time.time
    _time.time = lambda: 1499827319.559
    import bot.binance_client as bc
    old_rw = bc.RECV_WINDOW_MS
    bc.RECV_WINDOW_MS = 5000
    try:
        c._signed("POST", "/api/v3/order", {"symbol": "LTCBTC", "side": "BUY",
                                            "type": "LIMIT", "timeInForce": "GTC",
                                            "quantity": 1, "price": 0.1})
    finally:
        _time.time = real_time
        bc.RECV_WINDOW_MS = old_rw
    assert seen["url"].endswith(
        "symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1"
        "&recvWindow=5000&timestamp=1499827319559"
        "&signature=c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71"), \
        seen["url"]


def test_markets_rounding_and_minimums() -> None:
    c, _ = _client({})
    m = c.markets()
    assert set(m) == {"B-BTC_USDT"}, "only TRADING symbols, keyed by the bot's pair id"
    btc = m["B-BTC_USDT"]
    assert btc["target_currency_precision"] == 5 and btc["target_currency_short_name"] == "BTC"
    assert c.min_quantity("B-BTC_USDT") == 0.00001 and c.min_notional("B-BTC_USDT") == 5.0
    # floors to the step: rounding up could try to sell coins the wallet doesn't have
    assert c.round_qty("B-BTC_USDT", 0.123459) == 0.12345
    assert c.round_qty("B-BTC_USDT", 0.3) == 0.3, "exact steps survive float noise"
    assert symbol_of("B-ETH_USDT") == "ETHUSDT" and symbol_of("ETHUSDT") == "ETHUSDT"


def test_market_buy_books_coins_net_of_base_commission() -> None:
    """Binance takes a BUY's fee out of the coins received (no BNB): the book must
    record the coins actually held, or a later full-position SELL would fail."""
    fill = {"orderId": 42, "clientOrderId": "abc", "side": "BUY", "status": "FILLED",
            "executedQty": "0.01000000", "cummulativeQuoteQty": "650.00000000",
            "fills": [{"price": "65000", "qty": "0.01", "commission": "0.00001000",
                       "commissionAsset": "BTC"}]}
    c, http = _client({("POST", "/api/v3/order"): _Resp(200, fill)})
    r = c.create_order(market="B-BTC_USDT", side="buy", qty=0.01, client_order_id="abc")
    o = r["orders"][0]
    assert o["id"] == 42 and o["status"] == "filled"
    assert abs(o["filled_quantity"] - 0.00999) < 1e-12, o
    assert abs(o["avg_price"] - 65000.0) < 1e-9
    url = [u for m, u, _ in http.calls if m == "POST"][0]
    assert "symbol=BTCUSDT" in url and "type=MARKET" in url and "side=BUY" in url
    assert "newClientOrderId=abc" in url and "quantity=0.01" in url


def test_order_status_and_errors() -> None:
    missing = _Resp(400, {"code": -2013, "msg": "Order does not exist."})
    c, _ = _client({("GET", "/api/v3/order"): missing})
    assert c.order_status(client_order_id="x", market="B-BTC_USDT") is None
    bad_key = _Resp(400, {"code": -2015, "msg": "Invalid API-key, IP, or permissions."})
    c, _ = _client({("GET", "/api/v3/account"): bad_key})
    try:
        c.balances()
        raise AssertionError("auth failure must raise")
    except BinanceError as e:
        # the supervisor turns 401/403 into "update your API keys"
        assert str(e).startswith("401"), str(e)
        assert "s" * 16 not in str(e), "secret never leaks into errors"


def test_balances_and_cancel_all() -> None:
    acct = {"balances": [{"asset": "USDT", "free": "120.5", "locked": "0"},
                         {"asset": "BTC", "free": "0.002", "locked": "0.001"}]}
    deleted = []
    c, _ = _client({
        ("GET", "/api/v3/account"): _Resp(200, acct),
        ("GET", "/api/v3/openOrders"): _Resp(200, [{"symbol": "BTCUSDT"},
                                                   {"symbol": "BTCUSDT"},
                                                   {"symbol": "ETHUSDT"}]),
        ("DELETE", "/api/v3/openOrders"):
            lambda url, _p: deleted.append(url.split("symbol=")[1].split("&")[0])
            or _Resp(200, []),
    })
    assert c.free_balance("USDT") == 120.5
    btc = [b for b in c.balances() if b["currency"] == "BTC"][0]
    assert btc["balance"] == 0.002 and btc["locked_balance"] == 0.001
    c.cancel_all()  # kill switch: every symbol with open orders, once each
    assert deleted == ["BTCUSDT", "ETHUSDT"], deleted


def test_candles_paging_forward() -> None:
    day = 86_400_000

    def klines(_url, params):
        start = params.get("startTime", 0)
        n = 1000 if start < 1000 * day else 5  # one full page, then a short one
        return _Resp(200, [[start + i * day, "1", "2", "0.5", "1.5", "10"]
                           for i in range(n)])

    c, _ = _client({("GET", "/api/v3/klines"): klines})
    bars = c.candles("B-BTC_USDT", "1d", since_ms=0)
    assert len(bars) == 1005 and bars[0]["time"] == 0 and bars[-1]["time"] == 1004 * day
    assert bars[1]["close"] == 1.5 and bars[1]["volume"] == 10.0


def test_executor_books_a_normalized_binance_fill() -> None:
    """End to end through the real executor: the Binance-normalized create response
    lands in the position book with the net coins and the real average price."""
    from . import audit, sizing
    from .test_fallbacks import _fresh_world

    with tempfile.TemporaryDirectory() as d:
        eng, fake = _fresh_world(Path(d))
        fake.create_response = BinanceClient._normalize_order(
            {"orderId": 7, "side": "BUY", "status": "FILLED", "executedQty": "2.0",
             "cummulativeQuoteQty": "402.0",
             "fills": [{"commission": "0.002", "commissionAsset": "ETH"}]}, base="ETH")
        old = (sizing.equity, sizing.free_balance, config.LIVE)
        sizing.equity = lambda *a, **k: 100000.0
        sizing.free_balance = lambda *a, **k: 100000.0
        config.LIVE = True
        try:
            res = eng.executor.place(strategy="tsmom_test", market="I-ETH_INR",
                                     side="buy", qty=2.0, price=200.0, candle_ts=9000)
            assert res["status"] == "placed"
            qty, avg = audit.get_position("tsmom_test", "I-ETH_INR")
            assert abs(qty - 1.998) < 1e-9 and abs(avg - 201.0) < 1e-9, (qty, avg)
        finally:
            sizing.equity, sizing.free_balance, config.LIVE = old


def test_factory_and_venue_costs() -> None:
    assert isinstance(make_client("coindcx"), Client)
    assert isinstance(make_client("binance", key="a", secret="b"), BinanceClient)
    try:
        make_client("kraken")
        raise AssertionError("unknown exchanges must be refused")
    except ValueError:
        pass
    assert config.exchange({"exchange": "Binance"}) == "binance"
    assert config.exchange({}) == "coindcx"
    b = costs.EXCHANGE_DEFAULTS["binance"]
    assert b["fee_rate"] == 0.001 and b["tds_rate"] == 0.0 and b["gst_on_fee"] == 0.18


def test_repo_inr_config_runs_on_binance() -> None:
    """The repo's INR config with exchange: binance trades the USDT twins at Binance
    friction; an already-USDT config (what the worker writes) is left alone."""
    import yaml
    inr = {"exchange": "binance", "quote_currency": "INR",
           "costs": {"fee_rate": 0.002, "tds_rate": 0.01, "slippage_bps": 7.0},
           "portfolio": {"btc_regime_filter": {"enabled": True, "market": "I-BTC_INR"}},
           "strategies": [{"name": "a", "market": "I-SOL_INR"},
                          {"name": "b", "market": "B-ETH_USDT"}]}
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "c.yaml"
        p.write_text(yaml.safe_dump(inr))
        cfg = config.load(str(p))
        assert [s["market"] for s in cfg["strategies"]] == ["B-SOL_USDT", "B-ETH_USDT"]
        assert cfg["portfolio"]["btc_regime_filter"]["market"] == "B-BTC_USDT"
        assert cfg["quote_currency"] == "USDT"
        assert cfg["costs"] == {"slippage_bps": 7.0}  # fee/TDS fall back to Binance's
        p.write_text(yaml.safe_dump({**inr, "exchange": "coindcx"}))
        assert config.load(str(p)) == {**inr, "exchange": "coindcx"}
        usdt = {**inr, "quote_currency": "USDT"}
        p.write_text(yaml.safe_dump(usdt))
        assert config.load(str(p)) == usdt


def main() -> None:
    tests = [v for k, v in globals().items() if k.startswith("test_") and callable(v)]
    for t in tests:
        t()
        print(f"  ok  {t.__name__}")
    print(f"exchange tests OK ({len(tests)})")


if __name__ == "__main__":
    main()
