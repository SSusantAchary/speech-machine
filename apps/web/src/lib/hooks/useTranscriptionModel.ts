"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";

export type InferenceEngineStatus = {
  id: string;
  label: string;
  base_url: string;
  live: boolean;
  detail: string;
  available_models: string[];
};

export type TranscriptionModelOption = {
  id: string;
  name: string;
  repo_id: string;
  description: string;
  languages: string;
  available: boolean;
  local_path?: string | null;
};

export type TranscriptionBackend = {
  id: string;
  label: string;
  supported: boolean;
  live: boolean;
  detail: string;
  models: TranscriptionModelOption[];
  default_model?: string | null;
};

export type TranscriptionSettings = {
  default_backend: string;
  backends: TranscriptionBackend[];
  text_inference_engines: InferenceEngineStatus[];
};

const LEGACY_AUDIO_MODEL_STORAGE_KEY = "preferred_transcription_model";
const AUDIO_BACKEND_STORAGE_KEY = "preferred_transcription_backend";
const AUDIO_MODELS_STORAGE_KEY = "preferred_transcription_models";
const TEXT_ENGINE_STORAGE_KEY = "preferred_text_inference_engine";
const TEXT_URL_STORAGE_KEY = "preferred_text_inference_urls";

const getStoredValue = (key: string) => {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(key);
};

const setStoredValue = (key: string, value: string) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, value);
};

const getStoredUrls = () => {
  const raw = getStoredValue(TEXT_URL_STORAGE_KEY);
  if (!raw) return {} as Record<string, string>;
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
};

const setStoredUrls = (urls: Record<string, string>) => {
  setStoredValue(TEXT_URL_STORAGE_KEY, JSON.stringify(urls));
};

const getStoredAudioModels = () => {
  const raw = getStoredValue(AUDIO_MODELS_STORAGE_KEY);
  if (!raw) return {} as Record<string, string>;
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
};

export const migrateLegacyAudioModelSelections = (
  currentSelections: Record<string, string>,
  legacyValue: string | null
) => {
  if (!legacyValue || currentSelections.server) return currentSelections;
  return { ...currentSelections, server: legacyValue };
};

const setStoredAudioModels = (models: Record<string, string>) => {
  setStoredValue(AUDIO_MODELS_STORAGE_KEY, JSON.stringify(models));
};

const persistAudioModels = (models: Record<string, string>) => {
  setStoredAudioModels(models);
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(LEGACY_AUDIO_MODEL_STORAGE_KEY);
  }
};

const normalizeAudioModelSelections = () => {
  const currentSelections = getStoredAudioModels();
  const legacyValue = getStoredValue(LEGACY_AUDIO_MODEL_STORAGE_KEY);
  const migratedSelections = migrateLegacyAudioModelSelections(currentSelections, legacyValue);
  if (legacyValue && migratedSelections !== currentSelections) {
    persistAudioModels(migratedSelections);
  }
  return migratedSelections;
};

const findAudioModel = (backend: TranscriptionBackend | undefined, modelId?: string | null) => {
  if (!backend || !modelId) return undefined;
  return backend.models.find((model) => model.id === modelId || model.repo_id === modelId);
};

export const resolvePreferredAudioBackend = (settings: TranscriptionSettings, storedBackend: string | null) => {
  if (storedBackend && settings.backends.some((backend) => backend.id === storedBackend && backend.supported)) {
    return storedBackend;
  }
  if (settings.backends.some((backend) => backend.id === settings.default_backend && backend.supported)) {
    return settings.default_backend;
  }
  return settings.backends.find((backend) => backend.supported)?.id || settings.backends[0]?.id || "server";
};

export const resolvePreferredAudioModel = (
  backend: TranscriptionBackend | undefined,
  storedSelections: Record<string, string>
) => {
  if (!backend) return "";
  const storedModel = findAudioModel(backend, storedSelections[backend.id]);
  if (storedModel) {
    return storedModel.id;
  }
  const defaultModel = findAudioModel(backend, backend.default_model);
  if (defaultModel?.available) {
    return defaultModel.id;
  }
  const firstAvailableModel = backend.models.find((model) => model.available);
  if (firstAvailableModel) {
    return firstAvailableModel.id;
  }
  if (defaultModel) {
    return defaultModel.id;
  }
  return backend.models[0]?.id || "";
};

