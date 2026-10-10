"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { computeScore } from "@video/shared";
import type { MetricsPoint } from "@video/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Toggle } from "@/components/ui/toggle";
import { Select } from "@/components/ui/select";
import { useMediaDevices } from "@/lib/hooks/useMediaDevices";
import { useMediaRecorder } from "@/lib/hooks/useMediaRecorder";
import { useSpeechRecognition } from "@/lib/hooks/useSpeechRecognition";
import { useAudioAnalyzer } from "@/lib/hooks/useAudioAnalyzer";
import { useFaceLandmarker } from "@/lib/hooks/useFaceLandmarker";
import { useRequireAuth } from "@/lib/hooks/useRequireAuth";
import { useTranscriptionModel } from "@/lib/hooks/useTranscriptionModel";
import { PROMPTS } from "@/lib/prompts";
import { createSession, deleteSession, mergeChunks, triggerTranscription, uploadChunks, uploadSessionDocument } from "@/lib/session";
import { isSafariBrowser } from "@/lib/browser";
import { clearActiveDraft, createDraftId, loadActiveDraft, persistActiveDraft } from "@/lib/sessionDraft";
import { useRecorderStore } from "@/store/useRecorderStore";
import { AudioTranscriptionPanel } from "@/components/audio-transcription-panel";
import { DocumentReaderPanel } from "@/components/document-reader-panel";
import { findBestMatchingDocumentBlock, parseReadableDocument, type RecorderDocument } from "@/lib/documentReader";

