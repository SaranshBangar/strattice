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
    return cls(spec["name"], spec["market"], spec.get("params", {}))
