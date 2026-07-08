"""Hugging Face forecast strategy (EXPERIMENTAL, ENTRY-ONLY).

Uses a pretrained time-series foundation model — amazon/chronos-2 by default
(https://hf.co/amazon/chronos-2, Apache-2.0, the top zero-shot forecaster on
fev-bench / GIFT-Eval as of 2026; set params.model to amazon/chronos-bolt-tiny
for a ~14x smaller/faster CPU model) — to forecast the next few closes, and
buys only when:
  - the market is in an uptrend (shared regime gate),
  - the forecast MEDIAN return over the horizon clears `min_forecast_pct`,
  - the forecast LOWER band (q10) is not below the entry (downside guard), and
  - the expected move clears modeled friction.

RISK WARNING — read before enabling:
  Pretrained forecasters are trained on generic time series, not crypto
  microstructure. Crypto price is close to a random walk at these horizons;
  there is NO guarantee of edge, and backtest windows here are far too short
  to prove one. Treat this as an experimental signal to paper-trade first,
  never as a primary allocation. It can and will be confidently wrong in
  regime breaks (news, crashes) — the engine's stops are the only safety net.

Dependencies are optional: `pip install "chronos-forecasting>=2.0" torch`
(2.x loads both Chronos-2 and Chronos-Bolt; 1.x only Bolt). If they are
missing the strategy logs once and permanently HOLDs — it never crashes the
engine. If the configured model fails to load (bad id, no network), it falls
back to amazon/chronos-bolt-tiny before giving up. Both model families have
direct quantile heads, so decisions are deterministic for a given candle
window (no sampling).

Exits are owned by the engine's protective layer, so this never emits SELL.
"""
from __future__ import annotations

import logging

from .base import Strategy

log = logging.getLogger(__name__)

_PIPELINES: dict[str, object] = {}  # model_id -> loaded pipeline, shared across instances

_FALLBACK_MODEL = "amazon/chronos-bolt-tiny"  # small CPU model, loadable by chronos 1.x and 2.x


def _load_pipeline(model_id: str):
    """Load a Chronos pipeline once per model id (BaseChronosPipeline dispatches to the
    right class — Chronos2Pipeline / ChronosBoltPipeline — from the model config). If the
    configured model can't load, fall back to the tiny Bolt model before disabling."""
    if model_id in _PIPELINES:
        return _PIPELINES[model_id]
    pipe = None
    try:
        import torch  # noqa: F401
        from chronos import BaseChronosPipeline

        try:
            pipe = BaseChronosPipeline.from_pretrained(model_id, device_map="cpu")
        except Exception as e:  # download failure, bad id, chronos 1.x asked for chronos-2
            log.warning("hf_forecast: %s failed to load (%s)", model_id, e)
            if model_id != _FALLBACK_MODEL:
                log.warning("hf_forecast: falling back to %s", _FALLBACK_MODEL)
                pipe = BaseChronosPipeline.from_pretrained(_FALLBACK_MODEL, device_map="cpu")
    except Exception as e:  # ImportError (deps missing) or fallback failed too
        log.warning("hf_forecast disabled (%s): %s", model_id, e)
        pipe = None
    _PIPELINES[model_id] = pipe
    return pipe


class HFForecast(Strategy):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.model_id = str(self.params.get("model", "amazon/chronos-2"))
        self.context = int(self.params.get("context", 512))  # closes fed to the model
        self.horizon = int(self.params.get("horizon", 8))  # bars ahead to forecast
        self.min_forecast_pct = float(self.params.get("min_forecast_pct", 1.0))
        self.expected_move = float(self.params.get("expected_move_pct", 0.02))
        self.min_candles = max(self.regime_period + 1, 64)
        # memo: model inference is ~100ms on CPU; only re-run when a new bar closes
        self._memo: tuple[float, str] | None = None

    def _forecast(self, closes: list[float]) -> tuple[float, float] | None:
        """Return (median, q10) of the forecast at the end of the horizon, or None."""
        pipe = _load_pipeline(self.model_id)
        if pipe is None:
            return None
        try:
            import torch

            ctx = torch.tensor(closes[-self.context :], dtype=torch.float32)
            # First arg is positional on purpose: chronos 1.x names it `context`,
            # 2.x names it `inputs` — positional works on both.
            # quantile_levels rows: [q10, q50, q90] for each horizon step.
            quantiles, _ = pipe.predict_quantiles(
                ctx,
                prediction_length=self.horizon,
                quantile_levels=[0.1, 0.5, 0.9],
            )
            q10 = float(quantiles[0, -1, 0])
            median = float(quantiles[0, -1, 1])
            return median, q10
        except Exception as e:
            log.warning("hf_forecast inference failed: %s", e)
            return None

    def decide(self, candles: list[dict]) -> str:
        if len(candles) < self.min_candles:
            return "HOLD"
        t = candles[-1]["time"]
        if self._memo and self._memo[0] == t:
            return self._memo[1]
        verdict = self._decide(candles)
        self._memo = (t, verdict)
        return verdict

    def _decide(self, candles: list[dict]) -> str:
        if not self._uptrend(candles):
            return "HOLD"
        closes = [c["close"] for c in candles]
        last = closes[-1]
        fc = self._forecast(closes)
        if fc is None:
            return "HOLD"
        median, q10 = fc
        # median must clear the threshold; q10 must not forecast a loss
        if (median - last) / last * 100.0 < self.min_forecast_pct:
            return "HOLD"
        if q10 < last:
            return "HOLD"
        if not self._clears(self.expected_move):
            return "HOLD"
        return "BUY"


if __name__ == "__main__":  # gate-logic self-check with a stubbed forecaster
    flat = [{"open": 1, "high": 1, "low": 1, "close": 1, "volume": 1, "time": i} for i in range(300)]
    up = [
        {"open": 1 + i * 0.01, "high": 1 + i * 0.01, "low": 1 + i * 0.01,
         "close": 1 + i * 0.01, "volume": 1, "time": i}
        for i in range(300)
    ]
    s = HFForecast("t", "BTCUSDT", {"regime_period": 200})
    s._clears = lambda _pct: True  # type: ignore[method-assign]

    s._forecast = lambda closes: (closes[-1] * 1.05, closes[-1] * 1.01)  # type: ignore[method-assign]
    assert s.decide(up[:100]) == "HOLD"  # too little history
    s._memo = None
    assert s.decide(up) == "BUY"  # uptrend + bullish forecast
    s._memo = None
    assert s.decide(flat) == "HOLD"  # regime gate blocks flat market

    s._forecast = lambda closes: (closes[-1] * 1.05, closes[-1] * 0.99)  # type: ignore[method-assign]
    s._memo = None
    assert s.decide(up) == "HOLD"  # q10 below entry -> downside guard blocks

    s._forecast = lambda closes: (closes[-1] * 1.001, closes[-1] * 1.0001)  # type: ignore[method-assign]
    s._memo = None
    assert s.decide(up) == "HOLD"  # median under min_forecast_pct

    s._forecast = lambda closes: None  # type: ignore[method-assign]
    s._memo = None
    assert s.decide(up) == "HOLD"  # deps missing -> safe HOLD
    print("hf_forecast gate self-checks OK")
