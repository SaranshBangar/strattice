"use client";
// Display-density switch. Toggles the `pro` class on <html>, which reveals the
// pro-only technical panels (see `[html.pro_&]:` variants in the dashboard) and
// is purely a view preference — it does NOT unlock plan-gated analytics.
import { useEffect, useState } from "react";

export function ProToggle() {
  const [pro, setPro] = useState(false);

  // Restore preference on mount (pro-only sections are hidden by default, so an
  // enabled user sees a brief flash before this applies — acceptable, no SSR cookie).
  useEffect(() => {
    const on = localStorage.getItem("proView") === "1";
    setPro(on);
    document.documentElement.classList.toggle("pro", on);
  }, []);

  function toggle() {
    const on = !pro;
    setPro(on);
    document.documentElement.classList.toggle("pro", on);
    localStorage.setItem("proView", on ? "1" : "0");
  }

  return (
    <label className="inline-flex cursor-pointer select-none items-center gap-2">
      <span className="font-mono text-[11px] uppercase tracking-wider text-muted">Pro view</span>
      <button
        type="button"
        role="switch"
        aria-checked={pro}
        onClick={toggle}
        className={[
          "relative h-6 w-11 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          pro ? "border-accent bg-accent/30" : "border-line bg-inset",
        ].join(" ")}
      >
        <span
          className={[
            "absolute top-0.5 h-4 w-4 rounded-full transition-transform",
            pro ? "translate-x-[22px] bg-accent" : "translate-x-0.5 bg-faint",
          ].join(" ")}
        />
      </button>
    </label>
  );
}
