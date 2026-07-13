"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signOut, deleteUser } from "@/lib/auth-client";
import { useToast } from "@/components/Toast";

const DELETE_PHRASE = "DELETE";

export function AccountActions() {
  const [confirming, setConfirming] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [password, setPassword] = useState("");
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();

  function handleSignOut() {
    start(async () => {
      await signOut();
      toast("Signed out", "success");
      router.push("/");
      router.refresh();
    });
  }

  function handleDelete() {
    start(async () => {
      const res = await deleteUser(password.trim() ? { password } : {});
      if (res.error) {
        toast(
          res.error.message ??
            "Couldn't delete account. If you signed up with a password, enter it above.",
          "error",
        );
        return;
      }
      toast("Account deleted", "success");
      router.push("/");
    });
  }

  return (
    <section className="card p-5">
      <h2 className="font-display text-sm font-semibold tracking-tight text-dim">
        Account
      </h2>

      <div className="mt-4 flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-medium text-fg">Sign out</div>
          <div className="text-sm text-muted">
            End your session on this device.
          </div>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={handleSignOut}
          className="rounded-md bg-white/5 px-3 py-1.5 text-sm font-medium text-dim transition-colors hover:bg-white/10 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
        >
          Sign out
        </button>
      </div>

      <div className="mt-5 border-t border-line pt-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-loss">Delete account</div>
            <div className="text-sm text-muted">
              Permanently deletes your account, API keys, strategies, and trade
              history. This can&rsquo;t be undone.
            </div>
          </div>
          {!confirming && (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="rounded-md bg-loss/10 px-3 py-1.5 text-sm font-medium text-loss transition-colors hover:bg-loss/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-loss"
            >
              Delete account
            </button>
          )}
        </div>

        {confirming && (
          <div className="mt-3 space-y-3 rounded-md border border-loss/30 bg-loss/5 p-4">
            <p className="text-sm text-fg">
              <span className="font-semibold text-loss">
                This is permanent.
              </span>{" "}
              Your bot stops immediately, your API keys are wiped, and every
              strategy and trade record is gone for good.
            </p>
            <div className="space-y-1.5">
              <label htmlFor="del-password" className="block text-xs text-muted">
                Password (only if you signed up with email/password)
              </label>
              <input
                id="del-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="off"
                className="w-56 rounded-md border border-line bg-inset px-3 py-1.5 text-sm text-fg placeholder-faint focus:border-loss focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-loss"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="del-phrase" className="sr-only">
                Type {DELETE_PHRASE} to confirm
              </label>
              <input
                id="del-phrase"
                type="text"
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                placeholder={`type ${DELETE_PHRASE} to confirm`}
                autoComplete="off"
                spellCheck={false}
                className="w-48 rounded-md border border-line bg-inset px-3 py-1.5 font-mono text-sm text-fg placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-loss"
              />
              <button
                type="button"
                disabled={
                  pending || phrase.trim().toUpperCase() !== DELETE_PHRASE
                }
                onClick={handleDelete}
                className="rounded-md bg-loss px-3 py-1.5 text-sm font-semibold text-bg transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-loss"
              >
                Delete permanently
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setConfirming(false);
                  setPhrase("");
                  setPassword("");
                }}
                className="rounded-md bg-white/5 px-3 py-1.5 text-sm text-muted transition-colors hover:bg-white/10 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
