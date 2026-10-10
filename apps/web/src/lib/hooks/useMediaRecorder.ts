import { useCallback, useEffect, useRef, useState } from "react";
import { isSafariBrowser } from "@/lib/browser";

type RecorderState = {
  stream: MediaStream | null;
  recording: boolean;
  paused: boolean;
  error: string | null;
  mimeType: string | null;
};

type Options = {
  videoDeviceId?: string;
  audioDeviceId?: string;
  onChunk: (chunk: Blob) => void;
};

export const useMediaRecorder = ({ videoDeviceId, audioDeviceId, onChunk }: Options) => {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startStreamPromiseRef = useRef<Promise<MediaStream> | null>(null);
  const chunkBufferRef = useRef<Blob[]>([]);
  const stopResolveRef = useRef<((chunks: Blob[]) => void) | null>(null);
  const stopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopFinalizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [state, setState] = useState<RecorderState>({
    stream: null,
    recording: false,
    paused: false,
    error: null,
    mimeType: null,
  });

  const resetStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    startStreamPromiseRef.current = null;
    setState((prev) => ({ ...prev, stream: null }));
  }, []);

  const startStream = useCallback(async () => {
    if (streamRef.current) {
      return streamRef.current;
    }

    if (startStreamPromiseRef.current) {
      return startStreamPromiseRef.current;
    }

    startStreamPromiseRef.current = (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Media devices API not available");
        }

        const constraints = {
          video: videoDeviceId ? { deviceId: { exact: videoDeviceId } } : { width: 1280, height: 720 },
          audio: audioDeviceId ? { deviceId: { exact: audioDeviceId } } : true,
        };

        try {
          let stream = await navigator.mediaDevices.getUserMedia(constraints);
          if (!stream.getVideoTracks().length && constraints.video) {
            stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          }
          streamRef.current = stream;
          setState((prev) => ({ ...prev, stream, error: null }));
          return stream;
        } catch (error) {
          const fallbackConstraints = { video: true, audio: true };
          try {
            const stream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
            streamRef.current = stream;
            setState((prev) => ({
              ...prev,
              stream,
              error: "Fell back to default devices.",
            }));
            return stream;
          } catch (fallbackError) {
            try {
              const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
              streamRef.current = stream;
              setState((prev) => ({
                ...prev,
                stream,
                error: "Microphone blocked. Previewing video only.",
              }));
              return stream;
            } catch (_videoOnlyError) {
              const baseError = error instanceof Error ? error : fallbackError;
              const message =
                baseError instanceof Error
                  ? `${baseError.name}: ${baseError.message}`
                  : "Camera or microphone permission denied";
              setState((prev) => ({ ...prev, error: message }));
              throw baseError;
            }
          }
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? `${error.name}: ${error.message}`
            : "Camera or microphone permission denied";
        setState((prev) => ({ ...prev, error: message }));
        throw error;
      } finally {
        startStreamPromiseRef.current = null;
      }
    })();

    return startStreamPromiseRef.current;
  }, [audioDeviceId, videoDeviceId]);

  const startRecording = useCallback(async () => {
    if (typeof MediaRecorder === "undefined") {
      const message = "MediaRecorder not supported in this browser.";
      setState((prev) => ({ ...prev, error: message }));
      throw new Error(message);
    }
    const isSafari = isSafariBrowser();
    if (isSafari && streamRef.current) {
      resetStream();
    }
    const stream = streamRef.current ?? (await startStream());
    const preferredTypes = isSafari
      ? ["video/mp4;codecs=h264,aac", "video/mp4"]
      : [
          "video/webm;codecs=vp9,opus",
          "video/webm;codecs=vp8,opus",
          "video/webm",
          "video/mp4;codecs=h264,aac",
          "video/mp4",
        ];
    const supportedType = preferredTypes.find((type) => MediaRecorder.isTypeSupported(type));
    const recorder = supportedType ? new MediaRecorder(stream, { mimeType: supportedType }) : new MediaRecorder(stream);
    const shouldUseMp4 = Boolean(isSafari || supportedType?.includes("mp4"));
    const fallbackMimeType = shouldUseMp4 ? "video/mp4" : null;
    const initialMimeType = recorder.mimeType || supportedType || fallbackMimeType || null;
    chunkBufferRef.current = [];
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunkBufferRef.current.push(event.data);
        onChunk(event.data);
      }
      if (event.data.type) {
        setState((prev) => (prev.mimeType === event.data.type ? prev : { ...prev, mimeType: event.data.type }));
      }
      if (recorder.state === "inactive" && stopResolveRef.current) {
        if (stopFinalizeTimeoutRef.current) {
          clearTimeout(stopFinalizeTimeoutRef.current);
        }
        // Give late final chunks a brief window to arrive before declaring the recording empty.
        stopFinalizeTimeoutRef.current = setTimeout(() => {
          stopFinalizeTimeoutRef.current = null;
          stopResolveRef.current?.([...chunkBufferRef.current]);
          stopResolveRef.current = null;
        }, 400);
      }
    };
    recorder.onpause = () => {
      setState((prev) => ({ ...prev, paused: true }));
    };
    recorder.onresume = () => {
      setState((prev) => ({ ...prev, paused: false }));
    };
    recorder.onerror = (event) => {
      const nextError =
        event.error?.message || "Recording failed before any media chunk was produced.";
      setState((prev) => ({ ...prev, error: nextError, recording: false, paused: false }));
    };
    recorder.onstop = () => {
      if (stopTimeoutRef.current) {
        clearTimeout(stopTimeoutRef.current);
        stopTimeoutRef.current = null;
      }
      if (stopResolveRef.current) {
        if (stopFinalizeTimeoutRef.current) {
          clearTimeout(stopFinalizeTimeoutRef.current);
        }
        stopFinalizeTimeoutRef.current = setTimeout(() => {
          stopFinalizeTimeoutRef.current = null;
          stopResolveRef.current?.([...chunkBufferRef.current]);
          stopResolveRef.current = null;
        }, 400);
      }
      setState((prev) => ({ ...prev, recording: false, paused: false }));
    };
    try {
      recorder.start(shouldUseMp4 ? 1000 : 2000);
    } catch (_error) {
      recorder.start();
    }
    setState((prev) => ({ ...prev, recording: true, paused: false, mimeType: initialMimeType || prev.mimeType }));
  }, [onChunk, resetStream, startStream]);

  const pauseRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder) return false;
    if (typeof recorder.pause !== "function") {
      setState((prev) => ({ ...prev, error: "Pause not supported in this browser." }));
      return false;
    }
    if (recorder.state !== "recording") {
      return false;
    }
    try {
      recorder.pause();
      return true;
    } catch (error) {
      const message =
        error instanceof Error ? `${error.name}: ${error.message}` : "Pause failed.";
      setState((prev) => ({ ...prev, error: message }));
      return false;
    }
  }, []);

  const resumeRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder) return false;
    if (typeof recorder.resume !== "function") {
      setState((prev) => ({ ...prev, error: "Resume not supported in this browser." }));
      return false;
    }
    if (recorder.state !== "paused") {
      return false;
    }
    try {
      recorder.resume();
      return true;
    } catch (error) {
      const message =
        error instanceof Error ? `${error.name}: ${error.message}` : "Resume failed.";
      setState((prev) => ({ ...prev, error: message }));
      return false;
    }
  }, []);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      return Promise.resolve([...chunkBufferRef.current]);
    }

    if (stopTimeoutRef.current) {
      clearTimeout(stopTimeoutRef.current);
      stopTimeoutRef.current = null;
    }
    if (stopFinalizeTimeoutRef.current) {
      clearTimeout(stopFinalizeTimeoutRef.current);
      stopFinalizeTimeoutRef.current = null;
    }

    return new Promise<Blob[]>((resolve) => {
      stopResolveRef.current = resolve;
      stopTimeoutRef.current = setTimeout(() => {
        stopTimeoutRef.current = null;
        if (stopFinalizeTimeoutRef.current) {
          clearTimeout(stopFinalizeTimeoutRef.current);
          stopFinalizeTimeoutRef.current = null;
        }
        stopResolveRef.current?.([...chunkBufferRef.current]);
        stopResolveRef.current = null;
      }, isSafariBrowser() ? 5000 : 2500);

      try {
        if (!isSafariBrowser() && typeof recorder.requestData === "function" && recorder.state === "recording") {
          recorder.requestData();
        }
        recorder.stop();
      } catch (error) {
        if (stopTimeoutRef.current) {
          clearTimeout(stopTimeoutRef.current);
          stopTimeoutRef.current = null;
        }
        stopResolveRef.current?.([...chunkBufferRef.current]);
        stopResolveRef.current = null;
        throw error;
      }
      setState((prev) => ({ ...prev, recording: false, paused: false }));
    });
  }, []);

  const stopTracks = useCallback(() => {
    if (stopTimeoutRef.current) {
      clearTimeout(stopTimeoutRef.current);
      stopTimeoutRef.current = null;
    }
    if (stopFinalizeTimeoutRef.current) {
      clearTimeout(stopFinalizeTimeoutRef.current);
      stopFinalizeTimeoutRef.current = null;
    }
    stopResolveRef.current = null;
    recorderRef.current = null;
    resetStream();
  }, [resetStream]);

  const stopStream = useCallback(() => {
    stopTracks();
    setState((prev) => ({ ...prev, stream: null }));
  }, [stopTracks]);

  useEffect(() => () => stopTracks(), [stopTracks]);

  return {
    ...state,
    startStream,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    stopStream,
  };
};
