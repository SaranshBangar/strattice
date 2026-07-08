import { AuthForm } from "@/components/AuthForm";
import { AuthPanel } from "@/components/AuthPanel";
import { googleConfigured } from "@/lib/auth";

export default function SignUpPage() {
  return (
    <div className="mx-auto grid max-w-4xl items-start gap-10 py-6 lg:grid-cols-[1fr_0.9fr]">
      <AuthForm mode="sign-up" googleEnabled={googleConfigured} />
      <AuthPanel />
    </div>
  );
}
