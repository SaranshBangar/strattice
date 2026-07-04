import { redirect } from "next/navigation";
import { getUser } from "@/lib/session";
import * as q from "@/lib/queries";
import { BotControls } from "@/components/BotControls";
import { CredentialsForm } from "@/components/CredentialsForm";

export const dynamic = "force-dynamic";

// What happens to a key after it's submitted - shown beside the form so the
// answer is on screen at the exact moment someone is deciding whether to paste it.
const KEY_FACTS: [string, string][] = [
  ["storage", "Encrypted at rest. The plaintext secret exists only long enough to encrypt it."],
  ["display", "Never shown back - not to you, not to us, not in any admin view."],
  ["scope", "Trading and balance reads only. With withdrawals disabled, funds physically can't leave your account through this key."],
  ["revocation", "Delete the key on CoinDCX at any time and the bot goes blind instantly."],
];

export default async function AccountPage() {
  const user = await getUser();
  if (!user) redirect("/sign-in");

  const [creds, bot] = await Promise.all([q.credentialsLinked(user.id), q.getBotState(user.id)]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Account</h1>
        <p className="mt-0.5 font-mono text-[11px] text-faint">{user.email}</p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-6">
          <section className="rounded-lg border border-line bg-panel p-5">
            <h2 className="font-display text-sm font-semibold tracking-tight text-dim">CoinDCX API keys</h2>

            {creds.linked && (
              <p className="mt-3 flex items-center gap-2 rounded-md border border-gain/30 bg-gain/10 px-3 py-2 text-sm text-gain">
                <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0l-3.5-3.5a1 1 0 1 1 1.4-1.4l2.8 2.79 6.8-6.79a1 1 0 0 1 1.4 0Z" clipRule="evenodd" />
                </svg>
                Linked ({creds.label}). Submit again to replace.
              </p>
            )}

            <ol className="mt-4 space-y-2.5">
              {([
                ["Create an API key on CoinDCX", "Account → API dashboard → create a new key."],
                ["Enable trading, disable withdrawals", "The bot needs the first and must never have the second."],
                ["Add our server IP to the key's allowlist", "So the key only works from the machine that runs your bots."],
              ] as const).map(([title, hint], i) => (
                <li key={title} className="flex gap-3">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-line font-mono text-[10px] text-faint">
                    {i + 1}
                  </span>
                  <div>
                    <div className="text-sm text-fg">{title}</div>
                    <div className="text-xs text-muted">{hint}</div>
                  </div>
                </li>
              ))}
            </ol>

            <CredentialsForm linked={creds.linked} />
          </section>

          <BotControls initial={{ active: !!bot.active, live: !!bot.live }} linked={creds.linked} />
        </div>

        <aside className="overflow-hidden rounded-lg border border-line bg-panel">
          <div className="border-b border-line px-4 py-2.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-faint">
              what_happens_to_your_key
            </span>
          </div>
          <dl className="divide-y divide-line/70">
            {KEY_FACTS.map(([k, v]) => (
              <div key={k} className="px-4 py-3">
                <dt className="font-mono text-[10px] uppercase tracking-[0.15em] text-faint">{k}</dt>
                <dd className="mt-1 text-xs leading-relaxed text-dim">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="border-t border-line px-4 py-2.5 font-mono text-[11px] leading-relaxed text-faint">
            turning the bot off stops new entries at the next poll; open positions are still
            managed to their exit.
          </p>
        </aside>
      </div>
    </div>
  );
}
