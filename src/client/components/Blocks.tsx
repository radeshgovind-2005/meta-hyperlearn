import type { ReactNode } from "react";
import type { Block, Cite, WidgetSpec } from "@shared/types";
import { PlotParams, StepperParams, Vector2dParams } from "@shared/widgets";
import { Md } from "./Md";
import { Vector2d } from "../widgets/Vector2d";
import { Plot } from "../widgets/Plot";
import { Stepper } from "../widgets/Stepper";
import { CustomWidget } from "../widgets/CustomWidget";
import { fmtTime } from "../lib/hooks";
import { examLabel, stripQuestionNumber } from "../lib/format";

export type SourceInfo = { id: string; filename: string; kind: string; title: string; fileUrl: string; pageUrls: Record<number, string>; pageSizes: [number, number][] };

export function citeLabel(c: Cite, sources: Record<string, SourceInfo>, short = false): string {
  const s = sources[c.sourceId];
  const name = (s?.filename ?? "source").replace(/\.(pdf|m4a|mp3|wav)$/i, "");
  if (c.page) return short ? `${name} p.${c.page}` : `${s?.filename ?? name}, page ${c.page}`;
  if (c.tStart !== undefined) return `${name} ${fmtTime(c.tStart)}`;
  return name;
}

/** Superscript citation numbers that open the source pane at that citation. */
export function CiteMarks({ cites, active, onCite }: { cites: Cite[]; active?: number | null; onCite: (i: number) => void }) {
  if (!cites.length) return null;
  return (
    <sup>
      {cites.map((c, i) => (
        <span key={i}>
          {i > 0 && ","}
          <button type="button" className="cite-link" aria-pressed={active === i} aria-label={`Source ${i + 1}${c.page ? `, page ${c.page}` : ""}`} onClick={(e) => { e.stopPropagation(); onCite(i); }}>
            {i + 1}
          </button>
        </span>
      ))}
    </sup>
  );
}

export function WidgetView({ spec, widgetsOrigin }: { spec: WidgetSpec; widgetsOrigin: string }) {
  if (spec.template === "vector2d") {
    const p = Vector2dParams.safeParse(spec.params);
    return p.success ? <Vector2d params={p.data} /> : <p className="small err-text">This example has invalid settings.</p>;
  }
  if (spec.template === "plot") {
    const p = PlotParams.safeParse(spec.params);
    return p.success ? <Plot params={p.data} /> : <p className="small err-text">This example has invalid settings.</p>;
  }
  if (spec.template === "stepper") {
    const p = StepperParams.safeParse(spec.params);
    return p.success ? <Stepper steps={p.data.steps} /> : <p className="small err-text">This example has invalid settings.</p>;
  }
  if (spec.template === "custom") return <CustomWidget html={spec.html} title={spec.title ?? "Interactive example"} origin={widgetsOrigin} />;
  return null;
}

export function WidgetCard({ block, sources, widgetsOrigin }: { block: Extract<Block, { kind: "widget" }>; sources: Record<string, SourceInfo>; widgetsOrigin: string }) {
  const from = [...new Set(block.cites.map((c) => citeLabel(c, sources, true)))].slice(0, 2).join(" and ");
  return (
    <section className="widget-card" aria-label="Interactive example">
      {block.spec.title && <p className="widget-title">{block.spec.title}</p>}
      <WidgetView spec={block.spec} widgetsOrigin={widgetsOrigin} />
      <p className="widget-foot">{from ? `Built from ${from} · ` : ""}tested before it was shown</p>
    </section>
  );
}

export function ExerciseCard({ block, styleName }: { block: Extract<Block, { kind: "exercise" }>; styleName?: string }) {
  return (
    <section className="exercise" aria-label="Exercise">
      <p className="label-caps">Try it{styleName ? ` · in the style of ${examLabel(styleName)}` : ""}</p>
      <p className="q">
        <Md text={stripQuestionNumber(block.prompt)} />
      </p>
      <details>
        <summary style={{ cursor: "pointer", fontSize: 14, fontWeight: 500, color: "var(--primary)" }}>Show worked answer</summary>
        <p className="serif" style={{ fontSize: 17, lineHeight: 1.55, marginTop: 8, color: "var(--body)" }}>
          <Md text={block.answer} />
        </p>
      </details>
    </section>
  );
}

type FigureProps = {
  block: Extract<Block, { kind: "figure" }>;
  url?: string;
  selected?: boolean;
  changed?: boolean;
  onSelect?: () => void;
  menu?: ReactNode;
};

/** A figure from the sources, or a picture Muse Image drew for the page (always labelled generated). */
export function FigureView({ block, url, selected, changed, onSelect, menu }: FigureProps) {
  return (
    <figure className={`figure${block.generated ? " generated" : ""}${selected ? " selected" : ""}${changed ? " changed" : ""}`} onClick={onSelect}>
      {url ? <img src={url} alt={block.caption} /> : block.generated ? <div className="figure-skeleton" role="img" aria-label="Loading picture" /> : null}
      <figcaption className="small muted">
        {block.caption}
        {block.generated ? " · drawn by Muse Image" : ""}
      </figcaption>
      {menu}
    </figure>
  );
}

export function HeroPlaceholder({ failed, message, onRetry }: { failed?: boolean; message?: string; onRetry?: () => void }) {
  if (failed) {
    return (
      <p className="small muted" style={{ margin: 0 }}>
        {message ? `No picture for this page yet: ${message}` : "No picture for this page yet."}{" "}
        <button type="button" className="link-btn" onClick={onRetry}>Try again</button>
      </p>
    );
  }
  return (
    <figure className="figure generated" aria-busy="true">
      <div className="figure-skeleton" />
      <figcaption className="small muted">Drawing a picture for this page with Muse Image…</figcaption>
    </figure>
  );
}
