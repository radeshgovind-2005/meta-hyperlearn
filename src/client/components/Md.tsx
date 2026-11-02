import { Fragment, type ReactNode } from "react";

/**
 * Minimal inline markdown for course text: **bold**, *italic*, `code`, $math$, and
 * line breaks. Builds React nodes; never injects HTML.
 */
export function Md({ text }: { text: string }) {
  const lines = text.split(/\n/);
  return (
    <>
      {lines.map((ln, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {inline(ln)}
        </Fragment>
      ))}
    </>
  );
}

function inline(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\$[^$]+\$|_[^_\s][^_]*_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) out.push(<strong key={k++}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k++} style={{ fontSize: "0.9em" }}>{t.slice(1, -1)}</code>);
    else if (t.startsWith("$")) out.push(<span key={k++} style={{ fontStyle: "italic" }}>{texish(t.slice(1, -1))}</span>);
    else out.push(<em key={k++}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

const SYMBOLS: Record<string, string> = {
  lambda: "λ", Lambda: "Λ", mu: "μ", sigma: "σ", theta: "θ", alpha: "α", beta: "β", pi: "π", cdot: "·", times: "×", neq: "≠", ne: "≠", leq: "≤", geq: "≥", to: "→", rightarrow: "→", in: "∈", infty: "∞", sum: "Σ", det: "det", mathbf: "", vec: "", quad: " ", ldots: "…", dots: "…", approx: "≈", pm: "±", sqrt: "√",
};

/** Turns light LaTeX into readable Unicode (λ, ², ≠, …). */
export function texish(s: string): string {
  return s
    .replace(/\\(begin|end)\{[a-z]*matrix\}/g, "")
    .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, "($1)/($2)")
    .replace(/\\([a-zA-Z]+)/g, (_, w: string) => SYMBOLS[w] ?? w)
    .replace(/\^\{?2\}?/g, "²")
    .replace(/\^\{?3\}?/g, "³")
    .replace(/_\{?([0-9a-z])\}?/g, (_, d: string) => "₀₁₂₃₄₅₆₇₈₉".charAt(Number(d)) || `_${d}`)
    .replace(/[{}]/g, "")
    .replace(/\\\\/g, "; ")
    .replace(/&/g, " ");
}
