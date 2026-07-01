import { redirect } from "next/navigation";
import { getUser } from "@/lib/session";
import * as q from "@/lib/queries";
import { BotControls } from "@/components/BotControls";
import { CredentialsForm } from "@/components/CredentialsForm";

export const dynamic = "force-dynamic";

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
          <li><span className="text-warn">Disable withdrawals</span> - we never need them.</li>
          <li>Add our server IP to the key's IP-allowlist. Keys are encrypted at rest.</li>
        </ol>

        <CredentialsForm linked={creds.linked} />
      </section>

      <BotControls initial={{ active: !!bot.active, live: !!bot.live }} linked={creds.linked} />
    </div>
  );
}
