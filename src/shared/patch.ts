import type { Block, PatchOp } from "./types";

export class PatchError extends Error {}

/**
 * Applies patch ops in order and returns a new block list.
 * Blocks that are not touched keep the same object identity, so their hash
 * (and their citations) stay byte-identical.
 */
export function applyPatch(blocks: readonly Block[], ops: readonly PatchOp[]): Block[] {
  const out = [...blocks];
  const indexOf = (id: string) => {
    const i = out.findIndex((b) => b.id === id);
    if (i < 0) throw new PatchError(`unknown block ${id}`);
    return i;
  };
  const assertNewId = (id: string) => {
    if (out.some((b) => b.id === id)) throw new PatchError(`duplicate block id ${id}`);
  };

  for (const op of ops) {
    switch (op.op) {
      case "replace": {
        const i = indexOf(op.blockId);
        if (op.block.id !== op.blockId) assertNewId(op.block.id);
        out[i] = op.block;
        break;
      }
      case "insertAfter": {
        assertNewId(op.block.id);
        // "^" inserts at the top of the section
        const i = op.blockId === "^" ? -1 : indexOf(op.blockId);
        out.splice(i + 1, 0, op.block);
        break;
      }
      case "remove": {
        out.splice(indexOf(op.blockId), 1);
        break;
      }
      case "move": {
        const [moved] = out.splice(indexOf(op.blockId), 1);
        const j = op.afterId === "^" ? -1 : indexOf(op.afterId);
        out.splice(j + 1, 0, moved);
        break;
      }
    }
  }
  return out;
}

/** Ops that turn `before` into `after`, used to stream small diffs to followers. */
export function diffBlocks(before: readonly Block[], after: readonly Block[], same: (a: Block, b: Block) => boolean): PatchOp[] {
  const ops: PatchOp[] = [];
  const afterIds = new Set(after.map((b) => b.id));
  for (const b of before) if (!afterIds.has(b.id)) ops.push({ op: "remove", blockId: b.id });
  const beforeById = new Map(before.map((b) => [b.id, b]));
  let prev = "^";
  for (const b of after) {
    const old = beforeById.get(b.id);
    if (!old) ops.push({ op: "insertAfter", blockId: prev, block: b });
    else if (!same(old, b)) ops.push({ op: "replace", blockId: b.id, block: b });
    prev = b.id;
  }
  // order fix-ups: compare the order of surviving ids
  const working = applyPatch(before, ops);
  const want = after.map((b) => b.id);
  prev = "^";
  for (let i = 0; i < want.length; i++) {
    if (working[i]?.id !== want[i]) {
      ops.push({ op: "move", blockId: want[i], afterId: prev });
      const [m] = working.splice(working.findIndex((b) => b.id === want[i]), 1);
      working.splice(i, 0, m);
    }
    prev = want[i];
  }
  return ops;
}

/** Stable JSON so equal blocks always hash the same. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export async function hashBlock(block: Block): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(block));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
