"use client";
import { useState, useTransition } from "react";
import {
  setEmailNotificationsAction,
  saveTelegramNotificationsAction,
  removeTelegramNotificationsAction,
} from "@/app/actions";
import { useToast } from "@/components/Toast";
import { Spinner } from "@/components/Spinner";

export interface NotificationInitial {
  emailEnabled: boolean;
  telegramEnabled: boolean;
  telegramChatId: string;
  telegramConfigured: boolean;
}

const inputClass =
  "w-full rounded-md bg-inset px-3 py-2 text-sm text-fg placeholder-faint focus:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export function NotificationSettings({
  initial,
  email,
}: {
  initial: NotificationInitial;
  email: string;
}) {
  const toast = useToast();
  const [emailOn, setEmailOn] = useState(initial.emailEnabled);
  const [tgOn, setTgOn] = useState(initial.telegramEnabled);
  const [chatId, setChatId] = useState(initial.telegramChatId);
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();

  function toggleEmail() {
    const next = !emailOn;
    setEmailOn(next);
    start(async () => {
      try {
        await setEmailNotificationsAction(next);
        toast(next ? "Email alerts on" : "Email alerts off", "success");
      } catch {
        setEmailOn(!next);
        toast("Couldn't update email alerts. Please try again.", "error");
      }
    });
  }

  function connectTelegram() {
    const id = draft.trim();
    if (!id) return;
    start(async () => {
      try {
        const res = await saveTelegramNotificationsAction(id);
        setChatId(id);
        setTgOn(true);
        setDraft("");
        if (res.test === "sent")
          toast("Telegram connected - check for our test message", "success");
        else if (res.test === "unconfigured")
          toast("Telegram alerts saved (test message skipped)", "success");
        else
          toast(
            "Saved, but the test message failed. Have you messaged the bot first?",
            "info",
          );
      } catch (err: any) {
        toast(
          err?.message ?? "Couldn't save Telegram. Please try again.",
          "error",
        );
      }
    });
  }

  function removeTelegram() {
    start(async () => {
      try {
        await removeTelegramNotificationsAction();
        setTgOn(false);
        setChatId("");
        toast("Telegram alerts removed", "success");
      } catch {
        toast("Couldn't remove Telegram. Please try again.", "error");
      }
    });
  }

  return (
    <section className="card p-5" data-tour="notifications">
      <h2 className="font-display text-sm font-semibold tracking-tight text-dim">
        Notifications
      </h2>
      <p className="mt-1 text-sm text-muted">
        Get a message every time a strategy places a buy or sell.
      </p>

      <div className="mt-4 space-y-4">
        {/* Email */}
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-medium text-fg">Email alerts</div>
            <div className="truncate text-sm text-muted">
              Sent to <span className="font-mono text-dim">{email}</span>
            </div>
          </div>
          <Toggle
            checked={emailOn}
            disabled={pending}
            onClick={toggleEmail}
            label="Toggle email alerts"
          />
        </div>

        {/* Telegram */}
        <div className="pt-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-fg">
                Telegram alerts
                <span
                  className={[
                    "rounded-sm px-1.5 py-0.5 font-mono text-[11px] font-semibold tracking-wide",
                    tgOn ? "bg-gain/15 text-gain" : "bg-inset text-muted",
                  ].join(" ")}
                >
                  {tgOn ? "CONNECTED" : "OFF"}
                </span>
              </div>
              <div className="text-sm text-muted">
                Instant push to your phone, no inbox needed.
              </div>
            </div>
          </div>

          {tgOn ? (
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md bg-inset px-3 py-2.5">
              <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-faint">
                chat_id
              </span>
              <span className="font-mono text-sm text-dim">{chatId}</span>
              <button
                type="button"
                onClick={removeTelegram}
                disabled={pending}
                className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-white/5 px-2.5 py-1.5 text-xs text-dim transition-colors hover:bg-loss/10 hover:text-loss focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
              >
                {pending && <Spinner className="h-3.5 w-3.5" />}
                Remove
              </button>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <ol className="space-y-1.5 text-xs text-muted">
                <li>
                  1. Open Telegram and message{" "}
                  <a
                    href="https://t.me/userinfobot"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-accent hover:text-accent-hi"
                  >
                    @userinfobot
                  </a>{" "}
                  to get your numeric chat id.
                </li>
                <li>
                  2. Say hi to our alerts bot so it&apos;s allowed to message
                  you, then paste the id below.
                </li>
              </ol>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && connectTelegram()}
                  inputMode="numeric"
                  placeholder="123456789"
                  aria-label="Telegram chat id"
                  className={`${inputClass} max-w-[200px] font-mono`}
                />
                <button
                  type="button"
                  onClick={connectTelegram}
                  disabled={pending || !draft.trim()}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
                >
                  {pending && <Spinner className="h-4 w-4" />}
                  Connect
                </button>
              </div>
              {!initial.telegramConfigured && (
                <p className="text-xs text-faint">
                  Telegram delivery isn&apos;t configured on the server yet -
                  you can still save your id.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Toggle({
  checked,
  disabled,
  onClick,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={[
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gain focus-visible:ring-offset-2 focus-visible:ring-offset-panel",
        checked ? "bg-gain" : "bg-line",
        disabled ? "cursor-not-allowed opacity-50" : "",
      ].join(" ")}
    >
      <span
        className={[
          "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-5" : "translate-x-0.5",
        ].join(" ")}
      />
    </button>
  );
}
