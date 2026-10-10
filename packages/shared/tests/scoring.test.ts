import { describe, expect, it } from "vitest";
import { computeScore } from "../src/scoring";
import type { SessionInput } from "../src/types";

const sample: SessionInput = {
  durationMs: 120000,
  transcript: [
    { startMs: 0, endMs: 5000, text: "First, I want to share why this matters." },
    { startMs: 5000, endMs: 10000, text: "Because we can reduce costs and improve outcomes." },
  ],
  metrics: [
    { t: 0, wpm: 140, rms: 60, eyeContact: 0.75, smile: 0.5, yaw: 1, pitch: 1, roll: 1, fillerCount: 0, pauseMs: 900 },
    { t: 1, wpm: 135, rms: 62, eyeContact: 0.8, smile: 0.55, yaw: 1.5, pitch: 1.1, roll: 1.2, fillerCount: 0, pauseMs: 0 },
  ],
  targetKeywords: ["costs", "outcomes"],
};

describe("computeScore", () => {
  it("returns a bounded score", () => {
    const score = computeScore(sample);
    expect(score.total).toBeGreaterThan(0);
    expect(score.total).toBeLessThanOrEqual(100);
    expect(score.topFixes.length).toBeLessThanOrEqual(3);
  });
});
