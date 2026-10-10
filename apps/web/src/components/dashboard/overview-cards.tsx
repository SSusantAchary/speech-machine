"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { OverviewStats } from "@/lib/dashboard";

type Props = {
  overview: OverviewStats | null;
  loading?: boolean;
};

const SkeletonCard = () => (
  <Card>
    <CardContent>
      <div className="h-16 animate-pulse rounded-xl bg-ink/10" />
    </CardContent>
  </Card>
);

const StatCard = ({ title, value, helper }: { title: string; value: string; helper: string }) => (
  <Card>
    <CardHeader>
      <CardTitle>{title}</CardTitle>
    </CardHeader>
    <CardContent>
      <p className="text-3xl font-semibold">{value}</p>
      <p className="mt-1 text-xs text-ink/60">{helper}</p>
    </CardContent>
  </Card>
);

export function OverviewCards({ overview, loading }: Props) {
  if (loading || !overview) {
    return (
      <section className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <SkeletonCard key={index} />
        ))}
      </section>
    );
  }

  const recent = overview.recent_30d;
  return (
    <section className="grid gap-4 md:grid-cols-4">
      <StatCard
        title="Sessions"
        value={String(overview.total_sessions)}
        helper={`${recent.session_count} in the last 30 days`}
      />
      <StatCard
        title="Practice time"
        value={`${Math.round(overview.total_practice_minutes)}m`}
        helper={`${recent.practice_days} practice days this month`}
      />
      <StatCard
        title="Avg score"
        value={`${Math.round(recent.avg_overall_score)}/100`}
        helper={`${Math.round(recent.avg_wpm)} WPM average`}
      />
      <StatCard
        title="Streak"
        value={`${overview.current_streak}d`}
        helper={`Longest streak ${overview.longest_streak}d`}
      />
    </section>
  );
}
