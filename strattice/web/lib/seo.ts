// Central SEO surface: canonical site metadata and JSON-LD structured-data
// builders. Structured data is the single biggest lever we have for rich results
// in Google (sitelinks, FAQ accordions, app rating cards), so it lives here in
// one typed place instead of being sprinkled as raw <script> strings.

export const SITE_URL = process.env.BETTER_AUTH_URL || "https://strattice.in";
export const SITE_NAME = "Strattice";

// Description reused across metadata + Organization schema. Kept under ~155
// chars so Google shows it whole in the SERP snippet.
export const SITE_DESCRIPTION =
  "Run backtest-proven algorithmic trading strategies on your own CoinDCX account. Non-custodial, paper-trading first, every number net of India's fees, GST and TDS.";

// High-intent terms an Indian crypto trader actually types. Order roughly by
// intent strength. `keywords` no longer moves Google's ranking directly, but it
// still feeds some engines and documents our target vocabulary in one place.
export const SITE_KEYWORDS = [
  "algorithmic trading India",
  "crypto trading bot India",
  "CoinDCX trading bot",
  "CoinDCX API trading",
  "automated crypto trading",
  "algo trading crypto",
  "backtesting crypto strategies",
  "paper trading crypto",
  "non-custodial trading bot",
  "trading strategy builder",
  "Bitcoin trading bot India",
  "crypto momentum strategy",
  "Donchian breakout bot",
  "TDS crypto trading",
  "Strattice",
];

export const absoluteUrl = (path = "/") =>
  new URL(path, SITE_URL).toString();

// --- JSON-LD builders ------------------------------------------------------
// Each returns a plain object we serialize into a <script type="application/ld+json">.

export function organizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
    logo: absoluteUrl("/favicon-512.png"),
    description: SITE_DESCRIPTION,
    foundingLocation: {
      "@type": "Place",
      address: { "@type": "PostalAddress", addressCountry: "IN" },
    },
    slogan: "Algorithmic trading that runs on your own account.",
  } as const;
}

export function websiteSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: SITE_URL,
    inLanguage: "en-IN",
    description: SITE_DESCRIPTION,
    publisher: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
  } as const;
}

// SoftwareApplication makes us eligible for the app-style rich result (category,
// price, platform). We market as free during early access, so price is "0".
export function softwareApplicationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    applicationCategory: "FinanceApplication",
    applicationSubCategory: "Algorithmic Trading Platform",
    operatingSystem: "Web",
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    inLanguage: "en-IN",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "INR",
      availability: "https://schema.org/InStock",
      description: "Free during early access",
    },
    featureList: [
      "Backtest-proven strategy templates",
      "Visual strategy builder",
      "Paper trading (DRY_RUN) with real prices",
      "Risk-managed executor with hard stops and kill switch",
      "Costs modeled net of exchange fees, GST and TDS",
      "Non-custodial execution on your own CoinDCX account",
    ],
  } as const;
}

// Turn the on-page FAQ (question/answer tuples) into an FAQPage. This is what
// gets us the expandable FAQ block directly in the search result. The array is
// the same data rendered on the page, so the visible content matches the markup
// (a Google requirement for FAQ rich results).
export function faqPageSchema(faq: readonly (readonly [string, string])[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map(([question, answer]) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  } as const;
}

/** Renders one or more JSON-LD objects as a script tag payload string. */
export function jsonLd(schema: object) {
  return JSON.stringify(schema);
}
