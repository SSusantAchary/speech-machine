"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { apiFetch, ensureAccessToken } from "@/lib/api";
import { DocumentReaderPanel } from "@/components/document-reader-panel";
import { splitTextByFillers } from "@/lib/fillers";
import { useRequireAuth } from "@/lib/hooks/useRequireAuth";
import { Select } from "@/components/ui/select";
import { deleteSession } from "@/lib/session";
import { SessionCoachingPanel } from "@/components/dashboard/session-coaching-panel";

type TranscriptSegment = {
  id: number;
  start_ms: number;
  end_ms: number;
  text: string;
};

type MetricPoint = {
  t: number;
  wpm: number;
  rms: number;
  eye_contact: number;
  smile: number;
  yaw: number;
  pitch: number;
  roll: number;
  filler_count: number;
  pause_ms: number;
};

type Session = {
  id: number;
  title?: string;
  mode?: string;
  prompt?: string;
  duration_ms: number;
  wpm_avg: number;
  filler_count: number;
  eye_contact_pct: number;
  video_path?: string | null;
  transcription_status: string;
  transcript_segments: TranscriptSegment[];
  metrics: MetricPoint[];
  document?: {
    name: string;
    mime_type: string;
    blocks: { index: number; text: string }[];
  } | null;
  score?: {
    total?: number;
    speech?: number;
    delivery?: number;
    content?: number;
    topFixes?: string[];
    recommendedDrill?: string;
  };
};

type SessionOption = {
  id: number;
  title?: string;
  mode?: string;
  wpm_avg: number;
  filler_count: number;
  eye_contact_pct: number;
  score?: { total?: number };
};

