import { describe, expect, it } from "vitest";
import { countFillerMatches, splitTextByFillers } from "@/lib/fillers";

describe("filler helpers", () => {
  it("counts repeated filler words accurately", () => {
    expect(countFillerMatches("Um, um, you know, this is actually fine.")).toBe(4);
  });

  it("splits transcript text without using innerHTML", () => {
    const parts = splitTextByFillers("Actually, this is like a better example.");
    expect(parts.some((part) => part.isFiller && /actually/i.test(part.text))).toBe(true);
    expect(parts.some((part) => part.isFiller && /like/i.test(part.text))).toBe(true);
  });
});
