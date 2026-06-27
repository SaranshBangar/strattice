"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { biometricAvailable, unlockWithFingerprint } from "@/lib/webauthn-client";

export default function Login() {
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [bio, setBio] = useState(false);
  const router = useRouter();

  // Offer fingerprint only on devices that actually have one.
  useEffect(() => {
    biometricAvailable().then(setBio);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const r = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase: pass }),
    });
    if (r.ok) router.replace("/");
    else setErr("Wrong passphrase");
  }

  async function fingerprint() {
    setErr("");
    try {
      if (await unlockWithFingerprint()) router.replace("/");
      else setErr("No fingerprint set up on this device yet — unlock with the passphrase, then enable it.");
    } catch {
      setErr("Fingerprint unlock cancelled");
    }
  }

  return (
    <div className="wrap">
      <h1>Bot Dashboard</h1>
      <form onSubmit={submit} className="card">
        <input
          className="pass"
          type="password"
          placeholder="Passphrase"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          autoFocus
        />
        <button className="primary" type="submit">Unlock</button>
        {bio && (
          <button
            type="button"
            className="primary"
            style={{ marginTop: 10, background: "var(--card)", border: "1px solid var(--line)" }}
            onClick={fingerprint}
          >
            🔒 Unlock with fingerprint
          </button>
        )}
        {err && <p className="red" style={{ marginBottom: 0 }}>{err}</p>}
      </form>
    </div>
  );
}