const formatTime = (ms: number) => {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

const formatSeconds = (seconds: number) => formatTime(seconds * 1000);

export default function SessionPage() {
  useRequireAuth();
  const params = useParams();
  const router = useRouter();
  const sessionId = params?.id as string;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  const [session, setSession] = useState<Session | null>(null);
  const [sessionOptions, setSessionOptions] = useState<SessionOption[]>([]);
  const [compareId, setCompareId] = useState<string>("");
  const [compareSession, setCompareSession] = useState<SessionOption | null>(null);
  const [query, setQuery] = useState("");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoActionError, setVideoActionError] = useState<string | null>(null);
  const [deletingVideo, setDeletingVideo] = useState(false);
  const [deletingSession, setDeletingSession] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadingFormat, setDownloadingFormat] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoUrlRef = useRef<string | null>(null);

  const loadSession = useCallback(async () => {
    if (!sessionId) return;
    const data = await apiFetch<Session>(`/sessions/${sessionId}`);
    setSession(data);
  }, [sessionId]);

  useEffect(() => {
    const load = async () => {
      await loadSession();
    };
    if (sessionId) {
      load();
    }
  }, [loadSession, sessionId]);

  useEffect(() => {
    if (!session || !["queued", "processing"].includes(session.transcription_status)) {
      return;
    }

    const interval = window.setInterval(() => {
      loadSession().catch(() => {});
    }, 3000);

    return () => window.clearInterval(interval);
  }, [loadSession, session]);

  useEffect(() => {
    const loadList = async () => {
      const data = await apiFetch<SessionOption[]>(`/sessions`);
      setSessionOptions(data);
    };
    loadList();
  }, []);

  const downloadAsset = useCallback(
    async (path: string, fallbackName: string, format: string) => {
      const token = await ensureAccessToken();
      if (!token) {
        setDownloadError("Sign in again to download the transcript.");
        return;
      }

      setDownloadingFormat(format);
      setDownloadError(null);
      try {
        const response = await fetch(`${apiUrl}${path}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
          const message = await response.text();
          throw new Error(message || "Download failed.");
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = fallbackName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      } catch (error) {
        setDownloadError(error instanceof Error ? error.message : "Download failed.");
      } finally {
        setDownloadingFormat(null);
      }
    },
    [apiUrl]
  );

  const clearVideoUrl = useCallback(() => {
    if (videoUrlRef.current) {
      URL.revokeObjectURL(videoUrlRef.current);
      videoUrlRef.current = null;
    }
    setVideoUrl(null);
  }, []);

  const handleDeleteVideo = useCallback(async () => {
    if (!session?.video_path) return;
    if (!window.confirm("Delete the saved video from this session? The transcript and score will stay.")) {
      return;
    }

    setDeletingVideo(true);
    setVideoActionError(null);
    try {
      const result = await apiFetch<{ status: string; transcription_status: string }>(
        `/sessions/${session.id}/video`,
        { method: "DELETE" }
      );
      clearVideoUrl();
      setVideoError(null);
      setSession((current) =>
        current
          ? {
              ...current,
              video_path: null,
              transcription_status: result.transcription_status,
            }
          : current
      );
    } catch (error) {
      setVideoActionError(error instanceof Error ? error.message : "Unable to delete video.");
    } finally {
      setDeletingVideo(false);
    }
  }, [clearVideoUrl, session]);

  const handleDeleteSession = useCallback(async () => {
    if (!session) return;
    if (!window.confirm("Delete this session and all of its saved data?")) {
      return;
    }

    setDeletingSession(true);
    setVideoActionError(null);
    try {
      await deleteSession(session.id);
      router.push("/");
    } catch (error) {
      setVideoActionError(error instanceof Error ? error.message : "Unable to delete session.");
    } finally {
      setDeletingSession(false);
    }
  }, [router, session]);

  useEffect(() => {
    if (!sessionId || !session) return;
    if (!session.video_path) {
      clearVideoUrl();
      setVideoError(null);
      return;
    }
    const controller = new AbortController();
    const loadVideo = async () => {
      try {
        setVideoError(null);
        const token = await ensureAccessToken();
        if (!token) {
          throw new Error("Missing auth token. Sign in again.");
        }
        const response = await fetch(`${apiUrl}/sessions/${sessionId}/video`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (!response.ok) {
          const message = await response.text();
          throw new Error(message || `Video request failed (${response.status})`);
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        clearVideoUrl();
        videoUrlRef.current = url;
        setVideoUrl(url);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        clearVideoUrl();
        setVideoError(error instanceof Error ? error.message : "Unable to load video.");
      }
    };
    loadVideo();
    return () => controller.abort();
  }, [apiUrl, clearVideoUrl, session, sessionId]);

  useEffect(
    () => () => {
      clearVideoUrl();
    },
    [clearVideoUrl]
  );

  useEffect(() => {
    if (!compareId) return;
    const target = sessionOptions.find((item) => item.id.toString() === compareId);
    setCompareSession(target || null);
  }, [compareId, sessionOptions]);

  const markers = useMemo(() => {
    if (!session) return [];
    const avgWpm = session.metrics.reduce((acc, m) => acc + m.wpm, 0) / Math.max(1, session.metrics.length);
    return session.metrics
      .flatMap((m) => {
        const events = [] as { label: string; t: number }[];
        if (m.wpm > avgWpm + 30) events.push({ label: "Fast WPM spike", t: m.t });
        if (m.pause_ms > 1500) events.push({ label: "Long pause", t: m.t });
        if (m.filler_count > 2) events.push({ label: "Filler burst", t: m.t });
        if (m.rms < 15) events.push({ label: "Low volume", t: m.t });
        if (m.eye_contact < 0.4) events.push({ label: "Low eye contact", t: m.t });
        return events;
      })
      .slice(0, 12);
  }, [session]);

  const chartData = useMemo(() => {
    if (!session) return [];
    return session.metrics.map((point) => ({
      t: point.t,
      wpm: Math.round(point.wpm),
      rms: Math.round(point.rms),
      eye: Math.round(point.eye_contact * 100),
      smile: Math.round(point.smile * 100),
      fillers: point.filler_count,
      pauseSec: Math.round(point.pause_ms / 1000),
    }));
  }, [session]);

  const filteredTranscript = useMemo(() => {
    if (!session) return [];
    if (!query) return session.transcript_segments;
    return session.transcript_segments.filter((seg) => seg.text.toLowerCase().includes(query.toLowerCase()));
  }, [session, query]);

  const canDownloadTranscript = Boolean(session?.transcript_segments.length);
  const hasVideo = Boolean(session?.video_path);

  if (!session) {
    return <div className="min-h-screen px-6 py-10">Loading...</div>;
  }

  return (
    <div className="min-h-screen px-6 py-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink/60">Speech-Machine</p>
            <h1 className="font-display text-3xl font-semibold">{session.title || "Session review"}</h1>
            <p className="text-sm text-ink/60">{session.mode} - {formatTime(session.duration_ms)}</p>
            <p className="mt-2 text-xs font-semibold uppercase tracking-[0.2em] text-ink/50">
              Transcription {session.transcription_status}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              onClick={() => downloadAsset(`/sessions/${session.id}/transcript.txt`, `session-${session.id}-transcript.txt`, "txt")}
              disabled={!canDownloadTranscript || downloadingFormat !== null}
            >
              {downloadingFormat === "txt" ? "Downloading..." : "Transcript TXT"}
            </Button>
            <Button
              variant="outline"
              onClick={() => downloadAsset(`/sessions/${session.id}/transcript.pdf`, `session-${session.id}-transcript.pdf`, "pdf")}
              disabled={!canDownloadTranscript || downloadingFormat !== null}
            >
              {downloadingFormat === "pdf" ? "Downloading..." : "Transcript PDF"}
            </Button>
            <Button
              variant="danger"
              onClick={handleDeleteVideo}
              disabled={!hasVideo || deletingVideo}
            >
              {deletingVideo ? "Deleting..." : "Delete Video"}
            </Button>
            <Button
              variant="danger"
              onClick={handleDeleteSession}
              disabled={deletingSession}
            >
              {deletingSession ? "Deleting..." : "Delete Session"}
            </Button>
            <Link href="/">
              <Button variant="ghost">Back</Button>
            </Link>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1.8fr_1fr]">
          <Card className="bg-white/80">
            <CardHeader>
              <CardTitle>Playback</CardTitle>
            </CardHeader>
            <CardContent>
              {hasVideo ? (
                <video
                  className="w-full rounded-3xl bg-black"
                  controls
                  src={videoUrl || ""}
                  ref={videoRef}
                />
              ) : (
                <div className="flex min-h-[240px] items-center justify-center rounded-3xl border border-dashed border-ink/15 bg-white/60 px-6 text-center text-sm text-ink/60">
                  Video removed. The transcript, score, and downloads remain available.
                </div>
              )}
              {videoError && <p className="mt-2 text-xs text-red-600">{videoError}</p>}
              {videoActionError && <p className="mt-2 text-xs text-red-600">{videoActionError}</p>}
              {downloadError && <p className="mt-2 text-xs text-red-600">{downloadError}</p>}
              {session.transcription_status !== "complete" && (
                <p className="mt-2 text-xs text-ink/60">
                  Transcript processing is still running. This page refreshes automatically every few seconds.
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="bg-white/80">
            <CardHeader>
              <CardTitle>Score</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <p className="text-4xl font-semibold">{session.score?.total ?? 0}</p>
                <div className="flex flex-wrap gap-2">
                  <Badge>Speech {session.score?.speech ?? 0}</Badge>
                  <Badge>Delivery {session.score?.delivery ?? 0}</Badge>
                  <Badge>Content {session.score?.content ?? 0}</Badge>
                </div>
                <div className="text-sm text-ink/70">
                  <p className="font-semibold">Top fixes</p>
                  <ul className="mt-2 space-y-1">
                    {(session.score?.topFixes || []).map((fix, idx) => (
                      <li key={idx}>{fix}</li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-2xl bg-ink/5 p-3 text-sm">
                  Next drill: {session.score?.recommendedDrill || "Focus drill"}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="bg-white/80">
            <CardHeader>
              <CardTitle>WPM + Volume</CardTitle>
            </CardHeader>
            <CardContent>
              {chartData.length ? (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="t" tickFormatter={formatSeconds} stroke="#64748b" fontSize={12} />
                    <YAxis yAxisId="left" stroke="#1f2937" fontSize={12} />
                    <YAxis yAxisId="right" orientation="right" stroke="#f97316" fontSize={12} />
                    <Tooltip labelFormatter={(value) => `Time ${formatSeconds(Number(value))}`} />
                    <Legend />
                    <Line yAxisId="left" type="monotone" dataKey="wpm" stroke="#232732" strokeWidth={2} dot={false} />
                    <Line yAxisId="right" type="monotone" dataKey="rms" stroke="#f97316" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-ink/60">No metrics captured yet.</p>
              )}
            </CardContent>
          </Card>

          <Card className="bg-white/80">
            <CardHeader>
              <CardTitle>Eye Contact + Smile</CardTitle>
            </CardHeader>
            <CardContent>
              {chartData.length ? (
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="t" tickFormatter={formatSeconds} stroke="#64748b" fontSize={12} />
                    <YAxis domain={[0, 100]} stroke="#1f2937" fontSize={12} />
                    <Tooltip labelFormatter={(value) => `Time ${formatSeconds(Number(value))}`} />
                    <Legend />
                    <Area type="monotone" dataKey="eye" stroke="#16a34a" fill="rgba(22, 163, 74, 0.15)" strokeWidth={2} />
                    <Area type="monotone" dataKey="smile" stroke="#f97316" fill="rgba(249, 115, 22, 0.15)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-ink/60">No metrics captured yet.</p>
              )}
            </CardContent>
          </Card>

          <Card className="bg-white/80">
            <CardHeader>
              <CardTitle>Fillers + Pauses</CardTitle>
            </CardHeader>
            <CardContent>
              {chartData.length ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="t" tickFormatter={formatSeconds} stroke="#64748b" fontSize={12} />
                    <YAxis yAxisId="left" stroke="#1f2937" fontSize={12} />
                    <YAxis yAxisId="right" orientation="right" stroke="#0f766e" fontSize={12} />
                    <Tooltip labelFormatter={(value) => `Time ${formatSeconds(Number(value))}`} />
                    <Legend />
                    <Bar yAxisId="left" dataKey="fillers" fill="#475569" radius={[6, 6, 0, 0]} />
                    <Bar yAxisId="right" dataKey="pauseSec" fill="#0ea5a6" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-ink/60">No metrics captured yet.</p>
              )}
            </CardContent>
          </Card>
        </div>

        <SessionCoachingPanel sessionId={Number(sessionId)} />

        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <Card className="bg-white/80">
            <CardHeader>
              <CardTitle>Transcript</CardTitle>
            </CardHeader>
            <CardContent>
              <Input
                placeholder="Search transcript"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <div className="mt-4 max-h-[420px] space-y-3 overflow-auto text-sm">
                {!filteredTranscript.length && (
                  <p className="rounded-2xl border border-ink/5 bg-white/70 p-3 text-ink/60">
                    {session.transcription_status === "complete"
                      ? "No transcript segments available for this session."
                      : "Transcript is still processing. Check back in a moment."}
                  </p>
                )}
                {filteredTranscript.map((seg) => (
                  <div key={seg.id} className="rounded-2xl border border-ink/5 bg-white/70 p-3">
                    <p className="text-xs text-ink/50">{formatTime(seg.start_ms)}</p>
                    <p>
                      {splitTextByFillers(seg.text).map((part, index) => (
                        <span
                          key={`${seg.id}-${index}-${part.text}`}
                          className={part.isFiller ? "font-semibold text-red-600" : undefined}
                        >
                          {part.text}
                        </span>
                      ))}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white/80">
            <CardHeader>
              <CardTitle>Timeline markers</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm">
                {markers.map((marker, idx) => (
                  <button
                    key={`${marker.label}-${idx}`}
                    className="flex w-full items-center justify-between rounded-xl border border-ink/5 bg-white/60 px-3 py-2 text-left"
                    onClick={() => {
                      if (videoRef.current) {
                        videoRef.current.currentTime = marker.t;
                        videoRef.current.play();
                      }
                    }}
                  >
                    <span>{marker.label}</span>
                    <span className="text-xs text-ink/50">{marker.t}s</span>
                  </button>
                ))}
                {!markers.length && <p className="text-xs text-ink/60">No markers yet.</p>}
              </div>
            </CardContent>
          </Card>
        </div>

        {session.document && (
          <DocumentReaderPanel
            title="Reading Document"
            document={{
              name: session.document.name,
              mimeType: session.document.mime_type,
              blocks: session.document.blocks,
            }}
            readOnly
            helperText="Saved reading document for this session."
          />
        )}

        <Card className="bg-white/80">
          <CardHeader>
            <CardTitle>Compare</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink/60">This session</p>
                <div className="flex flex-wrap gap-2 text-sm">
                  <Badge>Score {session.score?.total ?? 0}</Badge>
                  <Badge>WPM {Math.round(session.wpm_avg)}</Badge>
                  <Badge>Eye {Math.round(session.eye_contact_pct * 100)}%</Badge>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink/60">Compare with</p>
                <Select value={compareId} onChange={(event) => setCompareId(event.target.value)}>
                  <option value="">Select session</option>
                  {sessionOptions
                    .filter((option) => option.id !== session.id)
                    .map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.title || option.mode || `Session ${option.id}`}
                      </option>
                    ))}
                </Select>
                {compareSession && (
                  <div className="flex flex-wrap gap-2 text-sm">
                    <Badge>Score {compareSession.score?.total ?? 0}</Badge>
                    <Badge>WPM {Math.round(compareSession.wpm_avg)}</Badge>
                    <Badge>Eye {Math.round(compareSession.eye_contact_pct * 100)}%</Badge>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
