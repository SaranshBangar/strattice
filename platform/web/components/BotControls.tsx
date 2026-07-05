"use client";
import { useState, useTransition } from "react";
import { setBotAction, goLiveAction } from "@/app/actions";
import { useToast } from "@/components/Toast";
import { GO_LIVE_PHRASE, GUARDRAILS } from "@/lib/risk";

export function BotControls({
  initial,
  linked = true,
  enabledStrategies = 0,
}: {
  initial: { active: boolean; live: boolean };
  linked?: boolean;
  enabledStrategies?: number;
}) {
  const [active, setActive] = useState(initial.active);
  const [live, setLive] = useState(initial.live);
  const [confirming, setConfirming] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [pending, start] = useTransition();
  const toast = useToast();

  function update(patch: { active?: boolean; live?: boolean }) {
    // Optimistic; revert to the prior values if the server rejects. Only used for
    // the bot on/off switch and for turning live OFF — never for arming live.
    const prev = { active, live };
    if (patch.active !== undefined) setActive(patch.active);
    if (patch.live !== undefined) setLive(patch.live);
    start(async () => {
      try {
        await setBotAction(patch);
        toast(
          patch.active !== undefined
            ? patch.active ? "Bot turned on" : "Bot turned off"
            : "Switched to dry run",
          "success",
        );
      } catch (e) {
        setActive(prev.active);
        setLive(prev.live);
        toast(e instanceof Error && e.message ? e.message : "Couldn't update bot settings. Please try again.", "error");
      }
    });
  }

  // Arming live is never optimistic: the UI only shows LIVE after the server confirms.
  function confirmGoLive() {
    start(async () => {
      try {
        await goLiveAction(phrase);
        setLive(true);
        setConfirming(false);
        setPhrase("");
        toast("Live trading enabled", "success");
      } catch (e) {
        toast(e instanceof Error && e.message ? e.message : "Couldn't enable live trading.", "error");
      }
    });
  }

  const canGoLive = linked && enabledStrategies > 0;

  return (
    <div className="rounded-lg border border-line bg-panel p-5">
      <h2 className="font-display text-sm font-semibold tracking-tight text-dim">Bot controls</h2>

      {!linked && (
        <p className="mt-3 rounded-md border border-line bg-inset px-3 py-2 text-sm text-muted">
          Link your CoinDCX API keys above to enable the bot.
        </p>
      )}

      <div className="mt-4 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-fg">Bot active</div>
            <div className="text-sm text-muted">Run subscribed strategies on a schedule.</div>
          </div>
          <Toggle
            checked={active}
            disabled={pending || !linked}
            onClick={() => update({ active: !active })}
            label="Toggle bot active"
            accent="gain"
          />
        </div>

        <div className="border-t border-line pt-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-fg">
                Live trading
                <span
                  className={[
                    "rounded-sm px-1.5 py-0.5 font-mono text-[11px] font-semibold tracking-wide",
                    live ? "bg-warn/15 text-warn" : "bg-inset text-muted",
                  ].join(" ")}
                >
                  {live ? "LIVE" : "DRY_RUN"}
                </span>
              </div>
              <div className="text-sm text-muted">
                {live ? "Placing real orders on your account." : "Simulated - no real orders are sent."}
              </div>
            </div>
            <Toggle
              checked={live}
              disabled={pending || !linked || (!live && confirming)}
              onClick={() => {
                if (live) { update({ live: false }); setConfirming(false); }
                else setConfirming(true);
              }}
              label="Toggle live trading"
              accent="warn"
            />
          </div>

          {/* Going live is a real-money decision: show exactly what changes and what
              protects the account, and require the phrase — same double-lock idea the
              engine itself uses (DRY_RUN=false + LIVE_TRADING_CONFIRM). */}
          {!live && confirming && (
            <div className="mt-3 space-y-3 rounded-md border border-warn/30 bg-warn/5 p-4">
              <p className="text-sm text-fg">
                <span className="font-semibold text-warn">You are about to trade real money.</span>{" "}
                Bots will place real buy/sell orders against your CoinDCX balance from the next poll.
                Simulated results never guarantee live ones.
              </p>
              <ul className="space-y-1.5">
                {GUARDRAILS.map(([k, v]) => (
                  <li key={k} className="flex gap-2 text-xs leading-relaxed text-muted">
                    <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 bg-warn/70" />
                    <span><span className="font-medium text-dim">{k}.</span> {v}</span>
                  </li>
                ))}
              </ul>
              {!canGoLive && (
                <p className="rounded-md border border-line bg-inset px-3 py-2 text-xs text-muted">
                  {linked
                    ? "Enable at least one strategy before going live — there is nothing to run yet."
                    : "Link your CoinDCX API keys before going live."}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="go-live-phrase" className="sr-only">
                  Type {GO_LIVE_PHRASE} to confirm
                </label>
                <input
                  id="go-live-phrase"
                  type="text"
                  value={phrase}
                  onChange={(e) => setPhrase(e.target.value)}
                  placeholder={`type ${GO_LIVE_PHRASE} to confirm`}
                  autoComplete="off"
                  spellCheck={false}
                  className="w-48 rounded-md border border-line bg-inset px-3 py-1.5 font-mono text-sm text-fg placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-warn"
                />
                <button
                  type="button"
                  disabled={pending || !canGoLive || phrase.trim().toUpperCase() !== GO_LIVE_PHRASE}
                  onClick={confirmGoLive}
                  className="rounded-md bg-warn px-3 py-1.5 text-sm font-semibold text-bg transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warn"
                >
                  Enable live trading
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => { setConfirming(false); setPhrase(""); }}
                  className="rounded-md border border-line px-3 py-1.5 text-sm text-muted transition-colors hover:bg-inset hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  Stay in DRY_RUN
                </button>
              </div>
            </div>
          )}

          {live && (
            <p
              role="alert"
              className="mt-3 rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-warn"
            >
              <span className="font-semibold">Live mode is on.</span> Bots will place real buy/sell
              orders using your CoinDCX balance. Turning live off is instant and never asks questions.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Toggle({
  checked,
  disabled,
  onClick,
  label,
  accent,
}: {
  checked: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
  accent: "gain" | "warn";
}) {
  const on = accent === "warn" ? "bg-warn" : "bg-gain";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={[
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-panel",
        checked ? on : "bg-line",
        accent === "warn" ? "focus-visible:ring-warn" : "focus-visible:ring-gain",
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
