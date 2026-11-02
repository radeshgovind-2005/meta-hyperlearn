import { useEffect, useRef, useState } from "react";

/**
 * Custom HTML widgets run on a separate origin in a sandboxed iframe
 * (allow-scripts only, no same-origin) and talk to us only through postMessage.
 */
export function CustomWidget({ html, title, origin }: { html: string; title: string; origin: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(320);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const d = e.data as { type?: string; height?: number };
      if (d?.type === "ready") frame.current?.contentWindow?.postMessage({ type: "render", html }, "*");
      if (d?.type === "height" && typeof d.height === "number") setHeight(Math.min(900, Math.max(160, d.height)));
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [html]);
  return <iframe ref={frame} title={title} src={`${origin}/frame`} sandbox="allow-scripts" style={{ width: "100%", height, border: "none", borderRadius: 8 }} data-widget-ready />;
}
