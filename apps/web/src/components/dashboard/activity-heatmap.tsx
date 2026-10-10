"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { HeatmapDay } from "@/lib/dashboard";
import { cn } from "@/lib/utils";

type Props = {
  days: HeatmapDay[];
};

const intensityClass = (count: number) => {
  if (count >= 4) return "bg-emerald-700";
  if (count >= 3) return "bg-emerald-600";
  if (count >= 2) return "bg-emerald-400";
  if (count >= 1) return "bg-emerald-200";
  return "bg-ink/5";
};

export function ActivityHeatmap({ days }: Props) {
  const byDate = new Map(days.map((day) => [day.date, day]));
  const end = new Date();
  const cells = Array.from({ length: 91 }).map((_, index) => {
    const date = new Date(end);
    date.setDate(end.getDate() - (90 - index));
    const key = date.toISOString().slice(0, 10);
    return byDate.get(key) || { date: key, count: 0, minutes: 0 };
  });

  return (
    <Card className="bg-white/80">
      <CardHeader>
        <CardTitle>Practice activity</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(13, minmax(0, 1fr))" }}>
          {cells.map((day) => (
            <div
              key={day.date}
              title={`${day.date}: ${day.count} sessions, ${day.minutes} minutes`}
              className={cn("h-4 rounded-[4px]", intensityClass(day.count))}
            />
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-ink/60">
          <span>Last 90 days</span>
          <span>{days.reduce((total, day) => total + day.count, 0)} sessions</span>
        </div>
      </CardContent>
    </Card>
  );
}
