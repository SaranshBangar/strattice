// Ensures web/lib/entitlements.ts matches worker/entitlements.py (tier caps + allowlists).
// Run from strattice/web:  node scripts/check-entitlements.mjs
import { execFileSync } from "node:child_process";
import { TIERS } from "../lib/entitlements.ts";

const PY = `import sys;sys.path.insert(0,r'../worker');import entitlements,json
out={k:{"price":t.price_inr,"trades":t.trades_per_day,"max_active":t.max_active,
        "custom":t.custom,"allowed":sorted(t.allowed)} for k,t in entitlements.TIERS.items()}
print(json.dumps(out))`;
const pyTiers = JSON.parse(
  execFileSync("python", ["-c", PY], { encoding: "utf8" }),
);

let problems = 0;
for (const [name, p] of Object.entries(pyTiers)) {
  const t = TIERS[name];
  const eq =
    t &&
    t.priceInr === p.price &&
    t.tradesPerDay === p.trades &&
    (t.maxActive ?? null) === (p.max_active ?? null) &&
    t.custom === p.custom &&
    JSON.stringify([...t.allowed].sort()) === JSON.stringify(p.allowed);
  if (!eq) {
    console.error(`MISMATCH ${name}:`, { ts: t, py: p });
    problems++;
  }
}
if (Object.keys(TIERS).length !== Object.keys(pyTiers).length) {
  console.error("tier count differs");
  problems++;
}
if (problems) process.exit(1);
console.log("entitlements parity (ts == py) OK");
