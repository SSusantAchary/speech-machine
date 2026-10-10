"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ActivityHeatmap } from "@/components/dashboard/activity-heatmap";
import { FillerBreakdown } from "@/components/dashboard/filler-breakdown";
import { LatestCoachingPanel } from "@/components/dashboard/latest-coaching-panel";
import { GoalsPanel } from "@/components/dashboard/goals-panel";
import { OverviewCards } from "@/components/dashboard/overview-cards";
import { RecentSessions } from "@/components/dashboard/recent-sessions";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { AudioTranscriptionPanel } from "@/components/audio-transcription-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useRequireAuth } from "@/lib/hooks/useRequireAuth";
import { useTranscriptionModel } from "@/lib/hooks/useTranscriptionModel";
import { createSession, getVideoDurationMs, triggerTranscription, uploadVideoFile } from "@/lib/session";
import { useDashboardStore } from "@/store/useDashboardStore";

export default function DashboardPage() {
  useRequireAuth();
  const router = useRouter();
  const {
    overview,
    trends,
    sessions,
    heatmap,
    fillers,
    latestCoaching,
    goals,
    loading,
    error,
    fetchAll,
    createGoal,
    updateGoal,
    deleteGoal,
  } = useDashboardStore();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const transcriptionModel = useTranscriptionModel();

  useEffect(() => {
    fetchAll().catch(() => {});
  }, [fetchAll]);

  const handleUpload = async () => {
    if (!selectedFile) {
      setUploadError("Choose a video file first.");
      return;
    }
    if (transcriptionModel.selectedAudioBackendStatus?.supported && !transcriptionModel.selectedAudioModelOption?.available) {
      setUploadError("Download the selected transcription model before transcribing this video.");
      return;
    }

    setUploading(true);
    setUploadError(null);
    try {
      const durationMs = await getVideoDurationMs(selectedFile);
      const session = await createSession({
        title: selectedFile.name.replace(/\.[^.]+$/, ""),
        mode: "Upload",
        prompt: `Uploaded video: ${selectedFile.name}`,
        goal: "Transcribe uploaded video",
        durationMs,
        wpmAvg: 0,
        fillerCount: 0,
        eyeContactPct: 0,
        transcript: [],
        metrics: [],
        tags: ["uploaded"],
      });
      await uploadVideoFile(session.id, selectedFile);
      await triggerTranscription(session.id, transcriptionModel.effectiveSelection);
      router.push(`/session/${session.id}`);
    } catch (uploadFailure) {
      setUploadError(uploadFailure instanceof Error ? uploadFailure.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="min-h-screen px-6 py-10">
      <div className="mx-auto flex max-w-7xl flex-col gap-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink/60">Speech-Machine</p>
            <h1 className="font-display text-4xl font-semibold">Practice analytics</h1>
            <p className="text-sm text-ink/70">
              Track progress, review local coaching, and start your next speaking session.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={() => fetchAll()}>
              Refresh
            </Button>
            <Link href="/record">
              <Button size="lg" className="rounded-full">
                Start session
              </Button>
            </Link>
          </div>
        </header>

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <OverviewCards overview={overview} loading={loading} />

        <GoalsPanel goals={goals} onCreate={createGoal} onUpdate={updateGoal} onDelete={deleteGoal} />

        <section className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
          <LatestCoachingPanel feedback={latestCoaching} />
          <ActivityHeatmap days={heatmap} />
        </section>

        <section className="grid gap-6 lg:grid-cols-3">
          <TrendChart
            title="Overall score"
            data={trends.avg_overall_score}
            color="#232732"
            unit="/100"
            emptyText="Complete a session to see score trends."
          />
          <TrendChart
            title="Words per minute"
            data={trends.avg_wpm}
            color="#0f766e"
            unit=" WPM"
            emptyText="Complete a session to see pace trends."
          />
          <TrendChart
            title="Fillers per minute"
            data={trends.avg_filler_rate}
            color="#c2410c"
            unit="/min"
            emptyText="Complete a transcribed session to see filler trends."
          />
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
          <RecentSessions sessions={sessions} />
          <FillerBreakdown fillers={fillers} />
        </section>

        <Card className="bg-white/80">
          <CardHeader>
            <CardTitle>Upload local video</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr_auto] lg:items-start">
              <div className="space-y-3">
                <Input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
                />
                <div className="rounded-2xl bg-white/70 p-3">
                  <p className="text-sm font-semibold text-ink">{selectedFile?.name || "No file selected"}</p>
                  {selectedFile && (
                    <p className="text-xs text-ink/60">
                      {(selectedFile.size / (1024 * 1024)).toFixed(1)} MB
                    </p>
                  )}
                </div>
              </div>
              <AudioTranscriptionPanel
                transcriptionModel={transcriptionModel}
                helperText="The selected local backend and model are used for uploaded-video transcription."
              />
              <Button className="w-full lg:w-auto" onClick={handleUpload} disabled={uploading}>
                {uploading ? "Uploading..." : "Upload and transcribe"}
              </Button>
            </div>
            {uploadError && <p className="mt-3 text-sm text-red-600">{uploadError}</p>}
            {transcriptionModel.error && <p className="mt-3 text-sm text-red-600">{transcriptionModel.error}</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
