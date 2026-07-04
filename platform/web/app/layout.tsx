import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { ToastProvider } from "@/components/Toast";

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
  title: "Strattice",
  description: "Run algorithmic trading strategies on your own CoinDCX account.",
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body className="min-h-screen">
        <ToastProvider>
          <Nav />
          <main className="mx-auto max-w-5xl px-4 py-10">{children}</main>
          <footer className="mt-16 border-t border-line">
            <div className="mx-auto max-w-5xl space-y-3 px-4 py-8">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="font-display text-sm font-semibold tracking-tight text-dim">strattice</span>
                <span className="font-mono text-[11px] uppercase tracking-wider text-faint">
                  free during early access · non-custodial
                </span>
              </div>
              <p className="max-w-3xl text-[11px] leading-relaxed text-faint">
                Crypto assets are volatile and unregulated in many jurisdictions; algorithmic strategies can and do
                lose money. Simulated or historical performance never guarantees future results. Strattice never holds
                your funds - trades execute on your own CoinDCX account with keys you control, and every round trip
                pays exchange fees, GST and TDS. Start in DRY_RUN, size positions you can afford to lose.
              </p>
            </div>
          </footer>
        </ToastProvider>
      </body>
    </html>
  );
}
