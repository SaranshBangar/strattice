// Plain-English definitions for the trading jargon a newcomer meets on the
// site. Rendered by <Term> (dotted glossary words) - keep each one short,
// concrete and free of further jargon.
export const GLOSSARY = {
  strategy:
    "A rulebook the bot follows: if the market does X, buy; if it does Y, sell. No gut feelings, no improvising.",
  backtest:
    "A rehearsal on past prices: replay the strategy over history to see how it would have traded before risking anything.",
  drawdown:
    "How far your balance has dipped below its best-ever level. A -10% drawdown means you were 10% below your peak at that moment.",
  "stop-loss":
    "A pre-set exit that sells automatically if a trade moves against you past a limit - it caps how much one trade can lose.",
  "take-profit":
    "A pre-set exit that sells automatically once a trade has gained a chosen amount - it locks the win in.",
  "paper trading":
    "Practice mode (DRY_RUN): the bot trades fake money on real live prices. Every result is simulated - nothing real is at risk.",
  "moving average":
    "The average price over the last N candles, drawn as a smooth line. Price crossing above or below it is a classic trend signal.",
  "win rate":
    "Of all the trades the bot closed, the share that made money. High isn't everything - a few big wins can beat many small ones.",
  "API key":
    "A password-like token from your exchange that lets the bot place trades on your account. Withdrawals stay disabled - it can trade, never take funds out.",
  slippage:
    "The small difference between the price you expected and the price your order actually filled at - a real cost in fast markets.",
  TDS:
    "A 1% tax withheld on every crypto sell in India (section 194S). It's a credit you claim back when filing, not an extra fee.",
  equity:
    "The bot's account balance: what you started with plus everything it has won or lost so far.",
  signal:
    "The moment a strategy's rule fires - e.g. price crossing above its moving average. Signals are what turn into buy or sell orders.",
} as const;

export type GlossaryKey = keyof typeof GLOSSARY;