const resolvePreferredTextEngine = (settings: TranscriptionSettings) => {
  const storedEngine = getStoredValue(TEXT_ENGINE_STORAGE_KEY);
  if (storedEngine && settings.text_inference_engines.some((engine) => engine.id === storedEngine)) {
    return storedEngine;
  }
  return settings.text_inference_engines[0]?.id || "";
};

export const useTranscriptionModel = () => {
  const [settings, setSettings] = useState<TranscriptionSettings | null>(null);
  const [selectedAudioBackend, setSelectedAudioBackendState] = useState("");
  const [selectedAudioModel, setSelectedAudioModelState] = useState("");
  const [audioModelSelections, setAudioModelSelections] = useState<Record<string, string>>({});
  const [selectedTextEngine, setSelectedTextEngineState] = useState("");
  const [textEngineUrls, setTextEngineUrls] = useState<Record<string, string>>({});
  const [textEngineStatuses, setTextEngineStatuses] = useState<Record<string, InferenceEngineStatus>>({});
  const [loadingTextEngineId, setLoadingTextEngineId] = useState<string | null>(null);
  const [loadingAudioModelId, setLoadingAudioModelId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const data = await apiFetch<TranscriptionSettings>("/settings/transcription");
        if (!active) return;

        const preferredAudioBackend = resolvePreferredAudioBackend(data, getStoredValue(AUDIO_BACKEND_STORAGE_KEY));
        const storedAudioSelections = normalizeAudioModelSelections();
        const selectedBackend = data.backends.find((backend) => backend.id === preferredAudioBackend);
        const preferredAudioModel = resolvePreferredAudioModel(selectedBackend, storedAudioSelections);
        const nextAudioSelections = preferredAudioModel
          ? { ...storedAudioSelections, [preferredAudioBackend]: preferredAudioModel }
          : storedAudioSelections;
        const preferredTextEngine = resolvePreferredTextEngine(data);
        const storedUrls = getStoredUrls();
        const nextStatuses = data.text_inference_engines.reduce<Record<string, InferenceEngineStatus>>((acc, engine) => {
          acc[engine.id] = engine;
          return acc;
        }, {});
        const nextUrls = data.text_inference_engines.reduce<Record<string, string>>((acc, engine) => {
          acc[engine.id] = storedUrls[engine.id] || engine.base_url;
          return acc;
        }, {});

        setSettings(data);
        setSelectedAudioBackendState(preferredAudioBackend);
        setSelectedAudioModelState(preferredAudioModel);
        setAudioModelSelections(nextAudioSelections);
        setSelectedTextEngineState(preferredTextEngine);
        setTextEngineStatuses(nextStatuses);
        setTextEngineUrls(nextUrls);
        setStoredValue(AUDIO_BACKEND_STORAGE_KEY, preferredAudioBackend);
        persistAudioModels(nextAudioSelections);
        setStoredValue(TEXT_ENGINE_STORAGE_KEY, preferredTextEngine);
        setStoredUrls(nextUrls);
        setError(null);
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Unable to load transcription settings.");
      }
    };

    load();
    return () => {
      active = false;
    };
  }, []);

  const setSelectedAudioBackend = (backendId: string) => {
    setSelectedAudioBackendState(backendId);
    setStoredValue(AUDIO_BACKEND_STORAGE_KEY, backendId);

    const backend = settings?.backends.find((entry) => entry.id === backendId);
    const nextModel = resolvePreferredAudioModel(backend, audioModelSelections);
    setSelectedAudioModelState(nextModel);
    if (backend && nextModel) {
      const nextSelections = { ...audioModelSelections, [backend.id]: nextModel };
      setAudioModelSelections(nextSelections);
      persistAudioModels(nextSelections);
    }
  };

  const setSelectedAudioModel = (modelId: string) => {
    setSelectedAudioModelState(modelId);
    if (!selectedAudioBackend) return;
    const nextSelections = { ...audioModelSelections, [selectedAudioBackend]: modelId };
    setAudioModelSelections(nextSelections);
    persistAudioModels(nextSelections);
  };

  const setSelectedTextEngine = (engineId: string) => {
    setSelectedTextEngineState(engineId);
    setStoredValue(TEXT_ENGINE_STORAGE_KEY, engineId);
  };

  const setTextEngineUrl = (engineId: string, baseUrl: string) => {
    setTextEngineUrls((current) => {
      const next = { ...current, [engineId]: baseUrl };
      setStoredUrls(next);
      return next;
    });
  };

  const updateDownloadedAudioModel = (backendId: string, downloadedModel: TranscriptionModelOption) => {
    setSettings((current) => {
      if (!current) return current;
      return {
        ...current,
        backends: current.backends.map((backend) => {
          if (backend.id !== backendId) return backend;
          const alreadyListed = backend.models.some((model) => model.id === downloadedModel.id);
          return {
            ...backend,
            models: alreadyListed
              ? backend.models.map((model) => (model.id === downloadedModel.id ? downloadedModel : model))
              : [...backend.models, downloadedModel],
          };
        }),
      };
    });
  };

  const connectTextEngine = async (engineId: string, baseUrl?: string) => {
    const currentBaseUrl = baseUrl || textEngineUrls[engineId] || "";
    setLoadingTextEngineId(engineId);
    setError(null);
    try {
      const status = await apiFetch<InferenceEngineStatus>("/settings/local-inference/check", {
        method: "POST",
        body: JSON.stringify({
          engine_id: engineId,
          base_url: currentBaseUrl,
        }),
      });
      setTextEngineStatuses((current) => ({ ...current, [engineId]: status }));
      setTextEngineUrl(engineId, status.base_url);
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : "Unable to connect to the text engine.");
    } finally {
      setLoadingTextEngineId(null);
    }
  };

  const downloadAudioModel = async (modelId: string) => {
    if (!selectedAudioBackend) return;
    setLoadingAudioModelId(modelId);
    setError(null);
    try {
      const downloadedModel = await apiFetch<TranscriptionModelOption>("/settings/transcription/models/download", {
        method: "POST",
        body: JSON.stringify({
          backend: selectedAudioBackend,
          model: modelId,
        }),
      });
      updateDownloadedAudioModel(selectedAudioBackend, downloadedModel);
      setSelectedAudioModelState(downloadedModel.id);
      const nextSelections = { ...audioModelSelections, [selectedAudioBackend]: downloadedModel.id };
      setAudioModelSelections(nextSelections);
      persistAudioModels(nextSelections);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "Unable to download the selected model.");
    } finally {
      setLoadingAudioModelId(null);
    }
  };

  const selectedAudioBackendStatus = useMemo(
    () => settings?.backends.find((backend) => backend.id === selectedAudioBackend),
    [selectedAudioBackend, settings]
  );
  const selectedAudioModelOption = useMemo(
    () => selectedAudioBackendStatus?.models.find((model) => model.id === selectedAudioModel),
    [selectedAudioBackendStatus, selectedAudioModel]
  );
  const selectedTextEngineStatus = selectedTextEngine ? textEngineStatuses[selectedTextEngine] : undefined;

  useEffect(() => {
    if (!selectedAudioBackendStatus) return;
    const nextModel = resolvePreferredAudioModel(selectedAudioBackendStatus, audioModelSelections);
    if (nextModel && nextModel !== selectedAudioModel) {
      setSelectedAudioModelState(nextModel);
    }
    if (nextModel && audioModelSelections[selectedAudioBackendStatus.id] !== nextModel) {
      const nextSelections = { ...audioModelSelections, [selectedAudioBackendStatus.id]: nextModel };
      setAudioModelSelections(nextSelections);
      persistAudioModels(nextSelections);
    }
  }, [audioModelSelections, selectedAudioBackendStatus, selectedAudioModel]);

  return {
    audioBackends: settings?.backends || [],
    defaultAudioBackend: settings?.default_backend || "",
    selectedAudioBackend,
    setSelectedAudioBackend,
    selectedAudioBackendStatus,
    audioModelOptions: selectedAudioBackendStatus?.models || [],
    selectedAudioModel,
    selectedAudioModelOption,
    setSelectedAudioModel,
    downloadAudioModel,
    loadingAudioModelId,
    effectiveSelection:
      selectedAudioBackend && selectedAudioModel
        ? { backend: selectedAudioBackend, model: selectedAudioModel }
        : undefined,
    textInferenceEngines: settings?.text_inference_engines || [],
    textEngineStatuses,
    selectedTextEngine,
    setSelectedTextEngine,
    textEngineUrls,
    setTextEngineUrl,
    connectTextEngine,
    loadingTextEngineId,
    selectedTextEngineStatus,
    error,
  };
};

export type UseTranscriptionModelResult = ReturnType<typeof useTranscriptionModel>;
