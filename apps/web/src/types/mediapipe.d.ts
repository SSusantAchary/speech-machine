declare module "@mediapipe/tasks-vision" {
  export type FaceLandmarkerResult = {
    faceLandmarks: Array<Array<{ x: number; y: number }>>;
  };

  export class FilesetResolver {
    static forVisionTasks(basePath: string): Promise<unknown>;
  }

  export class FaceLandmarker {
    static createFromOptions(
      fileset: unknown,
      options: {
        baseOptions: { modelAssetPath: string };
        outputFaceBlendshapes?: boolean;
        outputFacialTransformationMatrixes?: boolean;
        runningMode: "VIDEO";
      }
    ): Promise<FaceLandmarker>;
    close(): void;
    detectForVideo(videoElement: HTMLVideoElement, timestampMs: number): FaceLandmarkerResult;
  }
}

declare module "@mediapipe/tasks-vision/vision_bundle.mjs" {
  export type FaceLandmarkerResult = {
    faceLandmarks: Array<Array<{ x: number; y: number }>>;
  };

  export class FilesetResolver {
    static forVisionTasks(basePath: string): Promise<unknown>;
  }

  export class FaceLandmarker {
    static createFromOptions(
      fileset: unknown,
      options: {
        baseOptions: { modelAssetPath: string };
        outputFaceBlendshapes?: boolean;
        outputFacialTransformationMatrixes?: boolean;
        runningMode: "VIDEO";
      }
    ): Promise<FaceLandmarker>;
    close(): void;
    detectForVideo(videoElement: HTMLVideoElement, timestampMs: number): FaceLandmarkerResult;
  }
}
