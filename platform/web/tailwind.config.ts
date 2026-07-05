import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0B0D12",
        panel: "#131722",
        inset: "#0E121A",
        line: "#1F2433",
        fg: "#E6E9F0",
        dim: "#AEB6C8",
        muted: "#828AA0",
        faint: "#5A6379",
        accent: { DEFAULT: "#C9A24B", hi: "#DCB868", ink: "#0B0D12" },
        gain: "#16B97D",
        loss: "#F0584F",
        warn: "#E0902F",
      },
      fontFamily: {
        sans: [
          "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI",
          "Roboto", "Helvetica", "Arial", "sans-serif",
        ],
        display: ["var(--font-display)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
