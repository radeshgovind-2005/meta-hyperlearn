import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";

export type Me = {
  userId: string;
  mode: "byok" | "demo";
  key: { last4: string; verifiedAt: number | null } | null;
  capUsd: number;
  spentUsd: number;
  onboarded: boolean;
  demo: { courseId: string | null; capUsd: number; spentUsd: number; available: boolean };
  limits: { contact: string; uploadsBlocked: string | null; usage: Record<string, number> };
};

export type CourseItem = {
  id: string;
  title: string;
  status: string;
  progress: string | null;
  role: "owner" | "demo" | "follower";
  source_count: number;
  forked_from: string | null;
  is_demo: number;
  updated_at: number;
  nextUp: { id: string; title: string } | null;
  progress_counts?: { read: number; total: number };
};

type Ctx = {
  me: Me | null;
  courses: CourseItem[];
  reloadMe: () => Promise<void>;
  reloadCourses: () => Promise<void>;
  toast: (msg: string) => void;
  openPalette: (prefill?: string) => void;
  pageContext: PageContext;
  setPageContext: (c: PageContext) => void;
};

export type PageContext = { courseId?: string; courseTitle?: string; sectionId?: string; sectionTitle?: string; onMutate?: (request: string) => void; onShare?: () => void };

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ children, onPalette }: { children: ReactNode; onPalette: (prefill?: string) => void }) {
  const [me, setMe] = useState<Me | null>(null);
  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [pageContext, setPageContext] = useState<PageContext>({});

  const reloadMe = useCallback(async () => {
    setMe(await api<Me>("/api/me"));
  }, []);
  const reloadCourses = useCallback(async () => {
    const r = await api<{ items: (CourseItem & { progress: unknown })[] }>("/api/courses");
    setCourses(r.items as CourseItem[]);
  }, []);
  useEffect(() => {
    void reloadMe().catch(() => {});
    void reloadCourses().catch(() => {});
  }, [reloadMe, reloadCourses]);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg((m) => (m === msg ? null : m)), 4000);
  }, []);

  const value = useMemo(
    () => ({ me, courses, reloadMe, reloadCourses, toast, openPalette: onPalette, pageContext, setPageContext }),
    [me, courses, reloadMe, reloadCourses, toast, onPalette, pageContext],
  );
  return (
    <AppCtx.Provider value={value}>
      {children}
      {toastMsg && (
        <div className="toast" role="status" aria-live="polite">
          {toastMsg}
        </div>
      )}
    </AppCtx.Provider>
  );
}

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp outside AppProvider");
  return c;
}

/** Registers what the current page is about, so the command bar and palette can act on it. */
export function usePageContext(ctx: PageContext, deps: unknown[]) {
  const { setPageContext } = useApp();
  useEffect(() => {
    setPageContext(ctx);
    return () => setPageContext({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
