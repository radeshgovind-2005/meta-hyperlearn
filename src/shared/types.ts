import { z } from "zod";

export const CiteSchema = z.object({
  sourceId: z.string(),
  page: z.number().int().positive().optional(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  tStart: z.number().nonnegative().optional(),
  tEnd: z.number().nonnegative().optional(),
  chunkId: z.string().optional(),
});
export type Cite = z.infer<typeof CiteSchema>;

export const WidgetTemplate = z.enum(["vector2d", "plot", "stepper", "simulator"]);

export const WidgetSpecSchema = z.union([
  z.object({
    template: WidgetTemplate,
    title: z.string().optional(),
    params: z.record(z.string(), z.unknown()),
    claims: z.array(z.string()),
  }),
  z.object({
    template: z.literal("custom"),
    title: z.string().optional(),
    html: z.string(),
    claims: z.array(z.string()),
  }),
]);
export type WidgetSpec = z.infer<typeof WidgetSpecSchema>;

export const TextBlockSchema = z.object({
  id: z.string(),
  kind: z.literal("text"),
  md: z.string(),
  cites: z.array(CiteSchema),
  origin: z.enum(["source", "rephrased"]),
});
export const FigureBlockSchema = z.object({
  id: z.string(),
  kind: z.literal("figure"),
  r2Key: z.string(),
  caption: z.string(),
  cites: z.array(CiteSchema),
  generated: z.boolean().optional(),
});
export const WidgetBlockSchema = z.object({
  id: z.string(),
  kind: z.literal("widget"),
  spec: WidgetSpecSchema,
  cites: z.array(CiteSchema),
});
export const ExerciseBlockSchema = z.object({
  id: z.string(),
  kind: z.literal("exercise"),
  prompt: z.string(),
  answer: z.string(),
  styleOf: z.string().optional(),
  cites: z.array(CiteSchema),
});

export const BlockSchema = z.discriminatedUnion("kind", [
  TextBlockSchema,
  FigureBlockSchema,
  WidgetBlockSchema,
  ExerciseBlockSchema,
]);
export type Block = z.infer<typeof BlockSchema>;
export type TextBlock = z.infer<typeof TextBlockSchema>;
export type WidgetBlock = z.infer<typeof WidgetBlockSchema>;

export const PatchOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("replace"), blockId: z.string(), block: BlockSchema }),
  z.object({ op: z.literal("insertAfter"), blockId: z.string(), block: BlockSchema }),
  z.object({ op: z.literal("remove"), blockId: z.string() }),
  z.object({ op: z.literal("move"), blockId: z.string(), afterId: z.string() }),
]);
export type PatchOp = z.infer<typeof PatchOpSchema>;

export type Section = { id: string; courseId: string; version: number; title: string; blocks: Block[] };

/** Events streamed from a running graph to the client. */
export type RunEvent =
  | { type: "run.start"; runId: string; graph: string; steps: string[] }
  | { type: "run.step"; runId: string; index: number; label: string; status: "active" | "done" | "failed"; detail?: string }
  | { type: "patch"; runId: string; sectionId: string; ops: PatchOp[] }
  | { type: "run.waiting"; runId: string; summary: string[]; section: Section; before: Section }
  | { type: "run.done"; runId: string; status: "kept" | "undone" | "done" | "failed"; courseVersion?: number; message?: string }
  | { type: "course.version"; courseId: string; version: number; summary: string };

export type TraceEntry = { label: string; detail?: string; model?: string; ms?: number; ok?: boolean };
