import { NextResponse } from "next/server";

// Server-side proxy to the bot's strategy-toggle endpoint. Keeps BOT_API_TOKEN
// out of the browser. POST {name, enabled} -> flips that strategy in config.yaml;
// the engine picks it up on its next poll cycle (no restart).
export const revalidate = 0;

export async function POST(req: Request) {
  const base = process.env.BOT_API_URL;
  const token = process.env.BOT_API_TOKEN;
  if (!base || !token) {
    return NextResponse.json({ error: "BOT_API_URL/TOKEN not set" }, { status: 500 });
  }
  try {
    const r = await fetch(`${base}/api/strategy`, {
      method: "POST",
      headers: { "X-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify(await req.json()),
      cache: "no-store",
    });
    return NextResponse.json(await r.json(), { status: r.status });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
