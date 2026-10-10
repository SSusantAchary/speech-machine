import { describe, expect, it } from "vitest";
import { buildDocumentBlocks, findBestMatchingDocumentBlock, normalizeDocumentText } from "@/lib/documentReader";

describe("document reader utilities", () => {
  it("normalizes punctuation and casing for matching", () => {
    expect(normalizeDocumentText("Hello, WORLD!")).toBe("hello world");
  });

  it("splits source text into readable blocks", () => {
    const blocks = buildDocumentBlocks(`
      First paragraph with enough words to stay together for reading.

      Second paragraph. It has two sentences so it can still be highlighted clearly.
    `);

    expect(blocks.length).toBeGreaterThan(1);
    expect(blocks[0].index).toBe(0);
    expect(blocks[0].text).toContain("First paragraph");
  });

  it("finds the best forward document block from recent speech", () => {
    const blocks = buildDocumentBlocks(`
      Welcome to the introduction paragraph.

      This section explains the migration strategy and rollout details.

      Final section covers testing and cleanup.
    `);

    const nextIndex = findBestMatchingDocumentBlock(
      blocks,
      [{ startMs: 0, endMs: 1500, text: "This section explains the migration strategy in more detail" }],
      "",
      0
    );

    expect(nextIndex).toBe(1);
  });

  it("keeps the current block when no confident match exists", () => {
    const blocks = buildDocumentBlocks(`
      First block about metrics.

      Second block about transcript analysis.
    `);

    const nextIndex = findBestMatchingDocumentBlock(
      blocks,
      [{ startMs: 0, endMs: 1200, text: "Completely unrelated words here" }],
      "",
      0
    );

    expect(nextIndex).toBe(0);
  });
});
