// Same-origin proxy for coin logos. The app's Content-Security-Policy allows
// images from 'self' only (next.config.mjs img-src), so the browser cannot
// load icon CDNs directly - CoinLogo points every <img> here instead, and this
// route fetches the brand mark server-side from free public icon sets
// (lib/coins.ts#coinLogoSources: jsDelivr's spothq set, CoinCap assets,
// CoinGecko), trying mirrors in order so one dead host doesn't blank the
// logos. Upstream fetches are cached for a day via Next's fetch cache, and the
// response carries long browser-cache headers - a page full of coin logos
// costs at most one upstream fetch per coin per day. Only catalog coins are
// served, so this can't be used as an open image proxy.
import { NextResponse } from "next/server";
import { coinFor, coinLogoSources } from "@/lib/coins";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export async function GET(req: Request) {
  // Cheap per-IP cap; 240/min comfortably covers a dashboard full of logos.
  if (!rateLimit(`coinlogo:${clientIp(req)}`, 240, 60_000)) {
    return NextResponse.json(
      { error: "rate limited" },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const { searchParams } = new URL(req.url);
  // Accepts a bare ticker ("BTC") or a full market id ("I-BTC_INR").
  const symbol = (searchParams.get("symbol") || "").toUpperCase().trim();
  if (!/^[A-Z0-9_-]{2,24}$/.test(symbol))
    return NextResponse.json({ error: "invalid symbol" }, { status: 400 });
  const coin = coinFor(symbol);
  if (!coin)
    return NextResponse.json({ error: "unknown coin" }, { status: 404 });

  for (const url of coinLogoSources(coin)) {
    try {
      const r = await fetch(url, {
        next: { revalidate: 86_400 },
        headers: { accept: "image/*" },
      });
      if (!r.ok) continue; // try the next mirror
      const type = r.headers.get("content-type") ?? "";
      if (!type.startsWith("image/")) continue; // an HTML error page is not a logo
      const body = await r.arrayBuffer();
      if (body.byteLength === 0) continue;
      return new NextResponse(body, {
        headers: {
          "content-type": type,
          // Logos are effectively immutable; let browsers keep them for a day
          // and serve stale for a week while revalidating.
          "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
        },
      });
    } catch {
      // network error - fall through to the next mirror
    }
  }
  // Every mirror failed: 404 lets the client's onError swap in the glyph disc.
  return NextResponse.json({ error: "logo unavailable" }, { status: 404 });
}
