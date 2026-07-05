// Native email service - no third-party deps. Speaks SMTP directly over node:tls
// (implicit TLS on 465, or STARTTLS on 587/25). Runs on the Node.js runtime only.
//
// Config (.env): SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM,
//   SMTP_FROM_NAME (optional). If unset, sends are skipped (safe in dev).
import "server-only";
import net from "node:net";
import tls from "node:tls";
import { randomUUID } from "node:crypto";

const BRAND = "Strattice";
const GOLD = "#C9A24B";

export function appUrl() {
  return process.env.BETTER_AUTH_URL || "http://localhost:3000";
}

// ---------- SMTP transport ----------
type Reply = { code: number; text: string };

/** Reader for a lockstep SMTP dialogue. Handles multi-line replies (`250-...\r\n250 ...`). */
function makeReader(sock: net.Socket) {
  let buf = "";
  let pending: {
    resolve: (r: Reply) => void;
    reject: (e: Error) => void;
  } | null = null;
  const deliver = () => {
    if (!pending) return;
    const m = buf.match(/^(?:\d{3}-[^\r\n]*\r?\n)*(\d{3}) [^\r\n]*\r?\n/);
    if (!m) return;
    const code = parseInt(m[1], 10);
    buf = buf.slice(m[0].length);
    const p = pending;
    pending = null;
    p.resolve({ code, text: m[0] });
  };
  sock.on("data", (d) => {
    buf += d.toString("utf8");
    deliver();
  });
  sock.on("error", (e) => pending?.reject(e));
  sock.on("close", () => pending?.reject(new Error("SMTP connection closed")));
  return () =>
    new Promise<Reply>((resolve, reject) => {
      pending = { resolve, reject };
      deliver();
    });
}

function connectTls(opts: tls.ConnectionOptions): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const s = tls.connect(opts, () => resolve(s));
    s.once("error", reject);
  });
}

async function cmd(
  sock: net.Socket,
  read: () => Promise<Reply>,
  line: string,
  ok: number[],
) {
  sock.write(line + "\r\n");
  const r = await read();
  if (!ok.includes(r.code))
    throw new Error(`SMTP "${line.split(" ")[0]}" -> ${r.text.trim()}`);
  return r;
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

/** Send one HTML email. Throws on protocol failure; callers wrap in try/catch. */
async function smtpSend(to: string, subject: string, html: string) {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const fromAddr = process.env.SMTP_FROM || user;
  if (!host || !user || !pass || !fromAddr) {
    console.warn(`[email] SMTP not configured; skipping "${subject}" -> ${to}`);
    return;
  }
  const fromName = process.env.SMTP_FROM_NAME || BRAND;
  const domain = fromAddr.split("@")[1] || "localhost";
  const ehlo = `EHLO ${domain}`;

  let sock: net.Socket;
  if (port === 465) {
    sock = await connectTls({ host, port, servername: host });
  } else {
    // Plain connect, greet, then upgrade with STARTTLS.
    const plain = await new Promise<net.Socket>((resolve, reject) => {
      const s = net.connect({ host, port }, () => resolve(s));
      s.once("error", reject);
    });
    const readP = makeReader(plain);
    await readP(); // greeting
    await cmd(plain, readP, ehlo, [250]);
    await cmd(plain, readP, "STARTTLS", [220]);
    sock = await connectTls({ socket: plain, servername: host });
  }

  const read = makeReader(sock);
  if (port === 465) await read(); // greeting on implicit-TLS socket
  await cmd(sock, read, ehlo, [250]);
  await cmd(sock, read, "AUTH LOGIN", [334]);
  await cmd(sock, read, b64(user), [334]);
  await cmd(sock, read, b64(pass), [235]);
  await cmd(sock, read, `MAIL FROM:<${fromAddr}>`, [250]);
  await cmd(sock, read, `RCPT TO:<${to}>`, [250, 251]);
  await cmd(sock, read, "DATA", [354]);

  const headers = [
    `From: ${fromName} <${fromAddr}>`,
    `To: <${to.replace(/[\r\n]/g, "")}>`,
    `Subject: ${subject.replace(/[\r\n]/g, " ")}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
  ].join("\r\n");
  const body = html.replace(/\r?\n/g, "\r\n").replace(/\r\n\./g, "\r\n.."); // CRLF + dot-stuff
  sock.write(headers + "\r\n\r\n" + body + "\r\n.\r\n");
  const done = await read();
  if (done.code !== 250)
    throw new Error(`SMTP body rejected -> ${done.text.trim()}`);
  await cmd(sock, read, "QUIT", [221]).catch(() => {});
  sock.end();
}

/** Fire-and-forget wrapper: an email failure never breaks the caller's flow. */
async function send(to: string, subject: string, html: string) {
  try {
    await smtpSend(to, subject, html);
  } catch (e) {
    console.error(
      `[email] failed "${subject}" -> ${to}:`,
      (e as Error).message,
    );
  }
}

// ---------- template ----------
type Row = [string, string];

// All layout inputs are plain text (some user-controlled: name, key label,
// custom strategy name) - escape them so nothing injects HTML into emails.
const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function layout(opts: {
  heading: string;
  lead: string;
  rows?: Row[];
  cta?: { label: string; href: string };
  note?: string;
}) {
  const rows = (opts.rows ?? [])
    .map(
      ([k, v]) => `<tr>
        <td style="padding:6px 0;color:#828AA0;font-size:13px;">${esc(k)}</td>
        <td style="padding:6px 0;color:#E6E9F0;font-size:13px;text-align:right;font-weight:600;">${esc(v)}</td>
      </tr>`,
    )
    .join("");
  const rowsBlock = rows
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
         style="margin:20px 0;border-top:1px solid #232838;border-bottom:1px solid #232838;">${rows}</table>`
    : "";
  const cta = opts.cta
    ? `<a href="${opts.cta.href}"
         style="display:inline-block;margin-top:8px;padding:11px 22px;background:${GOLD};
         color:#0B0D12;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;">${esc(opts.cta.label)}</a>`
    : "";
  const note = opts.note
    ? `<p style="margin:20px 0 0;color:#5A6379;font-size:12px;line-height:1.6;">${esc(opts.note)}</p>`
    : "";

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#0B0D12;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0B0D12;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0"
        style="max-width:480px;width:100%;background:#131722;border:1px solid #232838;border-radius:14px;
        font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <tr><td style="padding:28px 32px 8px;">
          <img src="${appUrl()}/favicon-180.png" width="34" height="34" alt="${BRAND} logo"
            style="display:block;width:34px;height:34px;border-radius:8px;">
          <div style="margin-top:12px;font-size:19px;font-weight:600;letter-spacing:-0.5px;color:#E6E9F0;">
            stra<span style="color:${GOLD};">tt</span>ice
          </div>
        </td></tr>
        <tr><td style="padding:8px 32px 28px;">
          <h1 style="margin:12px 0 6px;font-size:18px;font-weight:600;color:#E6E9F0;">${esc(opts.heading)}</h1>
          <p style="margin:0;color:#AEB6C8;font-size:14px;line-height:1.6;">${esc(opts.lead)}</p>
          ${rowsBlock}
          ${cta}
          ${note}
        </td></tr>
        <tr><td style="padding:18px 32px;border-top:1px solid #232838;">
          <p style="margin:0;color:#5A6379;font-size:11px;line-height:1.6;">
            ${BRAND} · automated crypto strategies on CoinDCX.<br>
            You get this because you have a ${BRAND} account.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

const money = (n: number) =>
  `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const first = (name?: string | null) => (name ? name.split(" ")[0] : "there");

// ---------- typed senders ----------
export function sendSignUpEmail(to: string, name?: string | null) {
  return send(
    to,
    `Welcome to ${BRAND}`,
    layout({
      heading: `Welcome, ${first(name)}.`,
      lead: `Your ${BRAND} account is ready. Link your CoinDCX API keys and pick a strategy to get the bot running.`,
      cta: { label: "Open dashboard", href: `${appUrl()}/dashboard` },
    }),
  );
}

export function sendSignInEmail(to: string, name?: string | null) {
  return send(
    to,
    `New sign-in to ${BRAND}`,
    layout({
      heading: "New sign-in",
      lead: `Hi ${first(name)}, your ${BRAND} account was just signed in.`,
      rows: [["Time", new Date().toUTCString()]],
      note: `If this wasn't you, change your password and remove your CoinDCX keys immediately.`,
    }),
  );
}

