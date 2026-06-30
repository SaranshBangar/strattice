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
      if (r.ok) router.replace("/"); // keep spinner up through the redirect
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
    <div className="wrap" style={{ maxWidth: 360, marginTop: "20vh" }}>
      <h1>Unlock</h1>
      <form onSubmit={submit}>
        <input
          className="pass"
          type="password"
          autoFocus
          placeholder="Passphrase"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          disabled={loading}
        />
        <button className="primary" type="submit" disabled={loading}>
          {loading ? <span className="spin" /> : "Unlock"}
        </button>
      </form>
      {err && <div className="card red" style={{ marginTop: 10 }}>{err}</div>}
    </div>
  );
}
