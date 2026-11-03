import { Fragment, type ReactNode } from "react";

/**
 * Minimal inline markdown for course text: **bold**, *italic*, `code`, $math$, and
 * line breaks. Builds React nodes; never injects HTML.
 */
export function Md({ text }: { text: string }) {
  const lines = text.split(/\n/);
  const out: ReactNode[] = [];
  let i = 0;
  let afterTable = false;
  while (i < lines.length) {
    const table = readTable(lines, i);
    if (table) {
      out.push(<MdTable key={`t${i}`} head={table.head} rows={table.rows} />);
      i = table.next;
      afterTable = true;
      continue;
    }
    if (out.length && !afterTable) out.push(<br key={`br${i}`} />);
    afterTable = false;
    out.push(<Fragment key={i}>{inline(lines[i])}</Fragment>);
    i++;
  }
  return <>{out}</>;
}

const cells = (ln: string) => ln.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const isRow = (ln: string | undefined) => ln !== undefined && /^\s*\|.*\|\s*$/.test(ln);
const isRule = (ln: string | undefined) => isRow(ln) && cells(ln!).every((c) => /^:?-{2,}:?$/.test(c));

/** A markdown table: a header row, a |---| rule, then body rows. Returns null when the lines are not one. */
function readTable(lines: string[], at: number): { head: string[]; rows: string[][]; next: number } | null {
  if (!isRow(lines[at]) || !isRule(lines[at + 1])) return null;
  const rows: string[][] = [];
  let next = at + 2;
  while (isRow(lines[next]) && !isRule(lines[next])) rows.push(cells(lines[next++]));
  return { head: cells(lines[at]), rows, next };
}

function MdTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <span className="md-table-wrap">
      <table className="md-table">
        <thead>
          <tr>{head.map((h, c) => <th key={c} scope="col">{inline(h)}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>{head.map((_, c) => (c === 0 ? <th key={c} scope="row">{inline(r[c] ?? "")}</th> : <td key={c}>{inline(r[c] ?? "")}</td>))}</tr>
          ))}
        </tbody>
      </table>
    </span>
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
