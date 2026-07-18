"""Strategy registry. Maps config `module` name -> Strategy subclass."""
from .acceleration import AccelerationMomentum
from .adx_trend import AdxTrend
from .bb_reversion import BBReversion
from .capitulation import CapitulationReversal
from .custom import CustomRules
from .donchian_ls import DonchianLS
from .ensemble_ls import EnsembleLS
from .fast_rsi import FastRSIReversion
from .hf_forecast import HFForecast
from .ichimoku import IchimokuBreakout
from .kama_trend import KamaTrend
from .ma_crossover import MACrossover
from .macd_trend import MacdTrend
from .momentum import Momentum
from .rsi import RSIMeanReversion
from .sharpe_mom import SharpeMomentum
from .squeeze_breakout import SqueezeBreakout
from .supertrend import Supertrend
from .trend_ensemble import TrendEnsemble
from .trend_regime import TrendRegime
from .tsmom import TSMomentum
from .vol_expansion import VolExpansion

REGISTRY = {
    "acceleration": AccelerationMomentum,
    "adx_trend": AdxTrend,
    "capitulation": CapitulationReversal,
    "donchian_ls": DonchianLS,
    "ensemble_ls": EnsembleLS,
    "ichimoku": IchimokuBreakout,
    "kama_trend": KamaTrend,
    "ma_crossover": MACrossover,
    "macd_trend": MacdTrend,
    "rsi": RSIMeanReversion,
    "momentum": Momentum,
    "sharpe_mom": SharpeMomentum,
    "vol_expansion": VolExpansion,
    "fast_rsi": FastRSIReversion,
    "bb_reversion": BBReversion,
    "squeeze_breakout": SqueezeBreakout,
    "supertrend": Supertrend,
    "trend_ensemble": TrendEnsemble,
    "trend_regime": TrendRegime,
    "tsmom": TSMomentum,
    "hf_forecast": HFForecast,
    "custom": CustomRules,
}


def build(spec: dict):
    cls = REGISTRY[spec["module"]]
    return cls(spec["name"], spec["market"], spec.get("params", {}))
