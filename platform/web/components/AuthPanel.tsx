// Server-rendered side rail for the auth pages: the guarantees that matter at the
// exact moment someone is about to hand over an email address. Mono ledger styling
// to match the landing page's signature panel.
const GUARANTEES: [string, string][] = [
  ["custody", "Funds stay in your own CoinDCX account. Always."],
  ["keys", "Encrypted at rest; your secret is never shown back to anyone."],
  ["withdrawals", "Disabled on the key you create - we can't move money out."],
  ["default mode", "DRY_RUN. No live order until you explicitly flip the switch."],
  ["exit", "Kill switch stops all trading at the next poll. Delete keys anytime."],
];

export function AuthPanel() {
  return (
    <div className="hidden lg:block">
      <div className="overflow-hidden rounded-lg border border-line bg-panel">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-faint">
            what_you_agree_to
          </span>
          <span className="font-mono text-[11px] text-muted">nothing else</span>
        </div>
        <dl className="divide-y divide-line/70">
          {GUARANTEES.map(([k, v]) => (
            <div key={k} className="px-4 py-3">
              <dt className="font-mono text-[10px] uppercase tracking-[0.15em] text-faint">{k}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-dim">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="border-t border-line px-4 py-2.5 font-mono text-[11px] text-faint">
          free during early access · no card asked, ever
        </div>
      </div>
    </div>
  );
}
