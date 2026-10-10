"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SessionDocument } from "@/lib/documentReader";
import { cn } from "@/lib/utils";

type DocumentReaderPanelProps = {
  title?: string;
  document: SessionDocument | null;
  activeBlockIndex?: number;
  error?: string | null;
  helperText?: string;
  readOnly?: boolean;
  onPickFile?: (file: File | null) => void;
  onClear?: () => void;
};

export function DocumentReaderPanel({
  title = "Reading Document",
  document,
  activeBlockIndex = -1,
  error,
  helperText,
  readOnly = false,
  onPickFile,
  onClear,
}: DocumentReaderPanelProps) {
  const blockRefs = useRef<(HTMLParagraphElement | null)[]>([]);

  useEffect(() => {
    if (activeBlockIndex < 0) return;
    blockRefs.current[activeBlockIndex]?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [activeBlockIndex]);

  return (
    <div className="rounded-3xl bg-white/80 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink/60">{title}</p>
          <p className="mt-1 text-sm text-ink/60">
            {document ? `${document.name} · ${document.blocks.length} blocks` : "Upload a PDF or TXT to read while recording."}
          </p>
        </div>
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="file"
              accept=".pdf,.txt,application/pdf,text/plain"
              onChange={(event) => onPickFile?.(event.target.files?.[0] || null)}
              className="h-10 w-[220px]"
            />
            {document && onClear && (
              <Button type="button" variant="outline" size="sm" onClick={onClear}>
                Clear
              </Button>
            )}
          </div>
        )}
      </div>

      {helperText && <p className="mt-3 text-xs text-ink/60">{helperText}</p>}
      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

      <div className="mt-4 max-h-80 overflow-y-auto rounded-3xl border border-ink/10 bg-white/75 p-4">
        {!document && (
          <div className="flex min-h-[180px] items-center justify-center text-center text-sm text-ink/55">
            No reading document loaded yet.
          </div>
        )}
        {document && (
          <div className="space-y-3">
            {document.blocks.map((block) => {
              const isActive = block.index === activeBlockIndex;
              return (
                <p
                  key={block.index}
                  ref={(node) => {
                    blockRefs.current[block.index] = node;
                  }}
                  className={cn(
                    "rounded-2xl px-3 py-2 text-sm leading-7 text-ink/80 transition",
                    isActive ? "bg-amber-100 text-ink shadow-sm" : "bg-transparent"
                  )}
                >
                  {block.text}
                </p>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
