"""Strategy registry. Maps config `module` name -> Strategy subclass."""
from .ma_crossover import MACrossover
from .momentum import Momentum
from .rsi import RSIMeanReversion

REGISTRY = {
    "ma_crossover": MACrossover,
    "rsi": RSIMeanReversion,
    "momentum": Momentum,
}


def build(spec: dict):
    cls = REGISTRY[spec["module"]]
    # capital is legacy: sizing is wallet-scaled now (bot/sizing.py). Kept for the base ctor.
    return cls(spec["name"], spec["market"], spec.get("capital", 0.0), spec.get("params", {}))
