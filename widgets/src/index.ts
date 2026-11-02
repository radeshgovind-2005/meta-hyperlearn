// Widget sandbox: a separate origin that only hosts model-written HTML.
// The page runs inside <iframe sandbox="allow-scripts"> (no same-origin) and
// speaks to the app only through postMessage.

const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; frame-ancestors https://hyperlearn.radesh-govind.com http://localhost:5173 http://localhost:8787";

const REPORTER = `<script>(function(){function h(){parent.postMessage({type:"height",height:document.documentElement.scrollHeight},"*")}new ResizeObserver(h).observe(document.documentElement);window.addEventListener("load",h);setTimeout(h,50)})();<\\/script>`;

const HOST = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>
<script>
window.addEventListener("message", function (e) {
  if (e.source !== parent || !e.data || e.data.type !== "render" || typeof e.data.html !== "string") return;
  document.open();
  document.write(e.data.html + "${REPORTER}");
  document.close();
});
parent.postMessage({ type: "ready" }, "*");
</script></body></html>`;

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/frame") {
      return new Response(HOST, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": CSP,
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
          "Cache-Control": "public, max-age=300",
        },
      });
    }
    if (url.pathname === "/health") return Response.json({ ok: true });
    return new Response("Not found", { status: 404 });
  },
};
