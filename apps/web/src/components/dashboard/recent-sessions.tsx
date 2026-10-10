"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DashboardSession } from "@/lib/dashboard";

type Props = {
  sessions: DashboardSession[];
};

const formatDuration = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
};

export function RecentSessions({ sessions }: Props) {
  return (
    <Card className="bg-white/80">
      <CardHeader>
        <CardTitle>Recent sessions</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {sessions.slice(0, 8).map((session) => (
            <Link
              key={session.session_id}
              href={`/session/${session.session_id}`}
              className="flex items-center justify-between gap-3 rounded-2xl border border-ink/5 bg-white/70 px-4 py-3 transition hover:bg-white"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold">Session {session.session_id}</p>
                <p className="text-xs text-ink/60">
                  {new Date(session.recorded_at).toLocaleString()} - {formatDuration(session.duration_seconds)}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Badge>{Math.round(session.overall_score)}</Badge>
                <span className="text-xs text-ink/60">WPM {Math.round(session.wpm)}</span>
                <span className="text-xs text-ink/60">Fillers {session.filler_count}</span>
              </div>
            </Link>
          ))}
          {!sessions.length && (
            <p className="rounded-2xl border border-dashed border-ink/10 bg-white/60 p-4 text-sm text-ink/60">
              No sessions yet. Start a recording or upload a local video.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
