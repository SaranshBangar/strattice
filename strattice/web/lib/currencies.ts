// Display-currency choices offered in Settings. Flags are emoji so no image
// assets are needed; Windows renders them as "IN"/"US" letter pairs, which is
// an acceptable fallback.
export const CURRENCIES = [
  { code: "INR", flag: "🇮🇳", name: "Indian Rupee", symbol: "₹" },
  { code: "USD", flag: "🇺🇸", name: "US Dollar", symbol: "$" },
  { code: "EUR", flag: "🇪🇺", name: "Euro", symbol: "€" },
  { code: "GBP", flag: "🇬🇧", name: "British Pound", symbol: "£" },
  { code: "JPY", flag: "🇯🇵", name: "Japanese Yen", symbol: "¥" },
  { code: "AUD", flag: "🇦🇺", name: "Australian Dollar", symbol: "A$" },
  { code: "SGD", flag: "🇸🇬", name: "Singapore Dollar", symbol: "S$" },
  { code: "AED", flag: "🇦🇪", name: "UAE Dirham", symbol: "AED " },
] as const;

export function currencySymbol(code: string): string {
  return CURRENCIES.find((c) => c.code === code)?.symbol ?? "$";
}

export type CurrencyCode = (typeof CURRENCIES)[number]["code"];

export const DEFAULT_CURRENCY: CurrencyCode = "INR";

export function isCurrencyCode(v: string): v is CurrencyCode {
  return CURRENCIES.some((c) => c.code === v);
}
