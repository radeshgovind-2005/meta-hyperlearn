import { createContext, StrictMode, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ClerkProvider, SignedIn, SignedOut, useAuth } from "@clerk/clerk-react";
import "./styles.css";
import { setTokenGetter } from "./lib/api";
import { AppProvider, useApp } from "./lib/app";
import { Palette } from "./components/Palette";
import { SignInPage, SignUpPage } from "./pages/Auth";
import { KeyOnboarding, UploadOnboarding } from "./pages/Onboarding";
import { LibraryPage } from "./pages/Library";
import { SourcePage } from "./pages/Source";
import { NewCoursePage } from "./pages/NewCourse";
import { OutlinePage } from "./pages/Outline";
import { CoursePage } from "./pages/Course";
import { EditorPage } from "./pages/Editor";
import { HistoryPage } from "./pages/History";
import { PracticeHome, PracticePage, ResultsPage } from "./pages/Practice";
import { InvitePage } from "./pages/Invite";
import { SharedPage, UpdatesPage } from "./pages/Shared";
import { SettingsAccountPage, SettingsKeyPage } from "./pages/Settings";
import { ResearchPage } from "./pages/Research";
import { EmbedWidgetPage } from "./pages/EmbedWidget";

type Config = { clerkPublishableKey: string; widgetsOrigin: string };
const ConfigCtx = createContext<Config>({ clerkPublishableKey: "", widgetsOrigin: "" });
export const useConfig = () => useContext(ConfigCtx);

function TokenBridge() {
  const { getToken } = useAuth();
  useEffect(() => setTokenGetter(() => getToken()), [getToken]);
  return null;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const loc = useLocation();
  return (
    <>
      <SignedIn>{children}</SignedIn>
      <SignedOut>
        <Navigate to={`/sign-in?redirect=${encodeURIComponent(loc.pathname + loc.search)}`} replace />
      </SignedOut>
    </>
  );
}

/** Sends brand-new users through onboarding once. */
function Home() {
  const { me, courses } = useApp();
  if (!me) return null;
  if (!me.onboarded && me.mode === "demo" && !courses.some((c) => c.role === "owner")) return <Navigate to="/onboarding/key" replace />;
  return <Navigate to="/library" replace />;
}

function SignedInApp() {
  const [palette, setPalette] = useState<{ prefill?: string } | null>(null);
  const openPalette = useCallback((prefill?: string) => setPalette({ prefill }), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.closest("input, textarea, select, [contenteditable]") !== null);
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setPalette({});
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <AppProvider onPalette={openPalette}>
      <TokenBridge />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/onboarding/key" element={<KeyOnboarding />} />
        <Route path="/onboarding/upload" element={<UploadOnboarding />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/sources/:id" element={<SourcePage />} />
        <Route path="/courses/new" element={<NewCoursePage />} />
        <Route path="/courses/:courseId" element={<OutlinePage />} />
        <Route path="/courses/:courseId/s/:sectionId" element={<CoursePage />} />
        <Route path="/courses/:courseId/s/:sectionId/edit" element={<EditorPage />} />
        <Route path="/courses/:courseId/history" element={<HistoryPage />} />
        <Route path="/courses/:courseId/updates" element={<UpdatesPage />} />
        <Route path="/practice" element={<PracticeHome />} />
        <Route path="/practice/:sessionId" element={<PracticePage />} />
        <Route path="/practice/:sessionId/results" element={<ResultsPage />} />
        <Route path="/research/:id" element={<ResearchPage />} />
        <Route path="/shared" element={<SharedPage />} />
        <Route path="/settings/account/*" element={<SettingsAccountPage />} />
        <Route path="/settings/ai" element={<SettingsKeyPage />} />
        <Route path="/settings" element={<Navigate to="/settings/account" replace />} />
        <Route path="*" element={<Navigate to="/library" replace />} />
      </Routes>
      {palette && <PaletteHost prefill={palette.prefill} onClose={() => setPalette(null)} />}
    </AppProvider>
  );
}

function PaletteHost({ prefill, onClose }: { prefill?: string; onClose: () => void }) {
  return <Palette prefill={prefill} onClose={onClose} />;
}

function ClerkWithRouter({ config }: { config: Config }) {
  const navigate = useNavigate();
  return (
    <ClerkProvider
      publishableKey={config.clerkPublishableKey}
      routerPush={(to) => navigate(to)}
      routerReplace={(to) => navigate(to, { replace: true })}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/onboarding/key"
      appearance={{ variables: { colorPrimary: "#0A5CFF", colorText: "#1C2B33", fontFamily: "Figtree, sans-serif", borderRadius: "8px" } }}
    >
      <Routes>
        <Route path="/sign-in/*" element={<SignInPage />} />
        <Route path="/sign-up/*" element={<SignUpPage />} />
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route path="/embed/widget" element={<EmbedWidgetPage />} />
        <Route
          path="*"
          element={
            <RequireAuth>
              <SignedInApp />
            </RequireAuth>
          }
        />
      </Routes>
    </ClerkProvider>
  );
}

function Root() {
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const envKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
    fetch("/api/config")
      .then((r) => r.json() as Promise<Config>)
      .then((c) => setConfig({ ...c, clerkPublishableKey: c.clerkPublishableKey || envKey || "" }))
      .catch(() => (envKey ? setConfig({ clerkPublishableKey: envKey, widgetsOrigin: "" }) : setError("Could not load HyperLearn. Please refresh.")));
  }, []);
  if (error) return <p style={{ padding: 32 }}>{error}</p>;
  if (!config) return null;
  // the widget embed page is rendered by Browser Rendering without auth
  if (window.location.pathname === "/embed/widget") return <EmbedWidgetPage />;
  return (
    <ConfigCtx.Provider value={config}>
      <BrowserRouter>
        <ClerkWithRouter config={config} />
      </BrowserRouter>
    </ConfigCtx.Provider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
