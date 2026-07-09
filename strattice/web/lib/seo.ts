// Central SEO surface: canonical site metadata and JSON-LD structured-data
// builders. Structured data is the single biggest lever we have for rich results
// in Google (sitelinks, FAQ accordions, app rating cards), so it lives here in
// one typed place instead of being sprinkled as raw <script> strings.

export const SITE_URL = process.env.BETTER_AUTH_URL || "https://strattice.in";
export const SITE_NAME = "Strattice";

// Description reused across metadata + Organization schema. Leads with the exact
// high-intent phrase people search ("automated/auto crypto trading in India")
// and stays under ~160 chars so Google shows it whole in the SERP snippet.
export const SITE_DESCRIPTION =
  "Automated crypto trading in India, on your own CoinDCX account. Backtest-proven algo strategies, non-custodial, paper-trading first — net of fees, GST & TDS.";

// High-intent terms an Indian crypto trader actually types, ordered by intent
// strength and led by the exact-match queries we most want to rank for.
// `keywords` no longer moves Google's ranking directly, but it still feeds some
// engines and documents our target vocabulary in one place.
export const SITE_KEYWORDS = [
  "crypto auto trading India",
  "automated crypto trading India",
  "auto trading crypto",
  "crypto trading bot India",
  "algorithmic trading India",
  "algo trading crypto India",
  "CoinDCX trading bot",
  "CoinDCX API trading",
  "automated crypto trading platform",
  "backtesting crypto strategies",
  "paper trading crypto India",
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
    // Alternate names mirror how people phrase the search, so the entity matches
    // "automated/auto crypto trading" queries as well as the brand term.
    alternateName: [
      "Strattice — Automated Crypto Trading India",
      "Strattice CoinDCX Trading Bot",
    ],
    applicationCategory: "FinanceApplication",
    applicationSubCategory: "Automated Crypto Trading Platform",
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

// BreadcrumbList gives Google the site hierarchy for the breadcrumb SERP treatment
// (the "strattice.in › Demo" trail under the title) instead of a bare URL.
export function breadcrumbSchema(
  trail: readonly (readonly [string, string])[],
) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map(([name, path], i) => ({
      "@type": "ListItem",
      position: i + 1,
      name,
      item: absoluteUrl(path),
    })),
  } as const;
}

/** Renders one or more JSON-LD objects as a script tag payload string. */
export function jsonLd(schema: object) {
  return JSON.stringify(schema);
}
