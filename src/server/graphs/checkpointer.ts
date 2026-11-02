import { MemorySaver } from "@langchain/langgraph-checkpoint";
import type { Checkpoint, CheckpointMetadata, PendingWrite } from "@langchain/langgraph-checkpoint";
import type { RunnableConfig } from "@langchain/core/runnables";

/** Where the saver persists its state (a Durable Object's SQLite in production). */
export interface CheckpointStore {
  load(): string | null;
  save(serialized: string): void;
}

const toB64 = (u: Uint8Array) => {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function encode(value: unknown): unknown {
  if (value instanceof Uint8Array) return { $u8: toB64(value) };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)]));
  return value;
}
function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === "object") {
    if ("$u8" in value) return fromB64((value as { $u8: string }).$u8);
    const out = Object.create(null) as Record<string, unknown>;
    for (const [k, v] of Object.entries(value)) out[k] = decode(v);
    return out;
  }
  return value;
}

const KEEP_PER_THREAD = 6;

/**
 * MemorySaver whose state is written through to durable storage after each
 * put/putWrites, so an interrupted graph (Keep / Undo) survives DO eviction.
 */
export class DurableSaver extends MemorySaver {
  constructor(private store: CheckpointStore) {
    super();
    const raw = store.load();
    if (raw) {
      const parsed = JSON.parse(raw) as { storage: unknown; writes: unknown };
      this.storage = decode(parsed.storage) as MemorySaver["storage"];
      this.writes = decode(parsed.writes) as MemorySaver["writes"];
    }
  }

  private persist() {
    // prune old checkpoints so storage stays small
    for (const threadId of Object.keys(this.storage)) {
      for (const ns of Object.keys(this.storage[threadId])) {
        const ids = Object.keys(this.storage[threadId][ns]).sort();
        for (const id of ids.slice(0, Math.max(0, ids.length - KEEP_PER_THREAD))) {
          delete this.storage[threadId][ns][id];
          delete this.writes[JSON.stringify([threadId, ns, id])];
        }
      }
    }
    this.store.save(JSON.stringify({ storage: encode(this.storage), writes: encode(this.writes) }));
  }

  override async put(config: RunnableConfig, checkpoint: Checkpoint, metadata: CheckpointMetadata): Promise<RunnableConfig> {
    const r = await super.put(config, checkpoint, metadata);
    this.persist();
    return r;
  }

  override async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string, taskPath?: string): Promise<void> {
    await super.putWrites(config, writes, taskId, taskPath);
    this.persist();
  }

  override async deleteThread(threadId: string): Promise<void> {
    await super.deleteThread(threadId);
    this.persist();
  }
}
