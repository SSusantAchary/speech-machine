import { useEffect, useRef, useState } from "react";
import type { TranscriptSegment } from "@video/shared";
import { countFillerMatches } from "@/lib/fillers";

type SpeechState = {
  supported: boolean;
  listening: boolean;
  transcript: TranscriptSegment[];
  partial: string;
  fillerCount: number;
  wpm: number;
  avgWpm: number;
};

export const useSpeechRecognition = (enabled: boolean) => {
  const [state, setState] = useState<SpeechState>({
    supported: false,
    listening: false,
    transcript: [],
    partial: "",
    fillerCount: 0,
    wpm: 0,
    avgWpm: 0,
  });
  const startTimeRef = useRef<number>(0);
  const totalWordsRef = useRef(0);
  const wordWindowRef = useRef<{ t: number; words: number }[]>([]);

  useEffect(() => {
    const SpeechRecognition =
      typeof window !== "undefined"
        ? window.SpeechRecognition || window.webkitSpeechRecognition
        : undefined;

    if (!SpeechRecognition) {
      setState((prev) => ({ ...prev, supported: false, listening: false }));
      return;
    }

    if (!enabled) {
      setState((prev) => ({ ...prev, supported: true, listening: false, partial: "" }));
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      startTimeRef.current = performance.now();
      totalWordsRef.current = 0;
      wordWindowRef.current = [];
      setState((prev) => ({ ...prev, listening: true, supported: true }));
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let partial = "";
      const now = performance.now();
      const segments: TranscriptSegment[] = [];

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0].transcript.trim();
        if (result.isFinal) {
          const startMs = Math.max(0, Math.round(now - startTimeRef.current - 1500));
          const endMs = Math.round(now - startTimeRef.current);
          segments.push({ startMs, endMs, text });
          const words = text.trim().split(/\s+/).filter(Boolean).length;
          totalWordsRef.current += words;
          wordWindowRef.current.push({ t: now, words });
        } else {
          partial = text;
        }
      }

      const fifteenSecondsAgo = now - 15000;
      wordWindowRef.current = wordWindowRef.current.filter((w) => w.t >= fifteenSecondsAgo);
      const windowWords = wordWindowRef.current.reduce((acc, w) => acc + w.words, 0);
      const wpm = Math.round(windowWords * 4);
      const elapsedMinutes = Math.max((now - startTimeRef.current) / 60000, 0.1);
      const avgWpm = Math.round(totalWordsRef.current / elapsedMinutes);

      setState((prev) => {
        const fillerCount =
          prev.fillerCount + segments.reduce((count, segment) => count + countFillerMatches(segment.text), 0);
        return {
          ...prev,
          transcript: [...prev.transcript, ...segments],
          partial,
          fillerCount,
          wpm,
          avgWpm,
        };
      });
    };

    recognition.onend = () => setState((prev) => ({ ...prev, listening: false }));

    recognition.start();

    return () => {
      recognition.stop();
    };
  }, [enabled]);

  return state;
};
