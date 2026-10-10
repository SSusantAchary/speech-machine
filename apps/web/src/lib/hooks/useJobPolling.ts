import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";

export type JobStatus = "pending" | "queued" | "in_progress" | "complete" | "failed" | "not_found" | "unknown";

type JobState = {
  status: JobStatus;
  result: Record<string, unknown> | null;
  error: string | null;
};

type UseJobPollingOptions = {
  jobId: string | null;
  intervalMs?: number;
  onComplete?: (result: Record<string, unknown>) => void;
  onError?: (error: string) => void;
};

export function useJobPolling({
  jobId,
  intervalMs = 2000,
  onComplete,
  onError,
}: UseJobPollingOptions): JobState {
  const [state, setState] = useState<JobState>({ status: "pending", result: null, error: null });
  const onCompleteRef = useRef(onComplete);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onCompleteRef.current = onComplete;
    onErrorRef.current = onError;
  }, [onComplete, onError]);

  useEffect(() => {
    if (!jobId) return;
    let active = true;
    let interval: number | null = null;

    const poll = async () => {
      try {
        const data = await apiFetch<JobState>(`/jobs/${jobId}`);
        if (!active) return;
        setState(data);
        if (data.status === "complete") {
          if (interval) window.clearInterval(interval);
          onCompleteRef.current?.(data.result || {});
        }
        if (data.status === "failed") {
          if (interval) window.clearInterval(interval);
          onErrorRef.current?.(data.error || "Job failed.");
        }
      } catch (error) {
        if (!active) return;
        const message = error instanceof Error ? error.message : "Job polling failed.";
        setState({ status: "failed", result: null, error: message });
        onErrorRef.current?.(message);
      }
    };

    poll();
    interval = window.setInterval(poll, intervalMs);
    return () => {
      active = false;
      if (interval) window.clearInterval(interval);
    };
  }, [intervalMs, jobId]);

  return state;
}
