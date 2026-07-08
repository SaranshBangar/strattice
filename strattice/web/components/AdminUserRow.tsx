"use client";
// One editable row in the admin user table. Tier changes and the bot kill-switch
// call server actions that re-verify admin server-side.
import { useState, useTransition } from "react";
import { Select } from "@/components/Select";
import { adminSetTierAction, adminDisableBotAction } from "@/app/actions";
import { useToast } from "@/components/Toast";
import type { AdminUser } from "@/lib/queries";

const TIER_OPTS = ["free", "starter", "plus", "pro", "max"].map((t) => ({
  value: t,
  label: t,
}));

function joined(v: number | null): string {
  if (!v) return "-";
  const ms = v > 1e12 ? v : v * 1000; // tolerate seconds or millis
  return new Date(ms).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
  });
}
function daysLeft(periodEnd: number | null): string {
  if (!periodEnd) return "";
  const d = Math.ceil((periodEnd * 1000 - Date.now()) / 86400000);
  return d > 0 ? `${d}d left` : "expired";
}

export function AdminUserRow({ u }: { u: AdminUser }) {
  const [pending, start] = useTransition();
  const [tier, setTier] = useState(u.tier);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();

  function apply(next: string) {
    const prev = tier;
    setErr(null);
    setTier(next);
    start(async () => {
      try {
        await adminSetTierAction(u.id, next);
        toast(`${u.email} set to ${next}`, "success");
      } catch (e: any) {
        setErr(e?.message ?? "failed");
        setTier(prev);
        toast(e?.message ?? "Couldn't update plan", "error");
      }
    });
  }
  function stopBot() {
    setErr(null);
    start(async () => {
      try {
        await adminDisableBotAction(u.id);
        toast(`Stopped ${u.email}'s bot`, "success");
      } catch (e: any) {
        setErr(e?.message ?? "failed");
        toast(e?.message ?? "Couldn't stop bot", "error");
      }
    });
  }

  const paid = tier !== "free";

  return (
    <tr className="align-middle odd:bg-white/[0.015] hover:bg-inset/40">
      <td className="px-4 py-2.5">
        <div className="font-mono text-sm text-fg">{u.email}</div>
        {u.name && <div className="text-xs text-muted">{u.name}</div>}
        {err && <div className="mt-0.5 text-xs text-loss">{err}</div>}
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-muted">
        {joined(u.created_at)}
      </td>
      <td className="px-4 py-2.5">
        <span className={u.linked ? "text-xs text-gain" : "text-xs text-faint"}>
          {u.linked ? "Linked" : "-"}
        </span>
      </td>
      <td className="whitespace-nowrap px-4 py-2.5">
        {(() => {
          // A bot that claims to be on but hasn't heartbeat in 2 minutes is stalled -
          // the row an admin actually needs to notice.
          const stalled =
            !!u.bot_active &&
            (!u.last_heartbeat || Date.now() / 1000 - u.last_heartbeat > 120);
          return (
            <div className="flex items-center gap-1.5">
              <span
                className={[
                  "h-1.5 w-1.5 rounded-[1px]",
                  u.bot_active ? (stalled ? "bg-warn" : "bg-gain") : "bg-faint",
                ].join(" ")}
              />
              <span
                className={["text-xs", stalled ? "text-warn" : "text-dim"].join(
                  " ",
                )}
              >
                {u.bot_active ? (stalled ? "Stalled" : "On") : "Off"}
              </span>
              {u.bot_active ? (
                <span
                  className={[
                    "ml-1 rounded-sm px-1 py-0.5 font-mono text-[9px] font-semibold",
                    u.bot_live ? "bg-warn/15 text-warn" : "bg-inset text-muted",
                  ].join(" ")}
                >
                  {u.bot_live ? "LIVE" : "DRY"}
                </span>
              ) : null}
            </div>
          );
        })()}
      </td>
      <td className="px-4 py-2.5 text-right font-mono tnum text-xs text-dim">
        {u.trades}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Select
            size="sm"
            ariaLabel={`Plan for ${u.email}`}
            value={tier}
            onChange={apply}
            options={TIER_OPTS}
            className="w-24"
          />
          {paid && (
            <span className="whitespace-nowrap font-mono text-[10px] text-faint">
              {daysLeft(u.period_end)}
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-2.5 text-right">
        <button
          type="button"
          onClick={stopBot}
          disabled={pending || !u.bot_active}
          className="rounded-md bg-white/5 px-2.5 py-1 text-xs font-medium text-dim transition-colors hover:bg-loss/10 hover:text-loss focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-loss disabled:cursor-not-allowed disabled:opacity-40"
          title={u.bot_active ? "Force this user's bot off" : "Bot already off"}
        >
          Stop bot
        </button>
      </td>
    </tr>
  );
}
