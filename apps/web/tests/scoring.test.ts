import { describe, expect, it } from "vitest";
import { computeWpm, countFillers } from "@video/shared";

const segments = [
  { startMs: 0, endMs: 1000, text: "Um this is like a test." },
  { startMs: 1000, endMs: 2000, text: "Actually this is fine." },
];

describe("scoring utils", () => {
  it("counts fillers", () => {
    expect(countFillers(segments)).toBeGreaterThan(0);
  });

  it("computes wpm", () => {
    const wpm = computeWpm(30, 60000);
    expect(wpm).toBeCloseTo(30, 1);
  });
});
