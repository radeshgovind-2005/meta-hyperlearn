import "../src/server/graphs/als";
import { describe, expect, it } from "vitest";
import { Annotation, Command, END, START, StateGraph, interrupt } from "@langchain/langgraph";
import { DurableSaver, type CheckpointStore } from "../src/server/graphs/checkpointer";

const State = Annotation.Root({
  text: Annotation<string>(),
  decision: Annotation<string>(),
});

function build(saver: DurableSaver) {
  return new StateGraph(State)
    .addNode("write", async (s) => ({ text: s.text.toUpperCase() }))
    .addNode("ask", async () => ({ decision: interrupt({ question: "keep?" }) as string }))
    .addNode("commit", async (s) => ({ text: s.decision === "keep" ? `${s.text}!` : "undone" }))
    .addEdge(START, "write")
    .addEdge("write", "ask")
    .addEdge("ask", "commit")
    .addEdge("commit", END)
    .compile({ checkpointer: saver });
}

describe("LangGraph in the Workers runtime", () => {
  it("interrupts, persists, and resumes from a fresh saver", async () => {
    let saved: string | null = null;
    const store: CheckpointStore = { load: () => saved, save: (s) => { saved = s; } };
    const config = { configurable: { thread_id: "run_1" } };

    const first = (await build(new DurableSaver(store)).invoke({ text: "hi" }, config)) as { __interrupt__?: { value: unknown }[] };
    expect(first.__interrupt__?.[0]?.value).toEqual({ question: "keep?" });
    expect(saved).toBeTruthy();

    // a new saver (as after DO eviction) restores from storage
    const resumed = await build(new DurableSaver(store)).invoke(new Command({ resume: "keep" }), config);
    expect(resumed.text).toBe("HI!");
  });
});
