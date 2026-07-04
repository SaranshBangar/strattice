"""Strategy registry. Maps config `module` name -> Strategy subclass."""
from .bb_reversion import BBReversion
from .custom import CustomRules
from .fast_rsi import FastRSIReversion
from .ma_crossover import MACrossover
from .momentum import Momentum
from .rsi import RSIMeanReversion
from .squeeze_breakout import SqueezeBreakout
from .tsmom import TSMomentum
from .vol_expansion import VolExpansion

REGISTRY = {
    "ma_crossover": MACrossover,
    "rsi": RSIMeanReversion,
    "momentum": Momentum,
    "vol_expansion": VolExpansion,
    "fast_rsi": FastRSIReversion,
    "bb_reversion": BBReversion,
    "squeeze_breakout": SqueezeBreakout,
    "tsmom": TSMomentum,
    "custom": CustomRules,
}


def build(spec: dict):
    cls = REGISTRY[spec["module"]]
    return cls(spec["name"], spec["market"], spec.get("params", {}))
