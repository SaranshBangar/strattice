"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Login() {
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const router = useRouter();

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

  return (
    <div className="wrap">
      <h1>🔒 Bot Dashboard</h1>
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
        {err && <p className="red" style={{ marginBottom: 0 }}>{err}</p>}
      </form>
    </div>
  );
}
