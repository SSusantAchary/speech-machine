"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CoachingFeedback } from "@/lib/dashboard";
import { isCoachingAvailable } from "@/lib/dashboard";

type Props = {
  feedback: CoachingFeedback | null;
};

export function LatestCoachingPanel({ feedback }: Props) {
  if (!isCoachingAvailable(feedback)) {
    return (
      <Card className="bg-white/80">
        <CardHeader>
          <CardTitle>Local AI coach</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-ink/70">
            No coaching feedback yet. Run Ollama locally, complete a transcription, and the worker will generate feedback.
          </p>
          <div className="mt-4 rounded-2xl bg-ink/5 p-3 text-xs text-ink/60">
            Local default: <span className="font-semibold">ollama run llama3.2:3b</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (feedback?.status === "failed") {
    return (
      <Card className="bg-white/80">
        <CardHeader>
          <CardTitle>Local AI coach</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-600">{feedback.error_message || "Coaching generation failed."}</p>
          <p className="mt-2 text-xs text-ink/60">Start your local LLM provider and retry from the session review page.</p>
        </CardContent>
      </Card>
    );
  }

  if (feedback?.status === "pending" || feedback?.status === "generating") {
    return (
      <Card className="bg-white/80">
        <CardHeader>
          <CardTitle>Local AI coach</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-ink/70">Coaching feedback is being generated locally.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-white/80">
      <CardHeader>
        <CardTitle>Latest coaching</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-ink/75">{feedback?.summary}</p>
          {feedback?.practice_plan?.next_session_goal && (
            <div className="rounded-2xl bg-ink/5 p-3 text-sm">
              <p className="font-semibold">Next goal</p>
              <p className="mt-1 text-ink/70">{feedback.practice_plan.next_session_goal}</p>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {(feedback?.practice_plan?.focus_areas || []).map((area) => (
              <span key={area} className="rounded-full bg-white px-3 py-1 text-xs font-medium text-ink/70">
                {area}
              </span>
            ))}
          </div>
          {feedback?.session_id && (
            <Link href={`/session/${feedback.session_id}`}>
              <Button variant="outline">Open coached session</Button>
            </Link>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
