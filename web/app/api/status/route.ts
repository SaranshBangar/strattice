import { NextResponse } from "next/server";

// Server-side proxy to the bot's read-only status server. Keeps BOT_API_TOKEN
// out of the browser and sidesteps CORS. Cached 10s to spare the VPS.
export const revalidate = 0;

export async function GET() {
  const base = process.env.BOT_API_URL; // e.g. https://vps.example.com:8787
  const token = process.env.BOT_API_TOKEN;
  if (!base || !token) {
    return NextResponse.json({ error: "BOT_API_URL/TOKEN not set" }, { status: 500 });
  }
  try {
    const r = await fetch(`${base}/api/status`, {
      headers: { "X-Token": token },
      next: { revalidate: 10 },
    });
    if (!r.ok) {
      return NextResponse.json({ error: `bot ${r.status}` }, { status: 502 });
    }
    return NextResponse.json(await r.json());
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
