import type { MetricsPoint, TranscriptSegment } from "@video/shared";
import { apiFetch } from "@/lib/api";
import type { DocumentBlock } from "@/lib/documentReader";

export type SessionPayload = {
  title?: string;
  mode: string;
  prompt: string;
  goal: string;
  durationMs: number;
  wpmAvg: number;
  fillerCount: number;
  eyeContactPct: number;
  transcript: TranscriptSegment[];
  metrics: MetricsPoint[];
  tags?: string[];
  score?: Record<string, unknown>;
};

export type TranscriptionSelection = {
  backend?: string;
  model?: string;
};

export type TranscriptionJobResponse = {
  status: string;
  job_id?: string;
};

export type SessionDocumentPayload = {
  file: Blob;
  name: string;
  mimeType: string;
  blocks: DocumentBlock[];
};

export const mergeChunks = (chunks: Blob[], mimeType?: string) =>
  new Blob(chunks, { type: mimeType || chunks[0]?.type || "video/webm" });

export const getVideoDurationMs = (file: Blob) =>
  new Promise<number>((resolve) => {
    if (typeof document === "undefined") {
      resolve(0);
      return;
    }

    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : 0;
      URL.revokeObjectURL(url);
      resolve(duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(0);
    };
    video.src = url;
  });

export const createSession = (payload: SessionPayload) =>
  apiFetch<{ id: number }>("/sessions", {
    method: "POST",
    body: JSON.stringify({
      title: payload.title,
      mode: payload.mode,
      prompt: payload.prompt,
      goal: payload.goal,
      duration_ms: payload.durationMs,
      wpm_avg: payload.wpmAvg,
      filler_count: payload.fillerCount,
      eye_contact_pct: payload.eyeContactPct,
      transcript_segments: payload.transcript.map((seg) => ({
        start_ms: seg.startMs,
        end_ms: seg.endMs,
        text: seg.text,
      })),
      metrics: payload.metrics.map((point) => ({
        t: point.t,
        wpm: point.wpm,
        rms: point.rms,
        eye_contact: point.eyeContact,
        smile: point.smile,
        yaw: point.yaw,
        pitch: point.pitch,
        roll: point.roll,
        filler_count: point.fillerCount,
        pause_ms: point.pauseMs,
      })),
      tags: payload.tags || [],
      score: payload.score,
    }),
  });

const resolveRecordingFormat = (mimeType?: string) => {
  if (mimeType?.includes("mp4")) {
    return { extension: "mp4", mimeType };
  }
  if (mimeType?.includes("webm")) {
    return { extension: "webm", mimeType };
  }
  return { extension: "webm", mimeType: mimeType || "video/webm" };
};

const buildUploadQuery = (params: Record<string, string | number>) =>
  new URLSearchParams(
    Object.entries(params).reduce<Record<string, string>>((acc, [key, value]) => {
      acc[key] = String(value);
      return acc;
    }, {})
  ).toString();

export const uploadChunks = async (sessionId: number, chunks: Blob[], mimeType?: string) => {
  const format = resolveRecordingFormat(mimeType || chunks[0]?.type);
  const uploadId = `${sessionId}-${Date.now()}`;
  for (let i = 0; i < chunks.length; i += 1) {
    const formData = new FormData();
    formData.append("file", chunks[i], `chunk-${i}.${format.extension}`);
    await apiFetch(
      `/sessions/${sessionId}/upload?${buildUploadQuery({
        chunk_index: i,
        total_chunks: chunks.length,
        upload_id: uploadId,
        mime_type: format.mimeType,
      })}`,
      {
        method: "POST",
        body: formData,
      }
    );
  }
};

export const uploadVideoFile = async (sessionId: number, file: File, chunkSize = 2 * 1024 * 1024) => {
  const format = resolveRecordingFormat(file.type || file.name);
  if (file.size <= chunkSize) {
    const formData = new FormData();
    formData.append("file", file, file.name || `upload.${format.extension}`);
    await apiFetch(`/sessions/${sessionId}/upload`, {
      method: "POST",
      body: formData,
    });
    return;
  }

  const uploadId = `${sessionId}-${Date.now()}`;
  const totalChunks = Math.ceil(file.size / chunkSize);
  for (let index = 0; index < totalChunks; index += 1) {
    const formData = new FormData();
    const start = index * chunkSize;
    const end = Math.min(file.size, start + chunkSize);
    formData.append("file", file.slice(start, end, file.type), `chunk-${index}.${format.extension}`);
    await apiFetch(
      `/sessions/${sessionId}/upload?${buildUploadQuery({
        chunk_index: index,
        total_chunks: totalChunks,
        upload_id: uploadId,
        mime_type: format.mimeType,
      })}`,
      {
        method: "POST",
        body: formData,
      }
    );
  }
};

export const triggerTranscription = (sessionId: number, selection?: TranscriptionSelection) =>
  apiFetch<TranscriptionJobResponse>(`/sessions/${sessionId}/transcribe`, {
    method: "POST",
    body: selection ? JSON.stringify(selection) : undefined,
  });

export const uploadSessionDocument = async (sessionId: number, document: SessionDocumentPayload) => {
  const formData = new FormData();
  formData.append("file", document.file, document.name);
  formData.append("blocks_json", JSON.stringify(document.blocks));
  return apiFetch(`/sessions/${sessionId}/document`, {
    method: "POST",
    body: formData,
  });
};

export const deleteSession = (sessionId: number) =>
  apiFetch(`/sessions/${sessionId}`, {
    method: "DELETE",
  });
