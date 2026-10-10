"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TrendPoint } from "@/lib/dashboard";

type Props = {
  title: string;
  data: TrendPoint[] | undefined;
  color: string;
  unit?: string;
  emptyText?: string;
};

export function TrendChart({ title, data = [], color, unit = "", emptyText = "No trend data yet." }: Props) {
  const formatted = data.map((point) => ({
    ...point,
    label: new Date(point.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
  }));

  return (
    <Card className="bg-white/80">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {formatted.length ? (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={formatted}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" stroke="#64748b" fontSize={12} interval="preserveStartEnd" />
              <YAxis stroke="#64748b" fontSize={12} width={42} />
              <Tooltip formatter={(value) => [`${value}${unit}`, title]} />
              <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-[220px] items-center justify-center text-sm text-ink/60">
            {emptyText}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
