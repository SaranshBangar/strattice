import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms that govern use of Strattice.",
  alternates: { canonical: "/terms" },
};

const UPDATED = "6 July 2026";

function H({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-8 font-display text-lg font-semibold tracking-tight text-fg">
      {children}
    </h2>
  );
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-sm leading-relaxed text-muted">{children}</p>;
}

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-display text-2xl font-semibold tracking-tight text-fg">
        Terms of Service
      </h1>
      <p className="mt-1 font-mono text-[11px] text-faint">
        Last updated {UPDATED}
      </p>

      <P>
        These terms govern your use of Strattice (the &ldquo;Service&rdquo;). By
        creating an account or using the Service you agree to them. If you do
        not agree, do not use the Service.
      </P>

      <H>1. What Strattice is</H>
      <P>
        Strattice is a non-custodial tool for running algorithmic trading
        strategies on your own CoinDCX account, using API keys you provide and
        control. We never take custody of your funds, and orders execute on your
        own exchange account. Strattice is a software tool, not a broker,
        exchange, portfolio manager, or investment adviser.
      </P>

      <H>2. Not financial advice</H>
      <P>
        Nothing in the Service is financial, investment, legal, or tax advice.
        Strategy templates, previews, simulations, and any metrics are for
        information only. You are solely responsible for your trading decisions.
      </P>

      <H>3. Trading risk</H>
      <P>
        Crypto assets are volatile and, in many jurisdictions, unregulated.
        Algorithmic strategies can and do lose money, and simulated or
        historical performance never guarantees future results. The Service
        starts every bot in DRY_RUN (simulation) mode; arming live trading is an
        explicit, deliberate action you take. Only trade with funds you can
        afford to lose.
      </P>

      <H>4. Eligibility</H>
      <P>
        You must be at least 18 years old and legally able to enter into these
        terms and to trade crypto assets where you live. You are responsible for
        complying with all laws that apply to you, including tax obligations.
      </P>

      <H>5. Your account and API keys</H>
      <P>
        You are responsible for keeping your login credentials and CoinDCX API
        keys secure. We strongly recommend creating keys with trading enabled
        and withdrawals disabled, so funds cannot leave your exchange account
        through Strattice. API keys are encrypted at rest and never shown back
        to you or anyone else. You may remove your keys or delete your account at
        any time.
      </P>

      <H>6. Acceptable use</H>
      <P>
        Do not use the Service to break the law, to abuse or overload the
        platform or the exchanges and data providers it relies on, to
        reverse-engineer or disrupt it, or to access another user&rsquo;s data.
        We may suspend or terminate accounts that do.
      </P>

      <H>7. Third-party services</H>
      <P>
        The Service depends on third parties including CoinDCX (order
        execution), public market-data providers, email delivery, and optional
        Google sign-in and Telegram alerts. Your use of those services is
        subject to their own terms, and we are not responsible for their
        availability or actions.
      </P>

      <H>8. Fees</H>
      <P>
        Strattice is free during early access. If paid plans are introduced, we
        will give notice and you can choose whether to continue. Exchange fees,
        GST, and TDS on your trades are charged by the exchange and the
        government, not by us.
      </P>

      <H>9. Disclaimers and limitation of liability</H>
      <P>
        The Service is provided &ldquo;as is&rdquo; and &ldquo;as
        available&rdquo; without warranties of any kind. To the maximum extent
        permitted by law, Strattice and its operators are not liable for any
        trading losses or for any indirect, incidental, or consequential damages
        arising from your use of the Service.
      </P>

      <H>10. Termination</H>
      <P>
        You may stop using the Service and delete your account at any time. We
        may suspend or end access if you breach these terms or to protect the
        Service and its users.
      </P>

      <H>11. Changes</H>
      <P>
        We may update these terms. Material changes will be reflected by the
        &ldquo;last updated&rdquo; date above and, where appropriate, notified to
        you. Continued use after a change means you accept the updated terms.
      </P>

      <H>12. Governing law and contact</H>
      <P>
        These terms are governed by the laws of India. Questions, or grievances
        under applicable data-protection law, can be sent to{" "}
        <a
          className="text-accent underline-offset-2 hover:underline"
          href="mailto:support@strattice.in"
        >
          support@strattice.in
        </a>
        .
      </P>

      <p className="mt-10 text-sm text-muted">
        See also our{" "}
        <Link
          href="/privacy"
          className="text-accent underline-offset-2 hover:underline"
        >
          Privacy Policy
        </Link>
        .
      </p>
    </div>
  );
}
