import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What Strattice collects, why, and how it is protected.",
  alternates: { canonical: "/privacy" },
};

const UPDATED = "6 July 2026";

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-8 font-display text-lg font-semibold tracking-tight text-fg">{children}</h2>;
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-sm leading-relaxed text-muted">{children}</p>;
}
function LI({ children }: { children: React.ReactNode }) {
  return <li className="mt-2 text-sm leading-relaxed text-muted">{children}</li>;
}

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-display text-2xl font-semibold tracking-tight text-fg">Privacy Policy</h1>
      <p className="mt-1 font-mono text-[11px] text-faint">Last updated {UPDATED}</p>

      <P>
        This policy explains what Strattice (the &ldquo;Service&rdquo;) collects, why, and how it is protected. We collect the minimum needed to run
        the Service.
      </P>

      <H>What we collect</H>
      <ul className="mt-2 list-disc pl-5">
        <LI>
          <span className="text-dim">Account data</span> — your email, optional name, and authentication credentials (or a Google account identifier
          if you sign in with Google).
        </LI>
        <LI>
          <span className="text-dim">Exchange API keys</span> — the CoinDCX API key and secret you choose to link, stored encrypted at rest and never
          displayed back.
        </LI>
        <LI>
          <span className="text-dim">Trading and bot data</span> — the strategies you configure and the trades, positions, and equity snapshots your
          bot produces, so the dashboard can show them.
        </LI>
        <LI>
          <span className="text-dim">Preferences</span> — notification and display-currency settings, including a Telegram chat id if you add one.
        </LI>
        <LI>
          <span className="text-dim">Technical data</span> — basic request metadata (such as IP address) used for security and rate limiting.
        </LI>
      </ul>

      <H>How we use it</H>
      <P>
        To operate the Service: run your strategies, show your dashboard, send the notifications you enable, protect accounts from abuse, and provide
        support. We do not sell your personal data.
      </P>

      <H>Security</H>
      <P>
        Data is stored in Cloudflare D1. CoinDCX API keys are encrypted with AES-256-GCM and are never shown back to you or visible in any admin view.
        We recommend keys with withdrawals disabled so funds cannot leave your exchange account through Strattice. No system is perfectly secure, but
        we take reasonable measures to protect your data.
      </P>

      <H>Third parties</H>
      <P>
        We share data only as needed to run the Service, with providers including: CoinDCX (order execution, using your keys), public market-data
        providers, an email provider for transactional email, Google (only if you use Google sign-in), Telegram (only if you enable Telegram alerts),
        and our authentication provider. Each processes data under its own terms.
      </P>

      <H>Sessions and cookies</H>
      <P>We use a session cookie to keep you signed in. We do not use third-party advertising or tracking cookies.</P>

      <H>Retention</H>
      <P>
        We keep your data while your account is active. When you delete your account, associated data — including your encrypted API keys — is
        removed. Some records may be retained where required by law.
      </P>

      <H>Your rights</H>
      <P>
        You can access and update your information in the app, remove your API keys at any time, and request deletion of your account and data. To
        exercise these rights, or to raise a grievance under applicable data-protection law, contact us below.
      </P>

      <H>Children</H>
      <P>The Service is not directed to anyone under 18, and we do not knowingly collect their data.</P>

      <H>Changes and contact</H>
      <P>
        We may update this policy; the &ldquo;last updated&rdquo; date above reflects the latest version. Questions or requests can be sent to{" "}
        <a className="text-accent underline-offset-2 hover:underline" href="mailto:saranshbangad@gmail.com">
          saranshbangad@gmail.com
        </a>
        .
      </P>

      <p className="mt-10 text-sm text-muted">
        See also our{" "}
        <Link href="/terms" className="text-accent underline-offset-2 hover:underline">
          Terms of Service
        </Link>
        .
      </p>
    </div>
  );
}
