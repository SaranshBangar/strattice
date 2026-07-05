"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Login() {
  const router = useRouter();
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      const r = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passphrase: pass }),
      });
      if (r.ok)
        router.replace("/"); // keep spinner up through the redirect
      else {
        setErr("Wrong passphrase");
        setLoading(false);
      }
    } catch {
      setErr("Network error");
      setLoading(false);
    }
  }

  return (
    <div className="login">
      <div className="login-brand">
        {/* eslint-disable-next-line @next/next/no-img-element -- static asset */}
        <img src="/favicon.svg" alt="" width={40} height={40} />
        <div>
          <div className="login-name">coindcx bot</div>
          <div className="login-tag">private dashboard</div>
        </div>
      </div>
      <form onSubmit={submit} className="card login-card">
        <label className="login-label" htmlFor="pass">
          Passphrase
        </label>
        <input
          id="pass"
          className="pass"
          type="password"
          autoFocus
          placeholder="••••••••"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          disabled={loading}
        />
        <button className="primary" type="submit" disabled={loading}>
          {loading ? <span className="spin" /> : "Unlock"}
        </button>
        {err && (
          <p className="login-err" role="alert">
            {err}
          </p>
        )}
      </form>
      <p className="login-foot">bot status · positions · live market charts</p>
    </div>
  );
}
