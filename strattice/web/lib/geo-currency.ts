"use client";
// Auto-detects a visitor's display currency from their browser, no network geo
// lookup and no permission prompt: the IANA timezone is the primary signal
// (maps cleanly to a country), with the locale region as a fallback. We only
// ever resolve to a currency the app actually supports (lib/currencies.ts);
// anything we can positively place but don't support falls back to USD, and a
// total miss keeps the product default (INR) so the server-rendered markup
// never flips for users we can't locate.
//
// Two rates come out of a single USD-base fetch:
//   usdRate - USD -> code, for the live Binance price charts (quoted in USDT)
//   inrRate - INR -> code, for the demo ledger (a CoinDCX book is INR)
// Nothing changes until BOTH a supported code and its rate are known, so a
// failed rate fetch leaves the page on its honest default rather than a
// symbol-swapped-but-unconverted number.
import { useEffect, useState } from "react";
import {
  currencySymbol,
  DEFAULT_CURRENCY,
  isCurrencyCode,
  type CurrencyCode,
} from "@/lib/currencies";

export type AutoFx = {
  code: CurrencyCode;
  symbol: string;
  locale: string;
  usdRate: number; // USD -> code (live charts)
  inrRate: number; // INR -> code (demo ledger)
  ready: boolean; // true once a supported code AND its rate are resolved
};

const LOCALE: Record<CurrencyCode, string> = {
  INR: "en-IN",
  USD: "en-US",
  EUR: "de-DE",
  GBP: "en-GB",
  JPY: "ja-JP",
  AUD: "en-AU",
  SGD: "en-SG",
  AED: "en-AE",
};

// Country (ISO 3166-1 alpha-2) -> supported currency.
const COUNTRY_CCY: Record<string, CurrencyCode> = {
  IN: "INR",
  US: "USD",
  GB: "GBP",
  JP: "JPY",
  AU: "AUD",
  SG: "SGD",
  AE: "AED",
  // Eurozone
  AT: "EUR", BE: "EUR", CY: "EUR", EE: "EUR", FI: "EUR", FR: "EUR",
  DE: "EUR", GR: "EUR", IE: "EUR", IT: "EUR", LV: "EUR", LT: "EUR",
  LU: "EUR", MT: "EUR", NL: "EUR", PT: "EUR", SK: "EUR", SI: "EUR",
  ES: "EUR", HR: "EUR",
};

// Minimal IANA timezone -> country, enough to place every supported currency.
// Broad continents (America/*, Australia/*) are handled by prefix below.
const TZ_COUNTRY: Record<string, string> = {
  "Asia/Kolkata": "IN", "Asia/Calcutta": "IN",
  "Asia/Tokyo": "JP", "Asia/Singapore": "SG", "Asia/Dubai": "AE",
  "Europe/London": "GB", "Europe/Dublin": "IE", "Europe/Paris": "FR",
  "Europe/Berlin": "DE", "Europe/Madrid": "ES", "Europe/Rome": "IT",
  "Europe/Amsterdam": "NL", "Europe/Brussels": "BE", "Europe/Vienna": "AT",
  "Europe/Lisbon": "PT", "Europe/Athens": "GR", "Europe/Helsinki": "FI",
  "Europe/Bratislava": "SK", "Europe/Ljubljana": "SI", "Europe/Zagreb": "HR",
  "Europe/Vilnius": "LT", "Europe/Riga": "LV", "Europe/Tallinn": "EE",
  "Europe/Luxembourg": "LU", "Europe/Nicosia": "CY", "Europe/Valletta": "MT",
};

function guessCountry(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) {
      if (TZ_COUNTRY[tz]) return TZ_COUNTRY[tz];
      if (tz.startsWith("America/") || tz.startsWith("US/")) return "US";
      if (tz.startsWith("Australia/")) return "AU";
    }
  } catch {
    // Intl unavailable - fall through to locale
  }
  const langs =
    typeof navigator !== "undefined"
      ? navigator.languages?.length
        ? navigator.languages
        : [navigator.language]
      : [];
  for (const l of langs) {
    const m = /[-_]([A-Za-z]{2})\b/.exec(l ?? "");
    if (m) return m[1].toUpperCase();
  }
  return null;
}

/** Best-guess supported currency for this browser. Never throws. */
export function guessCurrency(): CurrencyCode {
  const country = guessCountry();
  if (country && COUNTRY_CCY[country]) return COUNTRY_CCY[country];
  // Placed them somewhere we don't support -> neutral USD; couldn't place them
  // at all -> product default, so the page keeps its server-rendered currency.
  return country ? "USD" : DEFAULT_CURRENCY;
}

const RATES_KEY = "strattice.fx.usd";
const RATES_TTL_MS = 12 * 60 * 60 * 1000; // 12h, matching the server fx cache

async function loadUsdRates(): Promise<Record<string, number> | null> {
  try {
    const raw = sessionStorage.getItem(RATES_KEY);
    if (raw) {
      const j = JSON.parse(raw) as { at: number; rates: Record<string, number> };
      if (j?.rates && Date.now() - j.at < RATES_TTL_MS) return j.rates;
    }
  } catch {
    // ignore cache read errors
  }
  try {
    const r = await fetch("https://open.er-api.com/v6/latest/USD");
    if (!r.ok) return null;
    const j = await r.json();
    const rates = j?.rates as Record<string, number> | undefined;
    if (!rates || !Number.isFinite(rates.INR)) return null;
    try {
      sessionStorage.setItem(RATES_KEY, JSON.stringify({ at: Date.now(), rates }));
    } catch {
      // sessionStorage may be unavailable (private mode) - non-fatal
    }
    return rates;
  } catch {
    return null;
  }
}

const DEFAULT_FX: AutoFx = {
  code: DEFAULT_CURRENCY,
  symbol: currencySymbol(DEFAULT_CURRENCY),
  locale: LOCALE[DEFAULT_CURRENCY],
  usdRate: 1,
  inrRate: 1,
  ready: false,
};

/**
 * Resolves the visitor's display currency + conversion rates on the client.
 * Returns a stable default (INR, ready:false) during SSR and first paint so
 * markup never mismatches; flips once to the detected currency after mount.
 */
export function useAutoFx(): AutoFx {
  const [fx, setFx] = useState<AutoFx>(DEFAULT_FX);

  useEffect(() => {
    let alive = true;
    const code = guessCurrency();
    loadUsdRates().then((rates) => {
      if (!alive || !rates) return; // no rates -> stay on the default, don't half-convert
      const perUsd = rates[code];
      const perUsdInr = rates.INR;
      if (!Number.isFinite(perUsd) || !Number.isFinite(perUsdInr) || perUsdInr <= 0)
        return;
      const next: AutoFx = {
        code,
        symbol: currencySymbol(code),
        locale: LOCALE[code] ?? LOCALE[DEFAULT_CURRENCY],
        usdRate: code === "USD" ? 1 : perUsd,
        inrRate: code === "INR" ? 1 : perUsd / perUsdInr,
        ready: true,
      };
      // Guard against an unexpected code slipping through.
      if (!isCurrencyCode(next.code)) return;
      setFx(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  return fx;
}
