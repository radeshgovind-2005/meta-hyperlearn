import type { Block } from "./types";

export type FigureBlock = Extract<Block, { kind: "figure" }>;

/** The picture at the top of a page: a generated figure that is the first block. */
export function heroOf(blocks: Block[]): FigureBlock | null {
  const first = blocks[0];
  return first && first.kind === "figure" && first.generated ? first : null;
}

/** Puts `hero` first, replacing an existing hero so a page never has two. */
export function withHero(blocks: Block[], hero: FigureBlock): Block[] {
  return [hero, ...(heroOf(blocks) ? blocks.slice(1) : blocks)];
}

/** Sections made only of a review exercise or nothing to illustrate get no picture. */
export function canIllustrate(blocks: Block[]): boolean {
  return blocks.some((b) => b.kind === "text");
}
