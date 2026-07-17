"""Strategy registry. Maps config `module` name -> Strategy subclass."""
from .acceleration import AccelerationMomentum
from .bb_reversion import BBReversion
from .capitulation import CapitulationReversal
from .custom import CustomRules
from .fast_rsi import FastRSIReversion
from .hf_forecast import HFForecast
from .ma_crossover import MACrossover
from .momentum import Momentum
from .rsi import RSIMeanReversion
from .squeeze_breakout import SqueezeBreakout
from .supertrend import Supertrend
from .trend_ensemble import TrendEnsemble
from .tsmom import TSMomentum
from .vol_expansion import VolExpansion

REGISTRY = {
    "acceleration": AccelerationMomentum,
    "capitulation": CapitulationReversal,
    "ma_crossover": MACrossover,
    "rsi": RSIMeanReversion,
    "momentum": Momentum,
    "vol_expansion": VolExpansion,
    "fast_rsi": FastRSIReversion,
    "bb_reversion": BBReversion,
    "squeeze_breakout": SqueezeBreakout,
    "supertrend": Supertrend,
    "trend_ensemble": TrendEnsemble,
    "tsmom": TSMomentum,
    "hf_forecast": HFForecast,
    "custom": CustomRules,
}


def build(spec: dict):
    cls = REGISTRY[spec["module"]]
    return cls(spec["name"], spec["market"], spec.get("params", {}))
