// Admin gate. Client-safe (no server-only imports) so the Nav can show the Admin
// link. The email can be overridden per-deploy; defaults to the platform owner.
export const ADMIN_EMAIL = (
  process.env.NEXT_PUBLIC_ADMIN_EMAIL || "saranshbangad@gmail.com"
).toLowerCase();

export function isAdmin(email?: string | null): boolean {
  return !!email && email.toLowerCase() === ADMIN_EMAIL;
}
