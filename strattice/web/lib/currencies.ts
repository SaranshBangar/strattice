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
  { code: "CAD", flag: "🇨🇦", name: "Canadian Dollar", symbol: "C$" },
  { code: "CHF", flag: "🇨🇭", name: "Swiss Franc", symbol: "CHF " },
  { code: "CNY", flag: "🇨🇳", name: "Chinese Yuan", symbol: "CN¥" },
  { code: "HKD", flag: "🇭🇰", name: "Hong Kong Dollar", symbol: "HK$" },
  { code: "KRW", flag: "🇰🇷", name: "South Korean Won", symbol: "₩" },
  { code: "NZD", flag: "🇳🇿", name: "New Zealand Dollar", symbol: "NZ$" },
  { code: "SEK", flag: "🇸🇪", name: "Swedish Krona", symbol: "kr " },
  { code: "NOK", flag: "🇳🇴", name: "Norwegian Krone", symbol: "kr " },
  { code: "DKK", flag: "🇩🇰", name: "Danish Krone", symbol: "kr " },
  { code: "ZAR", flag: "🇿🇦", name: "South African Rand", symbol: "R " },
  { code: "BRL", flag: "🇧🇷", name: "Brazilian Real", symbol: "R$" },
  { code: "MXN", flag: "🇲🇽", name: "Mexican Peso", symbol: "MX$" },
  { code: "SAR", flag: "🇸🇦", name: "Saudi Riyal", symbol: "SAR " },
  { code: "THB", flag: "🇹🇭", name: "Thai Baht", symbol: "฿" },
  { code: "MYR", flag: "🇲🇾", name: "Malaysian Ringgit", symbol: "RM " },
  { code: "IDR", flag: "🇮🇩", name: "Indonesian Rupiah", symbol: "Rp " },
  { code: "PHP", flag: "🇵🇭", name: "Philippine Peso", symbol: "₱" },
] as const;

export function currencySymbol(code: string): string {
  return CURRENCIES.find((c) => c.code === code)?.symbol ?? "$";
}

export type CurrencyCode = (typeof CURRENCIES)[number]["code"];

export const DEFAULT_CURRENCY: CurrencyCode = "INR";

export function isCurrencyCode(v: string): v is CurrencyCode {
  return CURRENCIES.some((c) => c.code === v);
}
