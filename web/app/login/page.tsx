"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Login() {
  const router = useRouter();
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const r = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passphrase: pass }),
    });
    if (r.ok) router.replace("/");
    else setErr("Wrong passphrase");
  }

  return (
    <div className="wrap" style={{ maxWidth: 360, marginTop: "20vh" }}>
      <h1>Unlock</h1>
      <form onSubmit={submit}>
        <input
          type="password"
          autoFocus
          placeholder="Passphrase"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          style={{ width: "100%", padding: 10, margin: "10px 0", boxSizing: "border-box" }}
        />
        <button type="submit" style={{ width: "100%", padding: 10 }}>Unlock</button>
      </form>
      {err && <div className="card red" style={{ marginTop: 10 }}>{err}</div>}
    </div>
  );
}
