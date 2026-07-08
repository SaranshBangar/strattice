// AES-256-GCM for CoinDCX API keys at rest. Format MUST match worker/crypto.py:
//   base64( nonce(12) || ciphertext || tag(16) )
// Web Crypto's AES-GCM appends the tag to the ciphertext, so this interops with Python's
// cryptography.AESGCM byte-for-byte. Key: env ENCRYPTION_MASTER_KEY = base64 of 32 bytes.
const NONCE = 12;

async function getKey(): Promise<CryptoKey> {
  const raw = process.env.ENCRYPTION_MASTER_KEY;
  if (!raw) throw new Error("ENCRYPTION_MASTER_KEY not set");
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length !== 32)
    throw new Error(
      `ENCRYPTION_MASTER_KEY must be 32 bytes, got ${bytes.length}`,
    );
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encrypt(plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(NONCE));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await getKey(),
      new TextEncoder().encode(plaintext),
    ),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return Buffer.from(out).toString("base64");
}

export async function decrypt(token: string): Promise<string> {
  const blob = Buffer.from(token, "base64");
  const iv = blob.subarray(0, NONCE);
  const ct = blob.subarray(NONCE);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    await getKey(),
    ct,
  );
  return new TextDecoder().decode(pt);
}
