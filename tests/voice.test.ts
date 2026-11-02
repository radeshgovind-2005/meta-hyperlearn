import { describe, expect, it } from "vitest";
import { toPcm16k } from "../src/client/lib/voice";
import { sentences } from "../src/client/lib/speech";

describe("toPcm16k", () => {
  it("downsamples 48 kHz to 16 kHz by averaging", () => {
    const f = new Float32Array([0.5, 0.5, 0.5, -1, -1, -1, 2, 2, 2]);
    expect(Array.from(toPcm16k(f, 48000))).toEqual([Math.trunc(0.5 * 0x7fff), -0x7fff, 0x7fff]);
  });
  it("keeps 16 kHz input length", () => {
    expect(toPcm16k(new Float32Array(2048), 16000).length).toBe(2048);
  });
  it("handles non-integer ratios like 44.1 kHz", () => {
    expect(toPcm16k(new Float32Array(4410), 44100).length).toBe(1600);
  });
});

describe("sentences", () => {
  it("splits on sentence ends and joins short pieces with the next", () => {
    expect(sentences("Power is P. It grows with V squared times f. So doubling f is costly!  Cooling fails.")).toEqual([
      "Power is P. It grows with V squared times f.",
      "So doubling f is costly! Cooling fails.",
    ]);
  });
  it("keeps decimals and lower-case continuations together", () => {
    expect(sentences("Speedup is 2.5 times. e.g. the serial part dominates when it is large enough to matter.")).toEqual(["Speedup is 2.5 times. e.g. the serial part dominates when it is large enough to matter."]);
  });
});
