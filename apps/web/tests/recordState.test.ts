import { describe, expect, it } from "vitest";
import { useRecorderStore } from "@/store/useRecorderStore";

const getState = () => useRecorderStore.getState();

describe("recorder state machine", () => {
  it("transitions between statuses", () => {
    getState().setStatus("recording");
    expect(getState().status).toBe("recording");
    getState().setStatus("paused");
    expect(getState().status).toBe("paused");
    getState().setStatus("review");
    expect(getState().status).toBe("review");
  });
});