const formatTime = (ms: number) => {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

export default function RecordPage() {
  useRequireAuth();
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playbackRef = useRef<HTMLVideoElement | null>(null);
  const [videoDeviceId, setVideoDeviceId] = useState<string | undefined>(undefined);
  const [audioDeviceId, setAudioDeviceId] = useState<string | undefined>(undefined);
  const [showPrompt, setShowPrompt] = useState(true);
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [finalizingStop, setFinalizingStop] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveredDraftAt, setRecoveredDraftAt] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [isSafari, setIsSafari] = useState(false);
  const [promptSpeed, setPromptSpeed] = useState("1x");
  const [pitchVariance, setPitchVariance] = useState(0);
  const pitchHistoryRef = useRef<number[]>([]);
  const startTimeRef = useRef<number>(0);
  const autoStartRef = useRef(false);
  const deviceChangeRef = useRef(false);
  const lastRestartRef = useRef<number>(0);
  const previewRetryRef = useRef(0);
  const clearedStaleSessionRef = useRef(false);
  const [debugInfo, setDebugInfo] = useState<string[]>([]);
  const [routeReady, setRouteReady] = useState(false);
  const [safeMode, setSafeMode] = useState(false);
  const [readingDocument, setReadingDocument] = useState<RecorderDocument | null>(null);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [parsingDocument, setParsingDocument] = useState(false);
  const [activeDocumentBlockIndex, setActiveDocumentBlockIndex] = useState(-1);
  const transcriptionModel = useTranscriptionModel();

  const {
    status,
    chunks,
    prompt,
    mode,
    goal,
    transcript,
    metrics,
    durationMs,
    setStatus,
    addChunk,
    setChunks,
    setPrompt,
    setMode,
    setGoal,
    setTranscript,
    addMetric,
    setMetrics,
    setDurationMs,
    reset,
  } = useRecorderStore();

  const devices = useMediaDevices(routeReady && !safeMode);

  const recorder = useMediaRecorder({
    videoDeviceId,
    audioDeviceId,
    onChunk: (chunk) => {
      addChunk(chunk);
    },
  });

  const speech = useSpeechRecognition(routeReady && !safeMode && status === "recording");
  const audio = useAudioAnalyzer(
    routeReady && !safeMode ? recorder.stream : null,
    routeReady && !safeMode && status === "recording"
  );
  const face = useFaceLandmarker(
    routeReady && !safeMode ? videoRef.current : null,
    routeReady && !safeMode && status === "recording"
  );
  const audioRef = useRef(audio);
  const faceRef = useRef(face);
  const speechRef = useRef(speech);
  const chunksRef = useRef(chunks);

  useEffect(() => {
    audioRef.current = audio;
  }, [audio]);

  useEffect(() => {
    faceRef.current = face;
  }, [face]);

  useEffect(() => {
    speechRef.current = speech;
  }, [speech]);

  useEffect(() => {
    chunksRef.current = chunks;
  }, [chunks]);

  const restartPreview = useCallback(
    async (message?: string, force = false) => {
      if (status === "recording" || status === "paused") return;
      if (!force && !cameraOn && !micOn) return;
      if (document.visibilityState !== "visible") return;
      if (!routeReady) return;
      if (safeMode) {
        if (message) {
          setError(message);
        }
        return;
      }
      if (isSafariBrowser() && !force) {
        if (message) {
          setError(message);
        }
        return;
      }
      if (previewRetryRef.current >= 2 && !force) {
        if (message) setError(message);
        return;
      }
      const now = Date.now();
      if (now - lastRestartRef.current < 1500) return;
      lastRestartRef.current = now;
      if (!force) {
        previewRetryRef.current += 1;
      }
      if (message) {
        setError(message);
      }
      recorder.stopStream();
      try {
        await recorder.startStream();
        setError(null);
      } catch (_err) {
        setError("Camera or microphone unavailable. Check permissions and retry.");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cameraOn, micOn, recorder.startStream, recorder.stopStream, routeReady, safeMode, status]
  );

  useEffect(() => {
    setIsSafari(isSafariBrowser());
    if (typeof window !== "undefined") {
      setSafeMode(new URLSearchParams(window.location.search).get("safe") === "1");
    }
    setRouteReady(true);
  }, []);

  useEffect(() => {
    if (!routeReady || safeMode) return;
    if (videoRef.current && recorder.stream) {
      videoRef.current.srcObject = recorder.stream;
      videoRef.current.play().catch(() => {});
    }
  }, [recorder.stream, recorder.error, routeReady, safeMode]);

  useEffect(() => {
    if (!recorder.stream) return;
    previewRetryRef.current = 0;
  }, [recorder.stream]);

  useEffect(() => {
    if (autoStartRef.current) return;
    if (!cameraOn && !micOn) return;
    if (!routeReady) return;
    if (safeMode) return;
    if (isSafariBrowser()) return;
    recorder
      .startStream()
      .then(() => {
        autoStartRef.current = true;
      })
      .catch(() => {
        setError("Camera or microphone blocked. Click Camera/Mic to retry.");
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOn, micOn, recorder.startStream, routeReady, safeMode]);

  useEffect(() => {
    if (!deviceChangeRef.current) {
      deviceChangeRef.current = true;
      return;
    }
    restartPreview("Updating camera or microphone...");
  }, [audioDeviceId, restartPreview, videoDeviceId]);

  useEffect(() => {
    if (!recorder.stream || status === "recording" || status === "paused") return;
    if (!cameraOn) return;
    const videoTrack = recorder.stream.getVideoTracks()[0];
    if (!videoTrack || videoTrack.readyState === "ended") {
      restartPreview("Camera stream ended. Reconnecting...");
    }
  }, [cameraOn, recorder.stream, restartPreview, status]);

  useEffect(() => {
    if (!recorder.stream || status === "recording" || status === "paused") return;
    if (!cameraOn) return;
    const timeout = setTimeout(() => {
      const width = videoRef.current?.videoWidth ?? 0;
      const height = videoRef.current?.videoHeight ?? 0;
      if (width === 0 || height === 0) {
        restartPreview("Camera preview stalled. Toggle Camera to retry.");
      }
    }, 3000);
    return () => clearTimeout(timeout);
  }, [cameraOn, recorder.stream, restartPreview, status]);

  useEffect(() => {
    if (!recorder.stream) return;
    recorder.stream.getVideoTracks().forEach((track) => {
      track.enabled = cameraOn;
    });
    recorder.stream.getAudioTracks().forEach((track) => {
      track.enabled = micOn;
    });
  }, [recorder.stream, cameraOn, micOn]);

  useEffect(() => {
    if (speech.transcript.length) {
      setTranscript(speech.transcript);
    }
  }, [speech.transcript, setTranscript]);

  useEffect(() => {
    if (status !== "recording") return;
    const interval = setInterval(() => {
      setDurationMs(Date.now() - startTimeRef.current);
      const audioSnapshot = audioRef.current;
      const faceSnapshot = faceRef.current;
      const speechSnapshot = speechRef.current;
      const point: MetricsPoint = {
        t: Math.floor((Date.now() - startTimeRef.current) / 1000),
        wpm: speechSnapshot.wpm,
        rms: audioSnapshot.rms,
        eyeContact: faceSnapshot.eyeContact,
        smile: faceSnapshot.smile,
        yaw: faceSnapshot.yaw,
        pitch: faceSnapshot.pitch,
        roll: faceSnapshot.roll,
        fillerCount: speechSnapshot.fillerCount,
        pauseMs: audioSnapshot.pauseMs > 600 ? Math.round(audioSnapshot.pauseMs) : 0,
      };
      addMetric(point);
      if (audioSnapshot.pitch > 0) {
        pitchHistoryRef.current.push(audioSnapshot.pitch);
        if (pitchHistoryRef.current.length > 20) {
          pitchHistoryRef.current.shift();
        }
        const avg =
          pitchHistoryRef.current.reduce((acc, val) => acc + val, 0) / pitchHistoryRef.current.length;
        const variance =
          pitchHistoryRef.current.reduce((acc, val) => acc + (val - avg) ** 2, 0) /
          pitchHistoryRef.current.length;
        setPitchVariance(variance);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [status, addMetric, setDurationMs]);

  const handleStart = async () => {
    if (safeMode) {
      setError("Safe mode disables preview and recording. Open /record to use the recorder.");
      return;
    }
    setError(null);
    try {
      if (status === "review" || status === "stopped") {
        if (draftId) {
          await clearActiveDraft(draftId);
        }
        setDraftId(null);
        setRecoveredDraftAt(null);
      }
      reset();
      await recorder.startRecording();
      setStatus("recording");
      startTimeRef.current = Date.now();
      const id = createDraftId();
      setDraftId(id);
      setRecoveredDraftAt(new Date().toISOString());
    } catch (err) {
      setStatus("idle");
      setError("Camera or microphone unavailable. Check permissions and try again.");
    }
  };

  const handlePause = () => {
    if (status === "recording") {
      const paused = recorder.pauseRecording();
      if (paused) {
        setStatus("paused");
      } else {
        setError("Pause not supported or failed in this browser.");
      }
    } else if (status === "paused") {
      const resumed = recorder.resumeRecording();
      if (resumed) {
        setStatus("recording");
      } else {
        setError("Resume not supported or failed in this browser.");
      }
    }
  };

  const handleStop = async () => {
    setFinalizingStop(true);
    setError(null);
    setStatus("stopped");

    try {
      const recordedChunks = await recorder.stopRecording();
      chunksRef.current = recordedChunks;
      setChunks(recordedChunks);

      if (!recordedChunks.length) {
        setError("No new video was captured. Record again, then stop after a few seconds.");
        return;
      }

      setStatus("review");
    } finally {
      setFinalizingStop(false);
    }
  };

  const handleToggleCamera = async () => {
    if (!cameraOn) {
      const videoTrack = recorder.stream?.getVideoTracks()[0];
      if (!recorder.stream || !videoTrack || videoTrack.readyState === "ended") {
        await restartPreview("Reconnecting camera...", true);
      }
    }
    setCameraOn((prev) => !prev);
  };

  const handleToggleMic = async () => {
    if (!micOn) {
      const audioTrack = recorder.stream?.getAudioTracks()[0];
      if (!recorder.stream || !audioTrack || audioTrack.readyState === "ended") {
        await restartPreview("Reconnecting microphone...", true);
      }
    }
    setMicOn((prev) => !prev);
  };

  useEffect(() => {
    const info: string[] = [];
    const isSecure = typeof window !== "undefined" && window.isSecureContext;
    info.push(`Secure context: ${isSecure ? "yes" : "no"}`);
    info.push(`Origin: ${typeof window !== "undefined" ? window.location.origin : "unknown"}`);
    info.push(`MediaRecorder: ${typeof MediaRecorder !== "undefined" ? "supported" : "missing"}`);
    info.push(
      `getUserMedia: ${typeof navigator.mediaDevices?.getUserMedia === "function" ? "available" : "missing"}`
    );
    info.push(`Cameras: ${devices.cameras.length}`);
    info.push(`Microphones: ${devices.microphones.length}`);
    info.push(`Selected camera: ${videoDeviceId || "default"}`);
    info.push(`Selected mic: ${audioDeviceId || "default"}`);
    info.push(`Status: ${status}`);
    info.push(`Route ready: ${routeReady ? "yes" : "no"}`);
    info.push(`Safe mode: ${safeMode ? "yes" : "no"}`);
    info.push(`Safari: ${isSafari ? "yes" : "no"}`);
    info.push(`Auto preview: ${safeMode ? "disabled" : isSafari ? "manual" : "enabled"}`);
    info.push(`Finalizing stop: ${finalizingStop ? "yes" : "no"}`);
    info.push(`Recorder mimeType: ${recorder.mimeType || "unknown"}`);
    info.push(`Stream: ${recorder.stream ? "active" : "none"}`);
    info.push(`Chunks: ${chunks.length}`);
    info.push(`Document: ${readingDocument ? `${readingDocument.name} (${readingDocument.blocks.length} blocks)` : "none"}`);
    const videoTrack = recorder.stream?.getVideoTracks()[0];
    const audioTrack = recorder.stream?.getAudioTracks()[0];
    info.push(`Video track: ${videoTrack ? `${videoTrack.readyState} enabled=${videoTrack.enabled}` : "none"}`);
    info.push(`Audio track: ${audioTrack ? `${audioTrack.readyState} enabled=${audioTrack.enabled}` : "none"}`);
    if (videoTrack?.getSettings) {
      const settings = videoTrack.getSettings();
      const width = settings.width ?? 0;
      const height = settings.height ?? 0;
      const frameRate = settings.frameRate ?? 0;
      info.push(`Video settings: ${width}x${height} ${frameRate}fps`);
    }
    info.push(`Video element readyState: ${videoRef.current?.readyState ?? 0}`);
    info.push(`Video size: ${videoRef.current?.videoWidth ?? 0}x${videoRef.current?.videoHeight ?? 0}`);
    if (recorder.error) {
      info.push(`Recorder error: ${recorder.error}`);
    }
    if (error) {
      info.push(`UI error: ${error}`);
    }
    setDebugInfo(info);
  }, [
    recorder.stream,
    recorder.error,
    recorder.mimeType,
    error,
    devices.cameras.length,
    devices.microphones.length,
    isSafari,
    routeReady,
    safeMode,
    finalizingStop,
    status,
    videoDeviceId,
    audioDeviceId,
    chunks.length,
    readingDocument,
  ]);

  const promptOptions = useMemo(() => {
    const entry = PROMPTS.find((p) => p.mode === mode) || PROMPTS[0];
    return entry.prompts;
  }, [mode]);

  useEffect(() => {
    if (!editingPrompt && promptOptions.length) {
      setPrompt(promptOptions[0]);
    }
  }, [mode, editingPrompt, promptOptions, setPrompt]);

  const handlePromptShuffle = () => {
    const options = promptOptions;
    if (options.length) {
      const next = options[Math.floor(Math.random() * options.length)];
      setPrompt(next);
    }
  };

  const handlePlayPrompt = () => {
    if (typeof window === "undefined") return;
    const rate = promptSpeed === "1.5x" ? 1.5 : promptSpeed === "1.25x" ? 1.25 : 1;
    const utterance = new SpeechSynthesisUtterance(prompt);
    utterance.rate = rate;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  const handleDocumentPick = async (file: File | null) => {
    if (!file) {
      setReadingDocument(null);
      setDocumentError(null);
      setActiveDocumentBlockIndex(-1);
      return;
    }

    setParsingDocument(true);
    setDocumentError(null);
    try {
      const parsedDocument = await parseReadableDocument(file);
      setReadingDocument(parsedDocument);
      setActiveDocumentBlockIndex(-1);
    } catch (err) {
      setReadingDocument(null);
      setActiveDocumentBlockIndex(-1);
      setDocumentError(err instanceof Error ? err.message : "Unable to parse this document.");
    } finally {
      setParsingDocument(false);
    }
  };

  const videoBlob = useMemo(
    () => (chunks.length ? mergeChunks(chunks, recorder.mimeType || chunks[0]?.type) : null),
    [chunks, recorder.mimeType]
  );
  const lastCaption =
    speech.partial || (transcript.length ? transcript[transcript.length - 1].text : "");

  useEffect(() => {
    if (!readingDocument?.blocks.length) {
      setActiveDocumentBlockIndex(-1);
      return;
    }

    setActiveDocumentBlockIndex((current) =>
      findBestMatchingDocumentBlock(readingDocument.blocks, transcript, speech.partial, current)
    );
  }, [readingDocument, transcript, speech.partial]);

  useEffect(() => {
    if (!routeReady) return;
    let cancelled = false;

    loadActiveDraft()
      .then((draft) => {
        if (!draft || cancelled) return;
        setDraftId(draft.id);
        setPrompt(draft.prompt);
        setMode(draft.mode);
        setGoal(draft.goal);
        setTranscript(draft.transcript);
        setMetrics(draft.metrics);
        setChunks(draft.chunks);
        setReadingDocument(draft.document ? { ...draft.document } : null);
        setDurationMs(draft.durationMs);
        setRecoveredDraftAt(draft.createdAt);
        if (draft.chunks.length || draft.transcript.length || draft.metrics.length || draft.durationMs > 0 || draft.document) {
          setStatus(draft.chunks.length ? "review" : "stopped");
          setError("Recovered your unsaved session from the last refresh.");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("An unsaved session could not be restored.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [routeReady, setChunks, setDurationMs, setGoal, setMetrics, setMode, setPrompt, setStatus, setTranscript]);

  useEffect(() => {
    if (clearedStaleSessionRef.current) return;
    clearedStaleSessionRef.current = true;
    if (status === "recording" || status === "paused") return;
    if (!chunks.length && !transcript.length && !metrics.length && durationMs === 0 && !readingDocument) return;
    setDraftId(null);
    reset();
  }, [chunks.length, durationMs, metrics.length, readingDocument, reset, status, transcript.length]);

  useEffect(() => {
    const shouldPersist =
      draftId &&
      ["recording", "paused", "review", "stopped"].includes(status) &&
      (chunks.length > 0 || transcript.length > 0 || metrics.length > 0 || durationMs > 0 || !!readingDocument);
    if (!shouldPersist) return;

    const timeout = setTimeout(() => {
      persistActiveDraft({
        id: draftId,
        createdAt: recoveredDraftAt || new Date().toISOString(),
        prompt,
        mode,
        goal,
        durationMs,
        transcript,
        metrics,
        chunks,
        document: readingDocument
          ? {
              name: readingDocument.name,
              mimeType: readingDocument.mimeType,
              blocks: readingDocument.blocks,
              file: readingDocument.file,
            }
          : null,
      }).catch(() => {});
    }, 150);

    return () => clearTimeout(timeout);
  }, [draftId, status, prompt, mode, goal, durationMs, transcript, metrics, chunks, readingDocument, recoveredDraftAt]);

  const saveSession = async () => {
    if (!videoBlob) {
      setError("There is no new recording to save yet.");
      return;
    }
    if (parsingDocument) {
      setError("Finish parsing the reading document before saving this session.");
      return;
    }
    if (transcriptionModel.selectedAudioBackendStatus?.supported && !transcriptionModel.selectedAudioModelOption?.available) {
      setError("Download the selected transcription model before saving and transcribing this session.");
      return;
    }
    setSaving(true);
    try {
      const metricsInput = metrics.length ? metrics : [];
      const score = computeScore({
        durationMs,
        transcript,
        metrics: metricsInput,
        targetKeywords: [],
      });
      const eyeContactPct = metricsInput.length
        ? metricsInput.reduce((acc, m) => acc + m.eyeContact, 0) / metricsInput.length
        : 0;
      const session = await createSession({
        title: `${mode} practice`,
        mode,
        prompt,
        goal,
        durationMs,
        wpmAvg: speech.avgWpm,
        fillerCount: speech.fillerCount,
        eyeContactPct,
        transcript,
        metrics: metricsInput,
        score,
      });
      await uploadChunks(session.id, chunks, recorder.mimeType || chunks[0]?.type);
      if (readingDocument) {
        try {
          await uploadSessionDocument(session.id, {
            file: readingDocument.file,
            name: readingDocument.name,
            mimeType: readingDocument.mimeType,
            blocks: readingDocument.blocks,
          });
        } catch (documentUploadError) {
          await deleteSession(session.id).catch(() => {});
          throw documentUploadError;
        }
      }
      await triggerTranscription(session.id, transcriptionModel.effectiveSelection);
      if (draftId) {
        await clearActiveDraft(draftId);
      }
      setRecoveredDraftAt(null);
      reset();
      router.push(`/session/${session.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save session. Check your connection.";
      setError(
        message === "Authentication expired. Sign in again."
          ? "Session expired. Sign in again. Your draft is still saved."
          : message
      );
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (playbackRef.current && videoBlob) {
      const url = URL.createObjectURL(videoBlob);
      playbackRef.current.src = url;
      return () => URL.revokeObjectURL(url);
    }
  }, [videoBlob]);

  return (
    <div className="min-h-screen bg-hero-gradient px-6 py-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink/60">Speech-Machine</p>
            <h1 className="font-display text-2xl font-semibold">Live coaching session</h1>
          </div>
          <Link href="/">
            <Button variant="ghost">Back to dashboard</Button>
          </Link>
        </header>

        <div className="grid gap-6 lg:grid-cols-[2.3fr_1fr]">
          <div className="flex flex-col gap-6">
            <div className="relative rounded-[32px] bg-white/80 p-6 card-shadow">
              <div className="absolute right-6 top-6 flex items-center gap-2 rounded-full bg-white/80 px-4 py-2 text-xs font-semibold">
                <span className="h-2 w-2 rounded-full bg-red-500" />
                {formatTime(durationMs)}
              </div>
              <div className="relative overflow-hidden rounded-[28px] bg-black">
                {status === "review" && videoBlob ? (
                  <video ref={playbackRef} controls playsInline className="h-[460px] w-full object-cover" />
                ) : (
                  <video
                    ref={videoRef}
                    autoPlay
                    muted
                    playsInline
                    onLoadedMetadata={(event) => {
                      event.currentTarget.play().catch(() => {});
                    }}
                    className="h-[460px] w-full object-cover"
                  />
                )}
                {!recorder.stream && status !== "review" && (
                  <div className="absolute inset-0 flex items-center justify-center text-sm text-white/80">
                    Enable camera/mic to start preview
                  </div>
                )}
                {lastCaption && (
                  <div className="absolute bottom-6 left-1/2 w-[80%] -translate-x-1/2 rounded-2xl bg-black/60 px-4 py-2 text-center text-sm text-white">
                    {lastCaption}
                  </div>
                )}
                {showPrompt && (
                  <div className="absolute left-1/2 top-10 w-[70%] -translate-x-1/2 rounded-3xl border border-white/30 bg-glass-gradient p-5 text-white shadow-lg">
                    <div className="flex items-center justify-between">
                      <Badge className="bg-white/30 text-white">LIVE {mode.toUpperCase()}</Badge>
                      <div className="flex items-center gap-2 text-xs">
                        <button className="rounded-full bg-white/20 px-3 py-1" onClick={handlePromptShuffle}>
                          Next prompt
                        </button>
                        <button className="rounded-full bg-white/20 px-3 py-1" onClick={handlePlayPrompt}>
                          Play
                        </button>
                        <button className="rounded-full bg-white/20 px-3 py-1" onClick={() => setEditingPrompt(!editingPrompt)}>
                          {editingPrompt ? "Save" : "Edit"}
                        </button>
                        <button className="rounded-full bg-white/20 px-3 py-1" onClick={() => setShowPrompt(false)}>
                          Hide
                        </button>
                      </div>
                    </div>
                    {editingPrompt ? (
                      <textarea
                        className="mt-3 w-full rounded-2xl bg-white/20 p-3 text-sm text-white outline-none"
                        value={prompt}
                        onChange={(event) => setPrompt(event.target.value)}
                      />
                    ) : (
                      <p className="mt-3 text-lg font-semibold">{prompt}</p>
                    )}
                  </div>
                )}
                <button className="absolute right-6 top-32 rounded-full bg-white/80 px-4 py-2 text-xs font-semibold">
                  Notes
                </button>
              </div>

              <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-full bg-white/70 px-6 py-4">
                <div className="flex items-center gap-3">
                  <Button variant="ghost" onClick={handlePause}>
                    {status === "paused" ? "Resume" : "Pause"}
                  </Button>
                  <div className="hidden w-40 md:block">
                    <Progress value={durationMs ? (durationMs / 60000) * 100 : 0} />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Toggle pressed={cameraOn} onClick={handleToggleCamera}>
                    Camera
                  </Toggle>
                  <Toggle pressed={micOn} onClick={handleToggleMic}>
                    Mic
                  </Toggle>
                  {!recorder.stream && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        recorder.startStream().catch(() => {
                          setError("Camera or microphone blocked. Check permissions.");
                        })
                      }
                    >
                      Enable preview
                    </Button>
                  )}
                  {recorder.stream && (error || recorder.error) && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => restartPreview("Retrying preview...", true)}
                    >
                      Restart preview
                    </Button>
                  )}
                </div>
                <button
                  className="relative flex h-16 w-16 items-center justify-center rounded-full border-4 border-red-500 bg-white shadow-lg"
                  onClick={status === "recording" || status === "paused" ? handleStop : handleStart}
                  disabled={finalizingStop}
                >
                  <div
                    className={`h-8 w-8 ${
                      status === "recording" || status === "paused" ? "bg-red-600" : "rounded-full bg-red-500"
                    }`}
                  />
                </button>
                <div className="flex items-center gap-3 text-xs">
                  <select
                    className="rounded-full border border-ink/10 bg-white/60 px-3 py-1"
                    value={promptSpeed}
                    onChange={(event) => setPromptSpeed(event.target.value)}
                  >
                    <option>1x</option>
                    <option>1.25x</option>
                    <option>1.5x</option>
                  </select>
                  <Toggle>CC</Toggle>
                  <Toggle>Full</Toggle>
                </div>
              </div>
            </div>

            <DocumentReaderPanel
              document={readingDocument}
              activeBlockIndex={activeDocumentBlockIndex}
              onPickFile={handleDocumentPick}
              onClear={() => {
                setReadingDocument(null);
                setDocumentError(null);
                setActiveDocumentBlockIndex(-1);
              }}
              error={documentError}
              helperText={
                parsingDocument
                  ? "Parsing your document..."
                  : speech.supported
                    ? "The highlighted block follows the current paragraph you are speaking."
                    : "Speech recognition is unavailable in this browser, so the document stays static."
              }
            />
          </div>

          <aside className="flex flex-col gap-4">
            <div className="rounded-3xl bg-white/80 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink/60">Realtime</p>
              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-xs text-ink/60">WPM</p>
                  <p className="text-2xl font-semibold">{speech.wpm}</p>
                  <p className="text-xs text-ink/50">Avg {speech.avgWpm}</p>
                </div>
                <div>
                  <p className="text-xs text-ink/60">Fillers</p>
                  <p className="text-2xl font-semibold">{speech.fillerCount}</p>
                </div>
                <div>
                  <p className="text-xs text-ink/60">Volume</p>
                  <Progress value={audio.rms} />
                  <p className="text-xs text-ink/50">{audio.volumeLabel}</p>
                </div>
                <div>
                  <p className="text-xs text-ink/60">Tone</p>
                  <p className="text-sm font-semibold">
                    {pitchVariance < 20 ? "Monotone risk" : "Expressive"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-ink/60">Eye contact</p>
                  <Progress value={face.eyeContact * 100} />
                </div>
              </div>
            </div>

            <div className="rounded-3xl bg-white/80 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink/60">Settings</p>
              <div className="mt-4 space-y-3">
                <div>
                  <p className="text-xs text-ink/60">Mode</p>
                  <Select value={mode} onChange={(event) => setMode(event.target.value)}>
                    {PROMPTS.map((entry) => (
                      <option key={entry.mode} value={entry.mode}>
                        {entry.mode}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <p className="text-xs text-ink/60">Goal</p>
                  <Select value={goal} onChange={(event) => setGoal(event.target.value)}>
                    <option>Reduce fillers</option>
                    <option>Stronger eye contact</option>
                    <option>Improve pace</option>
                  </Select>
                </div>
                <AudioTranscriptionPanel
                  transcriptionModel={transcriptionModel}
                  helperText="Used when you save and transcribe this recording."
                />
                <div>
                  <p className="text-xs text-ink/60">Camera</p>
                  <Select value={videoDeviceId || ""} onChange={(event) => setVideoDeviceId(event.target.value)}>
                    <option value="">Default camera</option>
                    {devices.cameras.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label || "Camera"}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <p className="text-xs text-ink/60">Microphone</p>
                  <Select value={audioDeviceId || ""} onChange={(event) => setAudioDeviceId(event.target.value)}>
                    <option value="">Default mic</option>
                    {devices.microphones.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label || "Microphone"}
                      </option>
                    ))}
                  </Select>
                </div>
                {recorder.error && <p className="text-xs text-red-600">{recorder.error}</p>}
                {error && <p className="text-xs text-red-600">{error}</p>}
                {transcriptionModel.error && <p className="text-xs text-red-600">{transcriptionModel.error}</p>}
                {finalizingStop && (
                  <p className="text-xs text-ink/60">Finalizing the current recording before review.</p>
                )}
                {safeMode && (
                  <p className="text-xs text-ink/60">
                    Safe mode is active. Media, speech, and preview startup are disabled for debugging.
                  </p>
                )}
                {!speech.supported && (
                  <p className="text-xs text-ink/60">Web Speech API not supported on this browser.</p>
                )}
                {isSafari && (
                  <p className="text-xs text-ink/60">
                    Safari uses manual preview start here. Click Enable preview or press record first.
                  </p>
                )}
                {recoveredDraftAt && (
                  <div className="rounded-2xl bg-amber-50 p-3 text-xs text-amber-900">
                    Restored unsaved session from {new Date(recoveredDraftAt).toLocaleString()}.
                  </div>
                )}
                <div className="rounded-2xl bg-white/70 p-3 text-xs text-ink/60">
                  <p className="font-semibold text-ink">Debug</p>
                  <ul className="mt-2 space-y-1">
                    {debugInfo.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            {(status === "review" || status === "stopped" || finalizingStop) && (
              <div className="rounded-3xl bg-white/80 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink/60">Review</p>
                <div className="mt-4 space-y-3">
                  <Button onClick={saveSession} disabled={saving || finalizingStop || !videoBlob}>
                    {saving ? "Saving..." : finalizingStop ? "Processing..." : "Save session"}
                  </Button>
                  {draftId && (
                    <Button
                      variant="ghost"
                      onClick={async () => {
                        await clearActiveDraft(draftId);
                        setDraftId(null);
                        setRecoveredDraftAt(null);
                        setError(null);
                        reset();
                      }}
                    >
                      Discard draft
                    </Button>
                  )}
                  {!videoBlob && !finalizingStop && (
                    <p className="text-xs text-ink/60">No fresh recording is ready to save yet.</p>
                  )}
                  {error && <p className="text-xs text-red-600">{error}</p>}
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
