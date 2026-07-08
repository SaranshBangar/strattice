// Content-Security-Policy. Directives are scoped to what the app actually loads:
//   - script/style 'unsafe-inline': Next's hydration bootstrap and next/font inject inline
//     tags. Locking these to nonces needs per-request middleware (forces every page dynamic),
//     a larger change; the allowlisted default-src/connect-src below already block the main
//     exfiltration/injection paths. Nonce hardening is a tracked follow-up.
//   - connect-src: same-origin APIs, Binance market data + live-trade WebSocket (LiveChart /
//     PriceChart hit these directly from the browser), and Better Auth's Sentinel (kv/dash).
//   - form-action / frame-src: Google OAuth.
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self' https://accounts.google.com",
  "frame-src 'self' https://accounts.google.com",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  // Dev-only 'unsafe-eval': next dev serves webpack eval-sourcemap bundles, so a strict
  // script-src kills hydration locally (every client component dies silently). Production
  // bundles contain no eval and keep the strict policy.
  process.env.NODE_ENV === "development"
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'",
  // stream.binance.com uses port 9443 - a source without a port implies the scheme
  // default (443) and would block the live-price WebSocket, so the port is explicit.
  "connect-src 'self' https://data-api.binance.vision wss://stream.binance.com:9443 https://kv.better-auth.com https://dash.better-auth.com",
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // App is never meant to be framed - blocks clickjacking. X-Frame-Options is the
          // legacy belt to the CSP frame-ancestors suspenders.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
    ];
  },
};
export default nextConfig;
