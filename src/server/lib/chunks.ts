import type { Env } from "../env";
import type { Cite } from "../../shared/types";
import { embed } from "../ai/embed";
import { count, exhausted, keys } from "./quota";

export type ChunkRow = { id: string; source_id: string; ord: number; text: string; page: number | null; bbox: string | null; t_start: number | null; t_end: number | null; section_path: string | null };

export async function getChunks(env: Env, ids: string[]): Promise<ChunkRow[]> {
  const uniq = [...new Set(ids)].filter(Boolean);
  if (!uniq.length) return [];
  const out: ChunkRow[] = [];
  for (let i = 0; i < uniq.length; i += 80) {
    const part = uniq.slice(i, i + 80);
    const { results } = await env.DB.prepare(`SELECT * FROM chunks WHERE id IN (${part.map(() => "?").join(",")})`).bind(...part).all<ChunkRow>();
    out.push(...results);
  }
  const order = new Map(uniq.map((id, k) => [id, k]));
  return out.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

export function chunkToCite(c: ChunkRow): Cite {
  return {
    sourceId: c.source_id,
    chunkId: c.id,
    ...(c.page ? { page: c.page } : {}),
    ...(c.bbox ? { bbox: JSON.parse(c.bbox) as [number, number, number, number] } : {}),
    ...(c.t_start !== null ? { tStart: c.t_start } : {}),
    ...(c.t_end !== null ? { tEnd: c.t_end } : {}),
  };
}

/** Evidence text for a set of cites: exact chunks when known, else the whole cited page / time range. */
export async function evidenceForCites(env: Env, cites: Cite[]): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of cites) {
    const key = c.chunkId ?? `${c.sourceId}:${c.page ?? ""}:${c.tStart ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (c.chunkId) {
      const [row] = await getChunks(env, [c.chunkId]);
      if (row) out.push(row.text);
    } else if (c.page) {
      const { results } = await env.DB.prepare("SELECT text FROM chunks WHERE source_id = ? AND page = ? ORDER BY ord").bind(c.sourceId, c.page).all<{ text: string }>();
      out.push(results.map((r) => r.text).join("\n"));
    } else if (c.tStart !== undefined) {
      const { results } = await env.DB.prepare("SELECT text FROM chunks WHERE source_id = ? AND t_end >= ? AND t_start <= ? ORDER BY ord")
        .bind(c.sourceId, c.tStart, c.tEnd ?? c.tStart + 30)
        .all<{ text: string }>();
      out.push(results.map((r) => r.text).join(" "));
    }
  }
  return out.filter(Boolean);
}

/** Semantic search over the given sources. */
export async function searchChunks(env: Env, query: string, sourceIds: string[], topK = 8): Promise<ChunkRow[]> {
  if (!sourceIds.length) return [];
  // over the free search allowance we degrade to "no extra context" rather than failing
  if (await exhausted(env, ["vectorQueries", "ai"])) return [];
  count(keys.vectorQueries());
  const [vector] = await embed(env, [query]);
  const res = await env.VECTORS.query(vector, { topK, filter: { sourceId: { $in: sourceIds } }, returnMetadata: "none" });
  return getChunks(env, res.matches.map((m) => m.id));
}

export async function chunksForPages(env: Env, sourceId: string, pages: number[]): Promise<ChunkRow[]> {
  if (!pages.length) return [];
  const { results } = await env.DB.prepare(`SELECT * FROM chunks WHERE source_id = ? AND page IN (${pages.map(() => "?").join(",")}) ORDER BY ord`)
    .bind(sourceId, ...pages)
    .all<ChunkRow>();
  return results;
}

export function formatChunksForPrompt(chunks: ChunkRow[], label: (c: ChunkRow) => string): string {
  return chunks.map((c) => `<chunk id="${c.id}" from="${label(c).replace(/"/g, "'")}">\n${c.text}\n</chunk>`).join("\n");
}
