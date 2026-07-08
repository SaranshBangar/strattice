import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { ToastProvider } from "@/components/Toast";
import { Walkthrough } from "@/components/Walkthrough";

const display = Archivo({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-display",
  display: "swap",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

const SITE_URL = process.env.BETTER_AUTH_URL || "https://strattice.in";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Strattice", template: "%s · Strattice" },
  description:
    "Run algorithmic trading strategies on your own CoinDCX account. Non-custodial, paper-trading first, every number net of India's fees and TDS.",
  openGraph: {
    siteName: "Strattice",
    type: "website",
    locale: "en_IN",
    title: "Strattice",
    description:
      "Run algorithmic trading strategies on your own CoinDCX account. Non-custodial, paper-trading first, every number net of India's fees and TDS.",
    images: [{ url: "/favicon-512.png", width: 512, height: 512 }],
  },
  twitter: {
    card: "summary",
    title: "Strattice",
    description:
      "Run algorithmic trading strategies on your own CoinDCX account.",
    images: ["/favicon-512.png"],
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = { themeColor: "#0a0a0a" };

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body className="min-h-screen">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-1.5 focus:text-sm focus:font-medium focus:text-accent-ink"
        >
          Skip to content
        </a>
        <ToastProvider>
          <Walkthrough />
          <Nav />
          <main id="main" className="mx-auto max-w-5xl px-4 py-10">
            {children}
          </main>
          <footer className="mt-20 bg-inset/70">
            <div className="mx-auto max-w-5xl space-y-8 px-4 py-12">
              <div className="flex flex-wrap items-start justify-between gap-6">
                <div>
                  <span className="font-display text-sm font-semibold tracking-tight text-dim">
                    stra<span className="text-accent">tt</span>ice
                  </span>
                  <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted">
                    Algorithmic strategies, executed on your own CoinDCX account
                    with keys you control.
                  </p>
                </div>
                <dl className="grid grid-cols-1 gap-x-10 gap-y-2 font-mono text-[11px] sm:grid-cols-3">
                  {(
                    [
                      ["custody", "never held by us"],
                      ["default mode", "DRY_RUN"],
                      ["kill switch", "one toggle, next poll"],
                    ] as const
                  ).map(([k, v]) => (
                    <div key={k}>
                      <dt className="uppercase tracking-[0.15em] text-faint">
                        {k}
                      </dt>
                      <dd className="mt-0.5 text-dim">{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div className="space-y-3">
                <span className="font-mono text-[11px] uppercase tracking-wider text-faint">
                  free during early access · non-custodial
                </span>
                <p className="max-w-3xl text-[11px] leading-relaxed text-faint">
                  Crypto assets are volatile and unregulated in many
                  jurisdictions; algorithmic strategies can and do lose money.
                  Simulated or historical performance never guarantees future
                  results. Strattice never holds your funds - trades execute on
                  your own CoinDCX account with keys you control, and every
                  round trip pays exchange fees, GST and TDS. Start in DRY_RUN,
                  size positions you can afford to lose.
                </p>
                <nav className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px]">
                  <Link
                    href="/terms"
                    className="text-faint underline-offset-2 hover:text-dim hover:underline"
                  >
                    Terms
                  </Link>
                  <Link
                    href="/privacy"
                    className="text-faint underline-offset-2 hover:text-dim hover:underline"
                  >
                    Privacy
                  </Link>
                </nav>
              </div>
            </div>
          </footer>
        </ToastProvider>
      </body>
    </html>
  );
}
