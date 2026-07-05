// Display-currency choices offered in Settings. Flags are emoji so no image
// assets are needed; Windows renders them as "IN"/"US" letter pairs, which is
// an acceptable fallback.
export const CURRENCIES = [
  { code: "INR", flag: "🇮🇳", name: "Indian Rupee" },
  { code: "USD", flag: "🇺🇸", name: "US Dollar" },
  { code: "EUR", flag: "🇪🇺", name: "Euro" },
  { code: "GBP", flag: "🇬🇧", name: "British Pound" },
  { code: "JPY", flag: "🇯🇵", name: "Japanese Yen" },
  { code: "AUD", flag: "🇦🇺", name: "Australian Dollar" },
  { code: "SGD", flag: "🇸🇬", name: "Singapore Dollar" },
  { code: "AED", flag: "🇦🇪", name: "UAE Dirham" },
] as const;

export type CurrencyCode = (typeof CURRENCIES)[number]["code"];

export const DEFAULT_CURRENCY: CurrencyCode = "INR";

export function isCurrencyCode(v: string): v is CurrencyCode {
  return CURRENCIES.some((c) => c.code === v);
}
