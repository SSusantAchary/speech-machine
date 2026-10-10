import { useEffect, useRef, useState } from "react";
import { isSafariBrowser } from "@/lib/browser";

export type FaceMetrics = {
  eyeContact: number;
  smile: number;
  yaw: number;
  pitch: number;
  roll: number;
};

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));

export const useFaceLandmarker = (video: HTMLVideoElement | null, enabled: boolean) => {
  const [metrics, setMetrics] = useState<FaceMetrics>({
    eyeContact: 0,
    smile: 0,
    yaw: 0,
    pitch: 0,
    roll: 0,
  });
  const landmarkerRef = useRef<{
    close: () => void;
    detectForVideo: (
      videoElement: HTMLVideoElement,
      timestampMs: number
    ) => { faceLandmarks: Array<Array<{ x: number; y: number }>> };
  } | null>(null);
  const lastFrameRef = useRef(0);

  useEffect(() => {
    if (!enabled || !video) return;
    if (isSafariBrowser()) {
      return;
    }
    if (typeof window !== "undefined" && (window as { __disableFaceLandmarker?: boolean }).__disableFaceLandmarker) {
      return;
    }

    let rafId = 0;
    let active = true;

    const init = async () => {
      let vision: typeof import("@mediapipe/tasks-vision");
      try {
        vision = await import("@mediapipe/tasks-vision");
        if (!active) return;

        const fileset = await vision.FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
        );
        if (!active) return;

        const landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL },
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
          runningMode: "VIDEO",
        });
        if (!active) {
          landmarker.close();
          return;
        }

        landmarkerRef.current = landmarker;
      } catch (_error) {
        return;
      }

      const tick = (time: number) => {
        if (!active || !video || video.readyState < 2) {
          rafId = requestAnimationFrame(tick);
          return;
        }
        if (time - lastFrameRef.current < 100) {
          rafId = requestAnimationFrame(tick);
          return;
        }
        lastFrameRef.current = time;
        const landmarker = landmarkerRef.current;
        if (!landmarker) {
          rafId = requestAnimationFrame(tick);
          return;
        }

        let result;
        try {
          result = landmarker.detectForVideo(video, time);
        } catch (_error) {
          rafId = requestAnimationFrame(tick);
          return;
        }

        if (result.faceLandmarks.length) {
          const landmarks = result.faceLandmarks[0];
          const leftEye = landmarks[33];
          const rightEye = landmarks[263];
          const nose = landmarks[1];
          const mouthLeft = landmarks[61];
          const mouthRight = landmarks[291];

          const eyeDistance = Math.abs(rightEye.x - leftEye.x);
          const noseOffset = Math.abs(nose.x - (leftEye.x + rightEye.x) / 2);
          const yaw = clamp(noseOffset / (eyeDistance + 0.001), 0, 1) * 20;
          const pitch = clamp(Math.abs(nose.y - (leftEye.y + rightEye.y) / 2) * 2, 0, 1) * 15;
          const roll = clamp(Math.abs(leftEye.y - rightEye.y) * 4, 0, 1) * 15;

          const mouthWidth = Math.abs(mouthRight.x - mouthLeft.x);
          const mouthOpen = Math.abs(mouthRight.y - mouthLeft.y);
          const smile = clamp(mouthOpen / (mouthWidth + 0.001), 0, 1);

          const eyeContact = clamp(1 - yaw / 20, 0, 1);

          setMetrics({ eyeContact, smile, yaw, pitch, roll });
        }
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    };

    init();

    return () => {
      active = false;
      if (rafId) cancelAnimationFrame(rafId);
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    };
  }, [enabled, video]);

  return metrics;
};
