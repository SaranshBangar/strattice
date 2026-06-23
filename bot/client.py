"""Thin CoinDCX REST client. HMAC-SHA256 signed private calls; public candles/markets.

Signing: signature = HMAC_SHA256(secret, exact_json_body); body MUST include 'timestamp' (ms).
The exact byte string that is signed is the exact byte string that is POSTed.
"""
import hashlib
import hmac
import json
import time

import requests

from . import config

API = "https://api.coindcx.com"
PUBLIC = "https://public.coindcx.com"


class CoinDCXError(Exception):
    pass


class Client:
    def __init__(self, key: str = config.API_KEY, secret: str = config.SECRET_KEY):
        self.key = key
        self.secret = secret.encode()
        self._markets: dict | None = None

    # ---------- public ----------
    def candles(self, pair: str, interval: str, limit: int = 200) -> list[dict]:
        """Newest-first list of {open,high,low,close,volume,time(ms)}. Returned oldest-first."""
        r = requests.get(
            f"{PUBLIC}/market_data/candles",
            params={"pair": pair, "interval": interval, "limit": limit},
            timeout=20,
        )
        r.raise_for_status()
        data = r.json()
        return list(reversed(data))  # oldest-first for strategy math

    def markets(self) -> dict:
        if self._markets is None:
            r = requests.get(f"{API}/exchange/v1/markets_details", timeout=20)
            r.raise_for_status()
            self._markets = {m["pair"]: m for m in r.json()}
        return self._markets

    def round_qty(self, pair: str, qty: float) -> float:
        m = self.markets().get(pair)
        if not m:
            return qty
        prec = int(m.get("target_currency_precision", 8))
        return round(qty, prec)

    def min_quantity(self, pair: str) -> float:
        m = self.markets().get(pair)
        return float(m["min_quantity"]) if m else 0.0

    # ---------- private (signed) ----------
    def _signed(self, path: str, payload: dict) -> dict:
        if not self.key or not self.secret:
            raise CoinDCXError("API credentials not configured")
        payload = {**payload, "timestamp": int(time.time() * 1000)}
        body = json.dumps(payload, separators=(",", ":"))
        sig = hmac.new(self.secret, body.encode(), hashlib.sha256).hexdigest()
        headers = {
            "Content-Type": "application/json",
            "X-AUTH-APIKEY": self.key,
            "X-AUTH-SIGNATURE": sig,
        }
        r = requests.post(f"{API}{path}", data=body, headers=headers, timeout=20)
        if r.status_code >= 400:
            raise CoinDCXError(f"{r.status_code} {path}: {r.text}")
        return r.json()

    def create_order(self, *, market: str, side: str, qty: float,
                     order_type: str = "market_order", price: float | None = None,
                     client_order_id: str | None = None) -> dict:
        payload = {
            "market": market, "side": side, "order_type": order_type,
            "total_quantity": qty,
        }
        if price is not None:
            payload["price_per_unit"] = price
        if client_order_id:
            payload["client_order_id"] = client_order_id
        return self._signed("/exchange/v1/orders/create", payload)

    def cancel_all(self, market: str | None = None) -> dict:
        return self._signed("/exchange/v1/orders/cancel_all", {"market": market} if market else {})

    def balances(self) -> dict:
        return self._signed("/exchange/v1/users/balances", {})
