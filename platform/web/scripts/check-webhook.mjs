// Verifies the Cashfree webhook signature scheme: base64(HMAC-SHA256(timestamp + rawBody, secret)).
// Mirrors verifyWebhook() in lib/cashfree.ts (kept tiny). Run: node scripts/check-webhook.mjs
import { createHmac, timingSafeEqual } from "node:crypto";

const SECRET = "test_secret_key";
function verify(raw, signature, timestamp) {
  if (!signature) return false;
  const expected = createHmac("sha256", SECRET)
    .update(timestamp + raw)
    .digest("base64");
  const a = Buffer.from(expected),
    b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

const raw = JSON.stringify({
  type: "SUBSCRIPTION_PAYMENT_SUCCESS",
  data: { subscription_details: { subscription_id: "sub_1" } },
});
const ts = "1735680000";
const sig = createHmac("sha256", SECRET)
  .update(ts + raw)
  .digest("base64");

if (!verify(raw, sig, ts)) throw new Error("valid signature rejected");
if (verify(raw + " ", sig, ts)) throw new Error("tampered body accepted");
if (verify(raw, sig, "1735680001")) throw new Error("wrong timestamp accepted");
if (verify(raw, "", ts)) throw new Error("empty signature accepted");
console.log("webhook signature scheme OK");
