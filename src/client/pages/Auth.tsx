import { SignIn, SignUp } from "@clerk/clerk-react";
import { useSearchParams } from "react-router-dom";

const appearance = {
  layout: { socialButtonsPlacement: "top" as const, socialButtonsVariant: "blockButton" as const, logoPlacement: "none" as const },
  variables: { colorPrimary: "#0A5CFF", colorText: "#1C2B33", colorTextSecondary: "#5B6B7A", colorInputBackground: "#FFFFFF", fontFamily: "Figtree, sans-serif", fontSize: "15px", borderRadius: "8px" },
  elements: {
    rootBox: { width: "100%" },
    // overflow visible + top padding leave room for Clerk's "Last used" badge, which sits over the button's top-right corner
    cardBox: { boxShadow: "none", border: "none", width: "100%", overflow: "visible" },
    card: { boxShadow: "none", border: "none", padding: "10px 0 0", background: "transparent" },
    header: { display: "none" },
    footer: { background: "transparent", "& > div:last-child": { display: "none" } },
    socialButtonsBlockButton: { height: 44, borderRadius: 8, border: "1px solid #D4D9DE", boxShadow: "none" },
    // returning users get the last-used provider in its own row; auto-fit lets a lone button span the row
    socialButtons: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(0, 1fr))", gap: 10 },
    formFieldInput: { height: 44, borderRadius: 8, border: "1px solid #D4D9DE", boxShadow: "none" },
    formButtonPrimary: { height: 44, borderRadius: 999, fontWeight: 600, fontSize: 15, boxShadow: "none", textTransform: "none" as const },
    dividerLine: { background: "#E3E6EA" },
  },
};

function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="auth">
      <main className="auth-main">
        <img src="/logo.png" alt="HyperLearn" style={{ height: 28, width: "auto", alignSelf: "flex-start" }} />
        <section className="auth-card" aria-label={title}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <h1 style={{ fontSize: 28, lineHeight: 1.2, fontWeight: 600, letterSpacing: "-0.01em" }}>{title}</h1>
            <p style={{ fontSize: 15, color: "var(--muted)" }}>{subtitle}</p>
          </div>
          {children}
        </section>
        <div className="auth-foot">
          <span className="pill-note">Built at the Meta Global AI Developer Hackathon · Cerebral Valley</span>
          <span>
            Secured by Clerk · <a href="/terms" style={{ color: "var(--muted)" }}>Terms</a> · <a href="/privacy" style={{ color: "var(--muted)" }}>Privacy</a>
          </span>
        </div>
      </main>
      <aside className="auth-aside" aria-hidden="true">
        <img src="/icon-white.png" alt="" style={{ width: 120, height: "auto" }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 440 }}>
          <p style={{ fontSize: 32, lineHeight: 1.2, fontWeight: 600, letterSpacing: "-0.01em" }}>A learning path that adapts to you.</p>
          <p style={{ fontSize: 17, lineHeight: 1.5 }}>Built from your own lectures, slides and papers. Every line links back to its source.</p>
        </div>
      </aside>
    </div>
  );
}

export function SignInPage() {
  const [params] = useSearchParams();
  const redirect = params.get("redirect") ?? "/";
  return (
    <AuthLayout title="Sign in to HyperLearn" subtitle="Welcome back. Continue with your account.">
      <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" forceRedirectUrl={redirect} appearance={appearance} />
    </AuthLayout>
  );
}

export function SignUpPage() {
  const [params] = useSearchParams();
  const redirect = params.get("redirect") ?? "/onboarding/key";
  return (
    <AuthLayout title="Create your account" subtitle="Free to start. You add your own Meta API key in step 2.">
      <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" forceRedirectUrl={redirect} appearance={appearance} />
    </AuthLayout>
  );
}
