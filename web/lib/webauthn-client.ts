import {
  startRegistration,
  startAuthentication,
} from "@simplewebauthn/browser";

// True when this device exposes a built-in biometric (Touch ID / Face ID /
// Windows Hello / Android fingerprint).
export async function biometricAvailable(): Promise<boolean> {
  if (typeof window === "undefined" || !window.PublicKeyCredential) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

// Pre-login unlock. Returns true when the auth cookie was set.
export async function unlockWithFingerprint(): Promise<boolean> {
  const optRes = await fetch("/api/webauthn/auth/options", { method: "POST" });
  const data = await optRes.json();
  if (!data.enrolled) return false; // no device enrolled yet
  const assertion = await startAuthentication({ optionsJSON: data.options });
  const verify = await fetch("/api/webauthn/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(assertion),
  });
  return verify.ok;
}

// Enroll this device's biometric. Requires being already logged in.
export async function enrollFingerprint(): Promise<void> {
  const optRes = await fetch("/api/webauthn/register/options", {
    method: "POST",
  });
  if (!optRes.ok) throw new Error("could not start enrollment");
  const options = await optRes.json();
  const attestation = await startRegistration({ optionsJSON: options });
  const verify = await fetch("/api/webauthn/register/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(attestation),
  });
  if (!verify.ok) throw new Error((await verify.json()).error ?? "enroll failed");
}
