// Course text may carry a formula on its own line and a legend that says what each symbol is:
//
//   Speedup compares the one-processor time with the p-processor time.
//   $$S(p) = \frac{T_1}{T_p}$$
//   where:
//   - $T_1$ is the execution time on one processor
//   - $T_p$ is the execution time on p processors
//
// These helpers keep that shape stable between the writers, the verifier and the reader.

const DISPLAY_LINE = /^\s*\$\$(.+)\$\$\s*$/;

/** Rewrites \[...\] and \(...\) to $$...$$ and $...$ and puts every display formula on a line of its own. */
export function normalizeMath(md: string): string {
  const s = md
    .replace(/\s*\\\[([\s\S]+?)\\\]\s*/g, (_, m: string) => `\n$$${m.replace(/\s+/g, " ").trim()}$$\n`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, m: string) => `$${m.replace(/\s+/g, " ").trim()}$`)
    .replace(/\s*\$\$([\s\S]+?)\$\$\s*/g, (_, m: string) => `\n$$${m.replace(/\s+/g, " ").trim()}$$\n`);
  return s
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The formula of a display line, or null when the line is not one. */
export function displayMath(line: string): string | null {
  return DISPLAY_LINE.exec(line)?.[1].trim() ?? null;
}

/** "- item" or "* item" → "item". */
export function bulletText(line: string): string | null {
  return /^\s*[-*]\s+(.+)$/.exec(line)?.[1] ?? null;
}

/** True when the text carries a formula worth setting on its own line. */
export function hasFormula(md: string): boolean {
  return /\$\$|\\frac|\\sum|\\int|\\sqrt|\$[^$]*[=<>≤≥][^$]*\$|[A-Za-z]\w*(?:\([^)]*\))?\s=\s[^,.]*[A-Za-z0-9)]\s*[/*^+-]\s*[A-Za-z0-9(]/.test(md);
}
