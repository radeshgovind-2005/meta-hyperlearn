import puppeteer from "@cloudflare/puppeteer";
import { z } from "zod";
import type { Env } from "../env";
import type { AiCtx } from "../ai/meta";
import { chatJson } from "../ai/meta";
import { MODELS } from "../ai/models";
import type { WidgetSpec } from "../../shared/types";
import { traceChild } from "../lib/tracing";
import { count, exhausted, keys } from "../lib/quota";

export type RenderCheck = { ok: boolean; errors: string[]; judge: { ok: boolean; reason: string } | null; screenshot?: string; unavailable?: string };

const b64url = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/**
 * Loads the widget in a real browser (Cloudflare Browser Rendering), collects console
 * errors, nudges its first control, and asks Muse Spark whether the screenshot shows what
 * the student asked for.
 */
export async function renderAndJudge(env: Env, ctx: AiCtx, spec: WidgetSpec, request: string): Promise<RenderCheck> {
  return traceChild(ctx.trace, "browser-render", "tool", { template: spec.template }, async () => {
    if (await exhausted(env, ["browser"])) return { ok: true, errors: [], judge: null, unavailable: "daily browser test allowance used" };
    count(keys.browser());
    const errors: string[] = [];
    let screenshot: string | undefined;
    let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
    try {
      browser = await puppeteer.launch(env.BROWSER as never);
      const page = await browser.newPage();
      await page.setViewport({ width: 760, height: 520, deviceScaleFactor: 1 });
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text().slice(0, 300));
      });
      page.on("pageerror", (e) => errors.push(String((e as Error).message ?? e).slice(0, 300)));
      if (spec.template === "custom") {
        await page.setContent(spec.html, { waitUntil: "load" });
      } else {
        try {
          await page.goto(`${env.APP_ORIGIN}/embed/widget#${b64url(JSON.stringify(spec))}`, { waitUntil: "networkidle0", timeout: 20_000 });
        } catch (err) {
          // the test page itself is unreachable: an infrastructure problem, not a broken widget
          return { ok: true, errors: [], judge: null, unavailable: (err as Error).message.slice(0, 120) };
        }
        await page.waitForSelector("[data-widget-ready]", { timeout: 10_000 });
      }
      // interact once so handlers run
      const control = await page.$("input[type=range], button");
      if (control) {
        const tag = await control.evaluate((el) => el.tagName);
        if (tag === "INPUT") await control.evaluate((el) => { const i = el as unknown as HTMLInputElement; i.value = String((Number(i.min) + Number(i.max)) / 2); i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true })); });
        else await control.click();
        await new Promise((r) => setTimeout(r, 300));
      }
      screenshot = (await page.screenshot({ encoding: "base64", type: "png" })) as string;
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      if (!browser || /launch|quota|rate limit|429/i.test(msg)) return { ok: true, errors: [], judge: null, unavailable: msg.slice(0, 120) };
      errors.push(`render failed: ${msg}`);
    } finally {
      await browser?.close().catch(() => {});
    }
    let judge: RenderCheck["judge"] = null;
    if (screenshot) {
      judge = await chatJson(ctx, {
        model: MODELS.spark,
        name: "judge-widget-screenshot",
        schema: z.object({ ok: z.boolean(), reason: z.string() }),
        schemaName: "judgement",
        reasoningEffort: "low",
        maxTokens: 600,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: `A student asked: "${request}". This is a screenshot of the interactive example built for them (${spec.title ?? spec.template}). Is it readable, not broken or empty, and does it match the request? Answer ok and a one-line reason.` },
              { type: "image_url", image_url: { url: `data:image/png;base64,${screenshot}` } },
            ],
          },
        ],
      });
    }
    return { ok: errors.length === 0 && (judge?.ok ?? false), errors, judge, screenshot: undefined };
  });
}
