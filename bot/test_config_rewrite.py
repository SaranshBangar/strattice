"""Self-check: _set_enabled flips the RIGHT strategy's `enabled` flag and leaves every other
byte of config.yaml untouched. The whole point of the line-edit (vs a yaml round-trip) is
comment/format preservation, so this asserts byte-identity on all non-target lines.

Run: python -m bot.test_config_rewrite
"""
import tempfile
from pathlib import Path

from .server import _set_enabled

SAMPLE = (
    "strategies:\n"
    '  - name: "ma_btc"\n'
    "    enabled: true\n"
    "    weight: 1.0   # keep this comment\n"
    '  - name: "rsi_eth"\n'
    "    enabled: false  # trailing comment\n"
    "    weight: 1.0\n"
)
# 0-indexed line numbers of the two enabled: lines
MA_LINE, RSI_LINE = 2, 5


def main() -> None:
    p = Path(tempfile.mkdtemp()) / "config.yaml"
    p.write_text(SAMPLE, encoding="utf-8")
    orig = SAMPLE.splitlines(keepends=True)

    # flip rsi_eth false -> true; only its line changes, comment preserved
    assert _set_enabled("rsi_eth", True, p) is True
    after = p.read_text(encoding="utf-8").splitlines(keepends=True)
    assert [i for i in range(len(orig)) if orig[i] != after[i]] == [RSI_LINE]
    assert after[RSI_LINE] == "    enabled: true  # trailing comment\n", repr(after[RSI_LINE])
    for i in range(len(orig)):
        if i != RSI_LINE:
            assert orig[i] == after[i], (i, orig[i], after[i])

    # unknown name -> False, file byte-identical
    before = p.read_text(encoding="utf-8")
    assert _set_enabled("nope", True, p) is False
    assert p.read_text(encoding="utf-8") == before

    # idempotent: flip ma_btc true -> true changes nothing
    assert _set_enabled("ma_btc", True, p) is True
    assert p.read_text(encoding="utf-8").splitlines(keepends=True)[MA_LINE] == orig[MA_LINE]

    print("ok")


if __name__ == "__main__":
    main()
