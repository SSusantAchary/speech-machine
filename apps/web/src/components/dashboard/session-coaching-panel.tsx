"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { coachingApi, isCoachingPending, type CoachingFeedback } from "@/lib/dashboard";

type Props = {
  sessionId: number;
};

export function SessionCoachingPanel({ sessionId }: Props) {
  const [feedback, setFeedback] = useState<CoachingFeedback | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await coachingApi.session(sessionId);
      setFeedback(next);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    if (!isCoachingPending(feedback)) return undefined;
    const interval = window.setInterval(() => {
      load().catch(() => {});
    }, 3000);
    return () => window.clearInterval(interval);
  }, [feedback, load]);

  const retry = async () => {
    setRetrying(true);
    try {
      await coachingApi.retry(sessionId);
      await load();
    } finally {
      setRetrying(false);
    }
  };

  if (loading) {
    return (
      <Card className="bg-white/80">
        <CardContent>
          <div className="h-16 animate-pulse rounded-xl bg-ink/10" />
        </CardContent>
      </Card>
    );
  }

  if (!feedback || feedback.status === "not_available") {
    return (
      <Card className="bg-white/80">
        <CardHeader>
          <CardTitle>Local AI coaching</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink/70">
              Coaching is not available yet. Start Ollama and retry after the transcript is complete.
            </p>
            <Button variant="outline" onClick={retry} disabled={retrying}>
              {retrying ? "Queueing..." : "Generate coaching"}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (feedback.status === "pending" || feedback.status === "generating") {
    return (
      <Card className="bg-white/80">
        <CardHeader>
          <CardTitle>Local AI coaching</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-ink/70">Your local AI coach is analyzing this session.</p>
        </CardContent>
      </Card>
    );
  }

  if (feedback.status === "failed") {
    return (
      <Card className="bg-white/80">
        <CardHeader>
          <CardTitle>Local AI coaching</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <p className="text-sm text-red-600">{feedback.error_message || "Coaching generation failed."}</p>
            <Button variant="outline" onClick={retry} disabled={retrying}>
              {retrying ? "Queueing..." : "Retry coaching"}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-white/80">
      <CardHeader>
        <CardTitle>Local AI coaching</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-5">
          <p className="text-sm leading-relaxed text-ink/75">{feedback.summary}</p>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl bg-emerald-50 p-4">
              <p className="text-sm font-semibold text-emerald-800">Strengths</p>
              <div className="mt-3 space-y-2">
                {(feedback.strengths || []).map((item, index) => (
                  <div key={`${item.area}-${index}`}>
                    <p className="text-xs font-semibold uppercase text-emerald-700">{item.area}</p>
                    <p className="text-sm text-emerald-900">{item.detail}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-2xl bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-800">Improve next</p>
              <div className="mt-3 space-y-2">
                {(feedback.improvements || []).map((item, index) => (
                  <div key={`${item.area}-${index}`}>
                    <p className="text-xs font-semibold uppercase text-amber-700">{item.area}</p>
                    <p className="text-sm text-amber-900">{item.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
          {feedback.practice_plan?.next_session_goal && (
            <div className="rounded-2xl bg-ink/5 p-4 text-sm">
              <p className="font-semibold">Next session goal</p>
              <p className="mt-1 text-ink/70">{feedback.practice_plan.next_session_goal}</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
