// Verifies the AES-256-GCM wire format is byte-compatible between web/lib/crypto.ts and
// worker/crypto.py (Node WebCrypto <-> Python cryptography). Uses the SAME logic as
// lib/crypto.ts (kept tiny on purpose) and round-trips through the real Python module.
// Run from strattice/web:  node scripts/check-crypto.mjs   (python must be on PATH)
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const KEY = randomBytes(32).toString("base64");
process.env.ENCRYPTION_MASTER_KEY = KEY;
process.env.PYTHONIOENCODING = "utf-8"; // Windows: let python print/read unicode over the pipe
const NONCE = 12;

async function getKey() {
  return crypto.subtle.importKey(
    "raw",
    Buffer.from(KEY, "base64"),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}
async function encrypt(pt) {
  const iv = crypto.getRandomValues(new Uint8Array(NONCE));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await getKey(),
      new TextEncoder().encode(pt),
    ),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return Buffer.from(out).toString("base64");
}
async function decrypt(tok) {
  const b = Buffer.from(tok, "base64");
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b.subarray(0, NONCE) },
    await getKey(),
    b.subarray(NONCE),
  );
  return new TextDecoder().decode(pt);
}

const PY_DEC =
  "import sys;sys.path.insert(0,r'../worker');import crypto;sys.stdout.write(crypto.decrypt(sys.argv[1]))";
const PY_ENC =
  "import sys;sys.path.insert(0,r'../worker');import crypto;sys.stdout.write(crypto.encrypt(sys.argv[1]))";
const py = (code, arg) =>
  execFileSync("python", ["-c", code, arg], {
    env: process.env,
    encoding: "utf8",
  }).trim();

const msg = "coindcx_secret_猫_🔑";
if ((await decrypt(await encrypt(msg))) !== msg)
  throw new Error("node round-trip failed");
if (py(PY_DEC, await encrypt(msg)) !== msg)
  throw new Error("node->python decrypt failed");
if ((await decrypt(py(PY_ENC, msg))) !== msg)
  throw new Error("python->node decrypt failed");
console.log("crypto cross-language (node <-> python) OK");
