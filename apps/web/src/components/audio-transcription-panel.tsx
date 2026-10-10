"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import type { TranscriptionModelOption, UseTranscriptionModelResult } from "@/lib/hooks/useTranscriptionModel";
import { cn } from "@/lib/utils";

type AudioTranscriptionPanelProps = {
  transcriptionModel: UseTranscriptionModelResult;
  helperText: string;
  className?: string;
};

const DOWNLOAD_SEGMENT_COUNT = 12;

const ModelStatusDot = ({ available }: { available: boolean }) => (
  <span className={cn("mt-1 h-2.5 w-2.5 rounded-full", available ? "bg-emerald-500" : "bg-ink/20")} />
);

const DownloadMeter = () => {
  const [activeStep, setActiveStep] = useState(1);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveStep((current) => (current >= DOWNLOAD_SEGMENT_COUNT ? 1 : current + 1));
    }, 140);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="w-[5.25rem]" aria-live="polite" aria-label="Downloading model">
      <div className="download-meter">
        {Array.from({ length: DOWNLOAD_SEGMENT_COUNT }).map((_, index) => (
          <span
            key={index}
            className={cn("download-meter__segment", index < activeStep && "download-meter__segment--filled")}
          />
        ))}
      </div>
      <p className="mt-1 text-center text-[9px] font-semibold uppercase tracking-[0.08em] text-emerald-700">
        Downloading
      </p>
    </div>
  );
};

const ModelRow = ({
  model,
  selected,
  loading,
  disabled,
  onSelect,
  onDownload,
}: {
  model: TranscriptionModelOption;
  selected: boolean;
  loading: boolean;
  disabled: boolean;
  onSelect: (modelId: string) => void;
  onDownload: (modelId: string) => void;
}) => (
  <div
    className={cn(
      "rounded-2xl border p-3 transition",
      selected && model.available ? "border-emerald-200 bg-emerald-50/80" : "border-ink/10 bg-white/80"
    )}
  >
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-3">
          <ModelStatusDot available={model.available} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-ink">{model.name}</p>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
                  model.available ? "bg-emerald-100 text-emerald-700" : "bg-black/5 text-ink/60"
                )}
              >
                {model.available ? "Available" : "Not downloaded"}
              </span>
              {selected && model.available && (
                <span className="rounded-full bg-ink px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white">
                  Selected
                </span>
              )}
            </div>
            <p className="mt-1 break-all text-[11px] text-ink/50">{model.repo_id}</p>
            <p className="mt-2 text-xs text-ink/70">{model.description}</p>
            <p className="mt-1 text-[11px] text-ink/50">Languages: {model.languages}</p>
            {model.local_path && (
              <p className="mt-1 break-all text-[11px] text-ink/45">Local path: {model.local_path}</p>
            )}
          </div>
        </div>
      </div>
      {loading ? (
        <div className="w-[5.25rem] shrink-0">
          <DownloadMeter />
        </div>
      ) : model.available ? (
        <Button
          type="button"
          variant={selected ? "ghost" : "outline"}
          size="sm"
          disabled={disabled || selected}
          onClick={() => onSelect(model.id)}
        >
          {selected ? "Selected" : "Use"}
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || loading}
          onClick={() => onDownload(model.id)}
        >
          {loading ? "Downloading..." : "Download"}
        </Button>
      )}
    </div>
  </div>
);

export function AudioTranscriptionPanel({
  transcriptionModel,
  helperText,
  className,
}: AudioTranscriptionPanelProps) {
  const backend = transcriptionModel.selectedAudioBackendStatus;
  const [modelsOpen, setModelsOpen] = useState(false);
  const selectedModel = transcriptionModel.selectedAudioModelOption;
  const availableCount = transcriptionModel.audioModelOptions.filter((model) => model.available).length;
  const totalCount = transcriptionModel.audioModelOptions.length;

  return (
    <div className={cn("rounded-2xl border border-ink/10 bg-white/70 p-3", className)}>
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Audio Transcription</p>
      <div className="mt-3 flex flex-col gap-3">
        <div>
          <p className="mb-2 text-xs text-ink/60">Backend</p>
          <Select
            value={transcriptionModel.selectedAudioBackend}
            onChange={(event) => transcriptionModel.setSelectedAudioBackend(event.target.value)}
            disabled={!transcriptionModel.audioBackends.length}
          >
            {transcriptionModel.audioBackends.map((entry) => (
              <option key={entry.id} value={entry.id} disabled={!entry.supported}>
                {entry.label}
                {!entry.supported ? " (unavailable)" : ""}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-2xl border border-ink/10 bg-white/80 px-4 py-3 text-left transition hover:bg-white"
            aria-expanded={modelsOpen}
            onClick={() => setModelsOpen((current) => !current)}
          >
            <div className="min-w-0">
              <p className="text-xs text-ink/60">Supported models</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-ink">
                  {selectedModel?.name || (totalCount ? "Choose a model" : "No models")}
                </span>
                <span className="rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink/60">
                  {availableCount}/{totalCount} downloaded
                </span>
                {selectedModel && <ModelStatusDot available={selectedModel.available} />}
              </div>
            </div>
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/60">
              {modelsOpen ? "Hide" : "Show"}
            </span>
          </button>

          {modelsOpen && (
            <div className="mt-3 space-y-3">
              {transcriptionModel.audioModelOptions.length > 1 && (
                <p className="text-xs text-ink/60">Scroll down to browse the catalog.</p>
              )}

              {!transcriptionModel.audioModelOptions.length && (
                <div className="rounded-2xl border border-ink/10 bg-white/80 p-3 text-xs text-ink/60">
                  No models are available in this runtime.
                </div>
              )}

              {transcriptionModel.audioModelOptions.length > 0 && (
                <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
                  {transcriptionModel.audioModelOptions.map((model) => (
                    <ModelRow
                      key={model.id}
                      model={model}
                      selected={transcriptionModel.selectedAudioModel === model.id}
                      loading={transcriptionModel.loadingAudioModelId === model.id}
                      disabled={!backend?.supported}
                      onSelect={transcriptionModel.setSelectedAudioModel}
                      onDownload={transcriptionModel.downloadAudioModel}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <p className="text-xs text-ink/60">{helperText}</p>

        {backend && (
          <div className="rounded-2xl bg-white/80 p-3 text-xs">
            <p className={backend.supported ? "font-semibold text-emerald-700" : "font-semibold text-amber-700"}>
              {backend.label} {backend.supported ? "is ready" : "is unavailable"}
            </p>
            <p className="mt-1 text-ink/60">{backend.detail}</p>
          </div>
        )}
      </div>
    </div>
  );
}
