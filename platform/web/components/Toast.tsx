"use client";
// Minimal toast system - no dependency. Wrap the app in <ToastProvider> once, then
// call const toast = useToast() in any client component. Toasts stack bottom-right
// and auto-dismiss after 4s. Status is conveyed by a coloured icon, not a side
// border, to stay consistent with the rest of the UI.
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

type ToastKind = "success" | "error" | "info";
interface Toast { id: number; kind: ToastKind; msg: string }

const ToastCtx = createContext<(msg: string, kind?: ToastKind) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (msg: string, kind: ToastKind = "info") => {
      const id = ++seq.current;
      setToasts((t) => [...t, { id, kind, msg }]);
      setTimeout(() => dismiss(id), 4000);
    },
    [dismiss],
  );

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto flex items-start gap-2.5 rounded-md bg-white/5 px-3.5 py-3 text-sm text-fg shadow-lg shadow-black/40 [animation:toastIn_.18s_ease-out]"
          >
            <ToastIcon kind={t.kind} />
            <span className="flex-1 leading-snug">{t.msg}</span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
              className="-mr-1 shrink-0 rounded p-0.5 text-faint transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <path strokeLinecap="round" d="m5 5 10 10M15 5 5 15" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function ToastIcon({ kind }: { kind: ToastKind }) {
  const color = kind === "success" ? "text-gain" : kind === "error" ? "text-loss" : "text-accent";
  return (
    <svg viewBox="0 0 20 20" className={`mt-px h-4 w-4 shrink-0 ${color}`} fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      {kind === "success" ? (
        <path strokeLinecap="round" strokeLinejoin="round" d="m5 10.5 3 3 7-7" />
      ) : kind === "error" ? (
        <path strokeLinecap="round" d="M10 6v5m0 3h.01" />
      ) : (
        <path strokeLinecap="round" d="M10 9v5m0-8h.01" />
      )}
    </svg>
  );
}
