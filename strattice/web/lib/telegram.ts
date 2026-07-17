// Telegram alerts via the Bot API - one fetch, no SDK. The platform runs a single bot
// (TELEGRAM_BOT_TOKEN, from @BotFather); each user stores the numeric chat id they get from
// @userinfobot and starts a chat with that bot so it's allowed to message them.
//
// Never throws from the fire-and-forget helper: an alert failure must not break trading or
// the notify webhook. `sendTelegram` returns a result so interactive callers (the "send test"
// action) can tell the user whether it actually landed.
import "server-only";

const API = "https://api.telegram.org";

export function telegramConfigured(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN;
}

export type TelegramResult =
  | { ok: true }
  | {
      ok: false;
      reason: "unconfigured" | "no_chat" | "send_failed";
      detail?: string;
    };

/** Send one Markdown message to a chat. Reports the outcome; does not throw. */
export async function sendTelegram(
  chatId: string | null | undefined,
  text: string,
): Promise<TelegramResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, reason: "unconfigured" };
  if (!chatId) return { ok: false, reason: "no_chat" };
  try {
    const r = await fetch(`${API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text.slice(0, 4096),
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
      cache: "no-store",
    });
    if (r.ok) return { ok: true };
    const detail = await r.text().catch(() => "");
    console.error(`[telegram] send -> ${r.status} ${detail}`);
    return { ok: false, reason: "send_failed", detail };
  } catch (e) {
    console.error("[telegram] send failed:", (e as Error).message);
    return { ok: false, reason: "send_failed", detail: (e as Error).message };
  }
}

// Escape the characters Telegram's legacy Markdown treats as formatting, so a value like a
// market id (I-BTC_INR) or strategy name (tsmom_0) renders literally, not as italics/code.
function mdEscape(s: string): string {
  return String(s).replace(/([\\_*`[])/g, "\\$1");
}

/** A simple, bullet-pointed alert: a bold title over one "• key: value" line per row.
 *  Replaces the old monospaced table() - easier to scan on a phone. */
export function bullets(title: string, rows: [string, string][]): string {
  const body = rows
    .map(([k, v]) => `• ${mdEscape(k)}: ${mdEscape(v)}`)
    .join("\n");
  return `*${mdEscape(title)}*\n${body}`;
}

const money = (n: number) =>
  `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** Format + send a trade fill. Best-effort; returns the result for logging. */
export function sendTradeTelegram(
  chatId: string,
  t: {
    side: string;
    market: string;
    qty: number;
    price: number;
    notional: number;
    strategy?: string;
    dryRun?: boolean;
  },
): Promise<TelegramResult> {
  const buy = t.side.toLowerCase() === "buy";
  const title = `${buy ? "BUY" : "SELL"} ${t.market}${t.dryRun ? " (dry run)" : ""}`;
  const rows: [string, string][] = [
    ["Quantity", String(t.qty)],
    ["Price", money(t.price)],
    ["Notional", money(t.notional)],
  ];
  if (t.strategy) rows.push(["Strategy", t.strategy]);
  return sendTelegram(chatId, bullets(title, rows));
}
