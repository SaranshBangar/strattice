import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { ToastProvider } from "@/components/Toast";
import { Walkthrough } from "@/components/Walkthrough";
import { JsonLd } from "@/components/JsonLd";
import {
  SITE_URL,
  SITE_NAME,
  SITE_DESCRIPTION,
  SITE_KEYWORDS,
  organizationSchema,
  websiteSchema,
} from "@/lib/seo";

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

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Strattice · Algorithmic crypto trading on your own CoinDCX account",
    template: "%s · Strattice",
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: SITE_KEYWORDS,
  authors: [{ name: SITE_NAME, url: SITE_URL }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  category: "finance",
  alternates: { canonical: "/" },
  // Give crawlers explicit permission for the rich SERP treatments (large image
  // previews, full text snippets) instead of the conservative defaults.
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    siteName: SITE_NAME,
    type: "website",
    locale: "en_IN",
    url: SITE_URL,
    title: "Strattice · Algorithmic crypto trading on your own CoinDCX account",
    description: SITE_DESCRIPTION,
    // 1200x630 branded card generated at /opengraph-image (see opengraph-image.tsx).
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Strattice — algorithmic trading on your own CoinDCX account",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Strattice · Algorithmic crypto trading on your own CoinDCX account",
    description: SITE_DESCRIPTION,
    images: ["/opengraph-image"],
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
        {/* Site-wide structured data: identifies the brand + site to crawlers. */}
        <JsonLd schema={organizationSchema()} />
        <JsonLd schema={websiteSchema()} />
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
