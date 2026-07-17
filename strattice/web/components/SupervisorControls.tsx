"use client";
// Admin-only start / stop / restart controls for the shared supervisor process, plus its
// live status. The app talks to the supervisor only through D1, so these write the desired
// regime and it acts on the next poll; "Stop" pauses (stops every engine but keeps the loop
// polling) rather than killing the OS process, so "Start" can resume it. Every action
// re-verifies admin server-side.
import { useTransition } from "react";
import {
  adminStartSupervisorAction,
  adminStopSupervisorAction,
  adminRestartSupervisorAction,
} from "@/app/actions";
import { useToast } from "@/components/Toast";
import type { SupervisorStatus } from "@/lib/queries";

// No recent heartbeat within this window => treat the supervisor as offline/unreachable.
// The supervisor writes a status every poll (SUPERVISOR_POLL, 30s default), so ~3 missed
// polls is a confident "it's not running".
const STALE_AFTER_S = 90;

function agoLabel(unixSeconds: number | null): string {
  if (!unixSeconds) return "never";
  const s = Math.max(0, Math.floor(Date.now() / 1000 - unixSeconds));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function SupervisorControls({ status }: { status: SupervisorStatus }) {
  const [pending, start] = useTransition();
  const toast = useToast();

  const online =
    status.last_heartbeat != null &&
    Date.now() / 1000 - status.last_heartbeat < STALE_AFTER_S;
  // Observed regime once online; before the first heartbeat we fall back to the desired one.
  const observed = online ? (status.state ?? "running") : "offline";
  const paused = observed === "paused" || status.desired_state === "paused";

  const view: { dot: string; text: string; label: string } = !online
    ? {
        dot: "bg-loss",
        text: "text-loss",
        label:
          status.last_heartbeat == null ? "Offline (never seen)" : "Offline",
      }
    : paused
      ? { dot: "bg-warn", text: "text-warn", label: "Paused" }
      : { dot: "bg-gain", text: "text-gain", label: "Running" };

  // Desired regime the supervisor hasn't caught up to yet (e.g. just paused, next poll pending).
  const pendingDesired =
    online && status.desired_state !== observed
      ? status.desired_state
      : null;

  function run(
    action: () => Promise<void>,
    okMsg: string,
    failMsg: string,
  ) {
    start(async () => {
      try {
        await action();
        toast(okMsg, "success");
      } catch (e) {
        toast(e instanceof Error && e.message ? e.message : failMsg, "error");
      }
    });
  }

  return (
    <section className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-display text-sm font-semibold tracking-tight text-dim">
              Supervisor
            </h3>
            <span className="inline-flex items-center gap-1.5">
              <span
                className={[
                  "h-1.5 w-1.5 rounded-[1px]",
                  view.dot,
                  online && !paused ? "animate-pulse" : "",
                ].join(" ")}
              />
              <span className={["text-xs font-medium", view.text].join(" ")}>
                {view.label}
              </span>
            </span>
          </div>
          <p className="mt-1 font-mono text-xs text-faint">
            {online ? `${status.engines ?? 0} engine${status.engines === 1 ? "" : "s"} running` : "no recent heartbeat"}
            {" · "}
            {agoLabel(status.last_heartbeat)}
            {pendingDesired && (
              <span className="ml-1 text-warn">
                · {pendingDesired} pending
              </span>
            )}
          </p>
          {status.last_error && (
            <p className="mt-1 max-w-prose font-mono text-[11px] text-loss">
              {status.last_error}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={pending || (online && !paused)}
            onClick={() =>
              run(
                adminStartSupervisorAction,
                "Supervisor resume requested",
                "Couldn't start supervisor",
              )
            }
            title="Resume normal reconciliation"
            className="rounded-md bg-white/5 px-3 py-1.5 text-xs font-medium text-dim transition-colors hover:bg-gain/10 hover:text-gain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gain disabled:cursor-not-allowed disabled:opacity-40"
          >
            Start
          </button>
          <button
            type="button"
            disabled={pending || paused}
            onClick={() =>
              run(
                adminStopSupervisorAction,
                "Supervisor pause requested",
                "Couldn't stop supervisor",
              )
            }
            title="Stop every engine (the supervisor keeps polling so you can resume)"
            className="rounded-md bg-white/5 px-3 py-1.5 text-xs font-medium text-dim transition-colors hover:bg-loss/10 hover:text-loss focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-loss disabled:cursor-not-allowed disabled:opacity-40"
          >
            Stop
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(
                adminRestartSupervisorAction,
                "Supervisor restart requested",
                "Couldn't restart supervisor",
              )
            }
            title="Recycle every engine on the next poll"
            className="rounded-md bg-white/5 px-3 py-1.5 text-xs font-medium text-dim transition-colors hover:bg-accent/10 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            Restart
          </button>
        </div>
      </div>

      <p className="mt-3 font-mono text-[11px] text-faint">
        Controls take effect on the supervisor's next poll. Stop pauses every user engine
        without killing the process; Start resumes it.
      </p>
    </section>
  );
}
