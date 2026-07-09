// Public demo dashboard: the real dashboard components fed with deterministic
// sample data (lib/demo-data.ts), so a visitor can see exactly what running
// the bot looks like before creating an account. No auth, no DB - only the
// PriceChart streams real live market data. This page doubles as a teaching
// surface: every metric carries a plain-English hint.
//
// The interactive body lives in <DemoDashboard> (a client component) so it can
// localize money to the visitor's currency without making this route dynamic.
// This shell stays static/ISR and server-renders the SEO-relevant structured
// data.
import { DemoDashboard } from "@/components/DemoDashboard";
import { demoData } from "@/lib/demo-data";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbSchema } from "@/lib/seo";

// The sample data is deterministic - only the date labels move with the clock
// (they roll at UTC midnight). Hourly ISR lets the CDN serve cached HTML
// instead of re-rendering per request; the PriceChart still streams live
// prices client-side.
export const revalidate = 3600;

export const metadata = {
  title: "Demo dashboard",
  description:
    "A sample of the Strattice dashboard - what your bot's paper-trading history looks like once it's running. Deterministic sample data, no account needed.",
  alternates: { canonical: "/demo" },
  openGraph: {
    title: "Demo dashboard · Strattice",
    description:
      "What your bot's paper-trading history looks like once it's running - explore the full dashboard with sample data, no account needed.",
    url: "/demo",
  },
};

export default function DemoPage() {
  return (
    <>
      <JsonLd
        schema={breadcrumbSchema([
          ["Home", "/"],
          ["Demo dashboard", "/demo"],
        ])}
      />
      <DemoDashboard data={demoData()} />
    </>
  );
}
