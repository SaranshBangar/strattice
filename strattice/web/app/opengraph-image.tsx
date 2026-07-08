import { ImageResponse } from "next/og";

// Branded 1200x630 social/share card, generated on the edge. A real OG image
// (vs. reusing the 512px favicon) is what makes shared links render as a rich
// card on Google, X, WhatsApp, Slack etc. — which drives click-through, the
// signal that actually moves rankings.
export const runtime = "edge";
export const alt =
  "Strattice — algorithmic trading on your own CoinDCX account";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Brand palette (mirrors tailwind.config.ts).
const BG = "#0B0D12";
const PANEL = "#131722";
const LINE = "#1F2433";
const FG = "#E6E9F0";
const MUTED = "#828AA0";
const ACCENT = "#C9A24B";
const GAIN = "#16B97D";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: `radial-gradient(1200px 630px at 78% -10%, rgba(201,162,75,0.14), ${BG} 55%)`,
          padding: "72px 80px",
          fontFamily: "sans-serif",
        }}
      >
        {/* Top row: wordmark + eyebrow badge */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 40,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              color: FG,
            }}
          >
            stra<span style={{ color: ACCENT }}>tt</span>ice
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              border: `1px solid ${LINE}`,
              borderRadius: 8,
              padding: "10px 18px",
              fontSize: 22,
              color: MUTED,
            }}
          >
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: 2,
                background: GAIN,
              }}
            />
            Non-custodial · CoinDCX
          </div>
        </div>

        {/* Headline */}
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              fontSize: 68,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: "-0.03em",
              color: FG,
              maxWidth: 900,
            }}
          >
            Algorithmic trading that runs on your{" "}
            <span style={{ color: ACCENT }}>own</span> account.
          </div>
          <div style={{ fontSize: 30, color: MUTED, maxWidth: 860 }}>
            Backtest-proven strategies, paper-trading first — every number net of
            India&apos;s fees, GST and TDS.
          </div>
        </div>

        {/* Footer stat strip */}
        <div style={{ display: "flex", gap: 16 }}>
          {[
            ["₹0", "free during early access"],
            ["6", "strategy templates"],
            ["DRY_RUN", "safe by default"],
          ].map(([n, label]) => (
            <div
              key={label}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                background: PANEL,
                border: `1px solid ${LINE}`,
                borderRadius: 12,
                padding: "18px 26px",
              }}
            >
              <div style={{ fontSize: 34, fontWeight: 700, color: FG }}>{n}</div>
              <div style={{ fontSize: 20, color: MUTED }}>{label}</div>
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}
