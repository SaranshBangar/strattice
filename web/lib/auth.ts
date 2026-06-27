// Single shared secret. In dev (no APP_PASSPHRASE set) fall back to a known
// default so you can log in without configuring env. ponytail: prod must set
// APP_PASSPHRASE — the dev default only applies when NODE_ENV !== production.
export const APP_PASSPHRASE =
  process.env.APP_PASSPHRASE ??
  (process.env.NODE_ENV !== "production" ? "default-auth-key-@-123" : "");
