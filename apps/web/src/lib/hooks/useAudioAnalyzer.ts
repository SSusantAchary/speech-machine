import { useEffect, useRef, useState } from "react";

type AudioState = {
  rms: number;
  pitch: number;
  pauseMs: number;
  volumeLabel: "quiet" | "good" | "loud";
};

const computeRms = (data: Float32Array) => {
  let sum = 0;
  for (let i = 0; i < data.length; i += 1) {
    sum += data[i] * data[i];
  }
  return Math.sqrt(sum / data.length);
};

const autoCorrelate = (buffer: Float32Array, sampleRate: number) => {
  let bestOffset = -1;
  let bestCorrelation = 0;
  const size = buffer.length;
  for (let offset = 8; offset < 1000; offset += 1) {
    let correlation = 0;
    for (let i = 0; i < size - offset; i += 1) {
      correlation += buffer[i] * buffer[i + offset];
    }
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestOffset = offset;
    }
  }
  if (bestOffset === -1) return 0;
  return sampleRate / bestOffset;
};

export const useAudioAnalyzer = (stream: MediaStream | null, enabled: boolean) => {
  const [state, setState] = useState<AudioState>({ rms: 0, pitch: 0, pauseMs: 0, volumeLabel: "good" });
  const lastSoundRef = useRef<number>(performance.now());
  const lastUpdateRef = useRef<number>(0);

  useEffect(() => {
    if (!stream || !enabled) return;
    const AudioContextCtor =
      typeof window !== "undefined"
        ? window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        : undefined;
    if (!AudioContextCtor) return;
    const audioContext = new AudioContextCtor();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);

    const data = new Float32Array(analyser.fftSize);
    const minUpdateMs = 100;

    let rafId = 0;
    const tick = () => {
      analyser.getFloatTimeDomainData(data);
      const rms = computeRms(data);
      const normalized = Math.min(100, Math.max(0, rms * 200));
      const now = performance.now();
      let pauseMs = 0;
      if (normalized < 6) {
        pauseMs = now - lastSoundRef.current;
      } else {
        lastSoundRef.current = now;
      }
      const pitch = autoCorrelate(data, audioContext.sampleRate);
      const volumeLabel = normalized < 15 ? "quiet" : normalized > 70 ? "loud" : "good";
      if (now - lastUpdateRef.current >= minUpdateMs) {
        lastUpdateRef.current = now;
        setState({ rms: normalized, pitch, pauseMs, volumeLabel });
      }
      rafId = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(rafId);
      analyser.disconnect();
      source.disconnect();
      audioContext.close();
    };
  }, [stream, enabled]);

  return state;
};
