// Groups positioned PDF text into regions (lines → paragraphs) with normalized bboxes.

export type TextItem = { str: string; x: number; y: number; width: number; height: number; fontSize: number };
export type Region = { text: string; bbox: [number, number, number, number]; fontSize: number };

type Line = { text: string; x0: number; x1: number; top: number; bottom: number; fontSize: number };

/**
 * `y` is PDF space (origin bottom-left, baseline). Output bbox is [x, y, w, h]
 * as fractions of the page with origin top-left, ready for CSS overlays.
 */
export function regionsFromItems(items: TextItem[], pageW: number, pageH: number): Region[] {
  const clean = items.filter((i) => i.str.trim().length > 0);
  if (!clean.length) return [];

  // 1. lines: items whose baselines are within half a font size
  const sorted = [...clean].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Line[] = [];
  for (const it of sorted) {
    const size = it.fontSize || it.height || 10;
    const top = pageH - (it.y + size);
    const bottom = pageH - it.y + size * 0.25;
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.bottom - bottom) < size * 0.5) {
      const gap = it.x - last.x1;
      last.text += gap > size * 0.15 && !last.text.endsWith(" ") && !it.str.startsWith(" ") ? ` ${it.str}` : it.str;
      last.x0 = Math.min(last.x0, it.x);
      last.x1 = Math.max(last.x1, it.x + it.width);
      last.top = Math.min(last.top, top);
      last.bottom = Math.max(last.bottom, bottom);
      last.fontSize = Math.max(last.fontSize, size);
    } else {
      lines.push({ text: it.str, x0: it.x, x1: it.x + it.width, top, bottom, fontSize: size });
    }
  }
  lines.sort((a, b) => a.top - b.top || a.x0 - b.x0);

  // 2. paragraphs: consecutive lines with a small vertical gap and similar font size
  const paras: Line[] = [];
  for (const ln of lines) {
    const last = paras[paras.length - 1];
    const gap = last ? ln.top - last.bottom : Infinity;
    const sameSize = last ? Math.abs(last.fontSize - ln.fontSize) / Math.max(last.fontSize, ln.fontSize) < 0.2 : false;
    const bullet = /^\s*([•\-–·▪◦*]|\d+[.)]|\(?[a-z]\))\s/.test(ln.text);
    if (last && sameSize && gap < ln.fontSize * 0.9 && !bullet) {
      last.text = last.text.endsWith("-") ? last.text.slice(0, -1) + ln.text.trimStart() : `${last.text} ${ln.text.trim()}`;
      last.x0 = Math.min(last.x0, ln.x0);
      last.x1 = Math.max(last.x1, ln.x1);
      last.bottom = Math.max(last.bottom, ln.bottom);
    } else {
      paras.push({ ...ln, text: ln.text.trim() });
    }
  }

  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  return paras.map((p) => {
    const x = clamp(p.x0 / pageW);
    const y = clamp(p.top / pageH);
    const w = clamp((p.x1 - p.x0) / pageW);
    const h = clamp((p.bottom - p.top) / pageH);
    return { text: p.text.replace(/\s+/g, " ").trim(), bbox: [round(x), round(y), round(w), round(h)] as [number, number, number, number], fontSize: p.fontSize };
  });
}

const round = (n: number) => Math.round(n * 10000) / 10000;

/** Merges tiny neighbouring regions so chunks carry enough meaning to embed and verify. */
export function mergeSmallRegions(regions: Region[], minChars = 60): Region[] {
  const out: Region[] = [];
  for (const r of regions) {
    const last = out[out.length - 1];
    if (last && (last.text.length < minChars || r.text.length < minChars / 2) && last.text.length + r.text.length < 900) {
      const x = Math.min(last.bbox[0], r.bbox[0]);
      const y = Math.min(last.bbox[1], r.bbox[1]);
      const x2 = Math.max(last.bbox[0] + last.bbox[2], r.bbox[0] + r.bbox[2]);
      const y2 = Math.max(last.bbox[1] + last.bbox[3], r.bbox[1] + r.bbox[3]);
      out[out.length - 1] = { text: `${last.text}\n${r.text}`, bbox: [round(x), round(y), round(x2 - x), round(y2 - y)], fontSize: Math.max(last.fontSize, r.fontSize) };
    } else out.push(r);
  }
  return out;
}