export function sendApiKeyEmail(to: string, label: string) {
  return send(
    to,
    `CoinDCX keys linked`,
    layout({
      heading: "API keys linked",
      lead: `New CoinDCX API keys were added to your ${BRAND} account. They're encrypted at rest and used only to run your strategies.`,
      rows: [["Label", label]],
      cta: { label: "Review account", href: `${appUrl()}/account` },
      note: `If you didn't do this, remove the keys and revoke them in CoinDCX.`,
    }),
  );
}

type BillingKind = "active" | "failed" | "cancelled" | "expired";
export function sendBillingEmail(to: string, kind: BillingKind, tier?: string) {
  const copy: Record<
    BillingKind,
    { subject: string; heading: string; lead: string }
  > = {
    active: {
      subject: "Subscription active",
      heading: "You're subscribed",
      lead: `Payment received. Your ${tier ?? ""} plan is active.`,
    },
    failed: {
      subject: "Payment failed",
      heading: "Payment failed",
      lead: `We couldn't collect your subscription payment. Access continues until the current period ends.`,
    },
    cancelled: {
      subject: "Subscription cancelled",
      heading: "Subscription cancelled",
      lead: `Your plan is cancelled. You keep access until the end of the current billing period.`,
    },
    expired: {
      subject: "Subscription expired",
      heading: "Subscription expired",
      lead: `Your subscription has ended and your account is back on the free plan.`,
    },
  };
  const c = copy[kind];
  return send(
    to,
    c.subject,
    layout({
      heading: c.heading,
      lead: c.lead,
      rows: tier ? [["Plan", tier]] : undefined,
      cta: { label: "Manage billing", href: `${appUrl()}/billing` },
    }),
  );
}

export function sendTradeEmail(
  to: string,
  t: {
    side: string;
    market: string;
    qty: number;
    price: number;
    notional: number;
    strategy?: string;
    dryRun?: boolean;
  },
) {
  const buy = t.side.toLowerCase() === "buy";
  const tag = t.dryRun ? " (dry run)" : "";
  return send(
    to,
    `${buy ? "Buy" : "Sell"} ${t.market}${tag}`,
    layout({
      heading: `${buy ? "Bought" : "Sold"} ${t.market}`,
      lead: `Your bot placed a ${buy ? "buy" : "sell"} order${t.dryRun ? " in dry-run mode" : ""}.`,
      rows: [
        ["Side", t.side.toUpperCase()],
        ["Market", t.market],
        ["Quantity", String(t.qty)],
        ["Price", money(t.price)],
        ["Notional", money(t.notional)],
        ...(t.strategy ? ([["Strategy", t.strategy]] as Row[]) : []),
      ],
      cta: { label: "View dashboard", href: `${appUrl()}/dashboard` },
    }),
  );
}
