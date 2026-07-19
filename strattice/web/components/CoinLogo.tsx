"use client";
// Coin logo: the real brand mark from CoinCap's free public icon CDN
// (lib/coins.ts#coinLogoUrl - keyless, uniform ticker-keyed URLs), falling
// back to a brand-coloured glyph disc when the coin is unknown (custom market
// ids) or the image fails to load (offline, CDN gap). Client component only
// for the onError swap; safe to drop into server-rendered tables - it becomes
// a tiny client boundary.
import { useState } from "react";
import { baseSymbol, coinFor, coinLogoUrl } from "@/lib/coins";

export function CoinLogo({
  market,
  size = 16,
  className,
}: {
  /** Market id or bare ticker: "I-BTC_INR", "BTCUSDT", "BTC". */
  market: string;
  /** Logo diameter in px. */
  size?: number;
  className?: string;
}) {
  const coin = coinFor(market);
  const [failed, setFailed] = useState(false);

  if (coin && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- tiny remote icon; next/image adds no value here
      <img
        src={coinLogoUrl(coin)}
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => setFailed(true)}
        className={["inline-block shrink-0 select-none rounded-full", className ?? ""].join(" ")}
        style={{ width: size, height: size }}
      />
    );
  }

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
