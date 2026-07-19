// Coin logo disc: brand colour + glyph from the shared catalog (lib/coins.ts).
// Pure markup, no hooks - safe in both server and client components. Unknown
// coins (custom market ids) fall back to a neutral disc with the first letter,
// so the layout never jumps.
import { baseSymbol, coinFor } from "@/lib/coins";

export function CoinLogo({
  market,
  size = 16,
  className,
}: {
  /** Market id or bare ticker: "I-BTC_INR", "BTCUSDT", "BTC". */
  market: string;
  /** Disc diameter in px. */
  size?: number;
  className?: string;
}) {
  const coin = coinFor(market);
  const glyph = coin?.glyph ?? baseSymbol(market).slice(0, 1) ?? "?";
  return (
    <span
      aria-hidden="true"
      className={[
        "inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold leading-none",
        className ?? "",
      ].join(" ")}
      style={{
        width: size,
        height: size,
        background: coin?.color ?? "#3A415A",
        color: coin?.ink ?? "#FFFFFF",
        fontSize: Math.round(size * 0.56),
      }}
    >
      {glyph}
    </span>
  );
}
