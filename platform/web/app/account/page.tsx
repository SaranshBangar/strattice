import { redirect } from "next/navigation";
import { getUser } from "@/lib/session";
import * as q from "@/lib/queries";
import { saveCredentialsAction } from "@/app/actions";
import { BotControls } from "@/components/BotControls";

export const dynamic = "force-dynamic";

const inputClass =
  "w-full rounded-md border border-line bg-inset px-3 py-2 text-sm text-fg placeholder-faint focus:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const labelClass = "block text-sm font-medium text-dim";

export default async function AccountPage() {
  const user = await getUser();
  if (!user) redirect("/sign-in");

  const [creds, bot] = await Promise.all([q.credentialsLinked(user.id), q.getBotState(user.id)]);

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Account</h1>

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

        <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm text-muted marker:text-faint">
          <li><span className="text-gain">Enable trading</span> on the key.</li>
          <li><span className="text-warn">Disable withdrawals</span> — we never need them.</li>
          <li>Add our server IP to the key's IP-allowlist. Keys are encrypted at rest.</li>
        </ol>

        <form action={saveCredentialsAction} className="mt-4 max-w-md space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="ak-label" className={labelClass}>Label</label>
            <input id="ak-label" name="label" placeholder="My CoinDCX key" className={inputClass} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="ak-key" className={labelClass}>API key</label>
            <input id="ak-key" name="apiKey" required autoComplete="off" className={`${inputClass} font-mono`} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="ak-secret" className={labelClass}>API secret</label>
            <input id="ak-secret" name="secret" required type="password" autoComplete="off" placeholder="••••••••••••••••" className={`${inputClass} font-mono`} />
            <p className="text-xs text-muted">Stored encrypted. We never display your secret back to you.</p>
          </div>
          <button className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            {creds.linked ? "Replace keys" : "Link account"}
          </button>
        </form>
      </section>

      <BotControls initial={{ active: !!bot.active, live: !!bot.live }} linked={creds.linked} />
    </div>
  );
}
