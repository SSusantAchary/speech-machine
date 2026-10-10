import { create } from "zustand";
import type { MetricsPoint, TranscriptSegment } from "@video/shared";

export type RecorderStatus = "idle" | "recording" | "paused" | "stopped" | "review" | "saving";

type RecorderState = {
  status: RecorderStatus;
  chunks: Blob[];
  transcript: TranscriptSegment[];
  metrics: MetricsPoint[];
  prompt: string;
  mode: string;
  goal: string;
  durationMs: number;
  setStatus: (status: RecorderStatus) => void;
  addChunk: (chunk: Blob) => void;
  setChunks: (chunks: Blob[]) => void;
  resetChunks: () => void;
  addTranscriptSegment: (segment: TranscriptSegment) => void;
  setTranscript: (segments: TranscriptSegment[]) => void;
  addMetric: (point: MetricsPoint) => void;
  setMetrics: (points: MetricsPoint[]) => void;
  setPrompt: (prompt: string) => void;
  setMode: (mode: string) => void;
  setGoal: (goal: string) => void;
  setDurationMs: (duration: number) => void;
  reset: () => void;
};

export const useRecorderStore = create<RecorderState>((set) => ({
  status: "idle",
  chunks: [],
  transcript: [],
  metrics: [],
  prompt: "Tell me about a time you solved a hard problem.",
  mode: "Interview",
  goal: "Reduce fillers",
  durationMs: 0,
  setStatus: (status) => set({ status }),
  addChunk: (chunk) => set((state) => ({ chunks: [...state.chunks, chunk] })),
  setChunks: (chunks) => set({ chunks }),
  resetChunks: () => set({ chunks: [] }),
  addTranscriptSegment: (segment) =>
    set((state) => ({ transcript: [...state.transcript, segment] })),
  setTranscript: (transcript) => set({ transcript }),
  addMetric: (point) => set((state) => ({ metrics: [...state.metrics, point] })),
  setMetrics: (metrics) => set({ metrics }),
  setPrompt: (prompt) => set({ prompt }),
  setMode: (mode) => set({ mode }),
  setGoal: (goal) => set({ goal }),
  setDurationMs: (durationMs) => set({ durationMs }),
  reset: () =>
    set({
      status: "idle",
      chunks: [],
      transcript: [],
      metrics: [],
      durationMs: 0,
    }),
}));
