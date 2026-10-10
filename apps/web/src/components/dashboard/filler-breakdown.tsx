"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Props = {
  fillers: Record<string, number>;
};

export function FillerBreakdown({ fillers }: Props) {
  const entries = Object.entries(fillers).slice(0, 8);
  const max = Math.max(1, ...entries.map(([, count]) => count));

  return (
    <Card className="bg-white/80">
      <CardHeader>
        <CardTitle>Filler words</CardTitle>
      </CardHeader>
      <CardContent>
        {entries.length ? (
          <div className="space-y-3">
            {entries.map(([word, count]) => (
              <div key={word}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium">{word}</span>
                  <span className="text-ink/60">{count}</span>
                </div>
                <div className="h-2 rounded-full bg-ink/10">
                  <div
                    className="h-2 rounded-full bg-ink"
                    style={{ width: `${Math.max(8, (count / max) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-ink/60">No filler patterns yet. Complete a transcribed session to populate this.</p>
        )}
      </CardContent>
    </Card>
  );
}
