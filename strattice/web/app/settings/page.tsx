import { redirect } from "next/navigation";
import { getUser } from "@/lib/session";
import * as q from "@/lib/queries";
import { telegramConfigured } from "@/lib/telegram";
import { NotificationSettings } from "@/components/NotificationSettings";
import { CurrencySettings } from "@/components/CurrencySettings";
import { TradingPermissions } from "@/components/TradingPermissions";
import { AccountActions } from "@/components/AccountActions";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getUser();
  if (!user) redirect("/sign-in");

  const [prefs, currency, allowShorting] = await Promise.all([
    q.getNotificationPrefs(user.id),
    q.getCurrency(user.id),
    q.getAllowShorting(user.id),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Settings
        </h1>
        <p className="mt-0.5 font-mono text-[11px] text-faint">{user.email}</p>
      </div>

      <div className="max-w-2xl space-y-6">
        <NotificationSettings
          email={user.email}
          initial={{
            emailEnabled: !!prefs.email_enabled,
            telegramEnabled: !!prefs.telegram_enabled,
            telegramChatId: prefs.telegram_chat_id ?? "",
            telegramConfigured: telegramConfigured(),
          }}
        />

        <CurrencySettings initial={currency} />

        {/* The dashboard timeline picker moved to the dashboard itself, next to the
            stat cards it controls. */}
        <TradingPermissions initial={allowShorting} />

        <AccountActions />
      </div>
    </div>
  );
}
