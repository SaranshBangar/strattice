import type { Metadata } from "next";
import { AuthForm } from "@/components/AuthForm";
import { AuthPanel } from "@/components/AuthPanel";
import { googleConfigured } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Sign in",
  description:
    "Sign in to Strattice to manage your algorithmic trading strategies on your own CoinDCX account.",
  alternates: { canonical: "/sign-in" },
};

export default function SignInPage() {
  return (
    <div className="mx-auto grid max-w-4xl items-start gap-10 py-6 lg:grid-cols-[1fr_0.9fr]">
      <AuthForm mode="sign-in" googleEnabled={googleConfigured} />
      <AuthPanel />
    </div>
  );
}
