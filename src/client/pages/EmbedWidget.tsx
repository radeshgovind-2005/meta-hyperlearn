import { WidgetSpecSchema } from "@shared/types";
import { WidgetView } from "../components/Blocks";

/**
 * Renders one widget from the URL hash, with no auth and no app chrome.
 * Browser Rendering loads this page to test a widget before it is shown.
 */
export function EmbedWidgetPage() {
  const b64 = window.location.hash.slice(1).replace(/-/g, "+").replace(/_/g, "/");
  const parsed = (() => {
    try {
      return WidgetSpecSchema.safeParse(JSON.parse(decodeURIComponent(escape(atob(b64)))));
    } catch {
      return null;
    }
  })();
  if (!parsed?.success) return <p style={{ padding: 24 }}>Invalid widget</p>;
  const spec = parsed.data;
  return (
    <main style={{ padding: 24, maxWidth: 720 }}>
      <section className="widget-card">
        {spec.title && <p className="widget-title">{spec.title}</p>}
        <WidgetView spec={spec} widgetsOrigin="" />
      </section>
    </main>
  );
}
