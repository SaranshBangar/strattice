"use client";
import { useState, useTransition } from "react";
import { setBotAction } from "@/app/actions";

export function BotControls({
  initial,
  linked = true,
}: {
  initial: { active: boolean; live: boolean };
  linked?: boolean;
}) {
  const [active, setActive] = useState(initial.active);
  const [live, setLive] = useState(initial.live);
  const [pending, start] = useTransition();

  function update(patch: { active?: boolean; live?: boolean }) {
    if (patch.active !== undefined) setActive(patch.active);
    if (patch.live !== undefined) setLive(patch.live);
    start(() => setBotAction(patch));
  }

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
                {live ? "Placing real orders on your account." : "Simulated — no real orders are sent."}
              </div>
            </div>
            <Toggle
              checked={live}
              disabled={pending || !linked}
              onClick={() => update({ live: !live })}
              label="Toggle live trading"
              accent="warn"
            />
          </div>

          {live && (
            <p
              role="alert"
              className="mt-3 rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-warn"
            >
              <span className="font-semibold">Live mode is on.</span> Bots will place real buy/sell
              orders using your CoinDCX balance. Start in DRY_RUN and review trades first.
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
