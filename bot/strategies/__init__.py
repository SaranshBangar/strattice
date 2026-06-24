"""Strategy registry. Maps config `module` name -> Strategy subclass."""
from .fast_rsi import FastRSIReversion
from .ma_crossover import MACrossover
from .momentum import Momentum
from .rsi import RSIMeanReversion
from .vol_expansion import VolExpansion

REGISTRY = {
    "ma_crossover": MACrossover,
    "rsi": RSIMeanReversion,
    "momentum": Momentum,
    "vol_expansion": VolExpansion,
    "fast_rsi": FastRSIReversion,
}


def build(spec: dict):
    cls = REGISTRY[spec["module"]]
    return cls(spec["name"], spec["market"], spec.get("params", {}))
