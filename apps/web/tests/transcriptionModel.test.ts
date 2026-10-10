import { describe, expect, it } from "vitest";
import {
  migrateLegacyAudioModelSelections,
  resolvePreferredAudioBackend,
  resolvePreferredAudioModel,
  type TranscriptionBackend,
  type TranscriptionModelOption,
  type TranscriptionSettings,
} from "@/lib/hooks/useTranscriptionModel";

const createModel = (overrides: Partial<TranscriptionModelOption>): TranscriptionModelOption => ({
  id: "openai/whisper-small",
  name: "Whisper Small",
  repo_id: "openai/whisper-small",
  description: "desc",
  languages: "99+ languages",
  available: false,
  local_path: null,
  ...overrides,
});

const createBackend = (overrides: Partial<TranscriptionBackend>): TranscriptionBackend => ({
  id: "server",
  label: "Built-in Server",
  supported: true,
  live: true,
  detail: "ready",
  models: [createModel({ id: "openai/whisper-small", name: "Whisper Small" })],
  default_model: "openai/whisper-small",
  ...overrides,
});

const settings: TranscriptionSettings = {
  default_backend: "server",
  backends: [
    createBackend({
      id: "server",
      models: [
        createModel({
          id: "openai/whisper-small",
          name: "Whisper Small",
          available: true,
          local_path: "/tmp/models/whisper-small",
        }),
        createModel({
          id: "openai/whisper-medium",
          name: "Whisper Medium",
          repo_id: "openai/whisper-medium",
        }),
      ],
      default_model: "openai/whisper-small",
    }),
    createBackend({
      id: "mlx_audio",
      label: "MLX Audio",
      models: [
        createModel({
          id: "mlx-community/parakeet-tdt-0.6b-v3",
          name: "Parakeet",
          repo_id: "mlx-community/parakeet-tdt-0.6b-v3",
          local_path: "/tmp/models/parakeet",
        }),
      ],
      default_model: "mlx-community/parakeet-tdt-0.6b-v3",
    }),
  ],
  text_inference_engines: [],
};

describe("transcription model preferences", () => {
  it("migrates the legacy flat model setting into the server backend bucket", () => {
    expect(migrateLegacyAudioModelSelections({}, "medium")).toEqual({ server: "medium" });
  });

  it("prefers a supported stored backend", () => {
    expect(resolvePreferredAudioBackend(settings, "mlx_audio")).toBe("mlx_audio");
  });

  it("falls back to the default supported backend when stored backend is missing", () => {
    expect(resolvePreferredAudioBackend(settings, "missing")).toBe("server");
  });

  it("resolves the stored model for the selected backend", () => {
    expect(resolvePreferredAudioModel(settings.backends[1], { mlx_audio: "mlx-community/parakeet-tdt-0.6b-v3" })).toBe(
      "mlx-community/parakeet-tdt-0.6b-v3"
    );
  });

  it("falls back to the backend default model when stored model is invalid", () => {
    expect(resolvePreferredAudioModel(settings.backends[0], { server: "unknown" })).toBe("openai/whisper-small");
  });

  it("falls back to the first available model before an unavailable default", () => {
    const backend = createBackend({
      id: "mlx_audio",
      default_model: "mlx-community/whisper-large-v3-turbo-asr-fp16",
      models: [
        createModel({
          id: "mlx-community/whisper-large-v3-turbo-asr-fp16",
          name: "Whisper",
          repo_id: "mlx-community/whisper-large-v3-turbo-asr-fp16",
          available: false,
        }),
        createModel({
          id: "mlx-community/parakeet-tdt-0.6b-v3",
          name: "Parakeet",
          repo_id: "mlx-community/parakeet-tdt-0.6b-v3",
          available: true,
          local_path: "/tmp/models/parakeet",
        }),
      ],
    });

    expect(resolvePreferredAudioModel(backend, {})).toBe("mlx-community/parakeet-tdt-0.6b-v3");
  });
});
