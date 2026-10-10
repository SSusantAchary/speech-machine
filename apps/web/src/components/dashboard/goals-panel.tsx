"use client";

import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import type { GoalComparison, GoalMetric, UserGoal, UserGoalInput } from "@/lib/dashboard";

type Props = {
  goals: UserGoal[];
  onCreate: (goal: UserGoalInput) => Promise<void>;
  onUpdate: (goalId: number, goal: Partial<Omit<UserGoalInput, "metric_name">>) => Promise<void>;
  onDelete: (goalId: number) => Promise<void>;
};

const metricLabels: Record<GoalMetric, string> = {
  wpm: "Words per minute",
  filler_rate: "Fillers per minute",
  overall_score: "Overall score",
  practice_days_per_week: "Practice days per week",
  session_duration_minutes: "Session duration (minutes)",
  eye_contact_score: "Eye contact (0–1)",
  delivery_score: "Delivery score",
};

const emptyForm: UserGoalInput = {
  metric_name: "wpm",
  comparison: "between",
  target_value: 120,
  target_upper: 160,
  is_active: true,
};

const formatTarget = (goal: UserGoal) => {
  if (goal.comparison === "between") return `${goal.target_value}–${goal.target_upper}`;
  return `${goal.comparison === "gte" ? "≥" : "≤"} ${goal.target_value}`;
};

export function GoalsPanel({ goals, onCreate, onUpdate, onDelete }: Props) {
  const [form, setForm] = useState<UserGoalInput>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setForm(emptyForm);
    setEditingId(null);
    setError(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        await onUpdate(editingId, {
          comparison: form.comparison,
          target_value: form.target_value,
          target_upper: form.comparison === "between" ? form.target_upper : null,
          is_active: form.is_active,
        });
      } else {
        await onCreate({
          ...form,
          target_upper: form.comparison === "between" ? form.target_upper : null,
        });
      }
      reset();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to save goal.");
    } finally {
      setSaving(false);
    }
  };

  const beginEdit = (goal: UserGoal) => {
    setEditingId(goal.id);
    setForm({
      metric_name: goal.metric_name,
      comparison: goal.comparison,
      target_value: goal.target_value,
      target_upper: goal.target_upper,
      is_active: goal.is_active,
    });
    setError(null);
  };

  const toggleGoal = async (goal: UserGoal) => {
    setError(null);
    try {
      await onUpdate(goal.id, { is_active: !goal.is_active });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to update goal.");
    }
  };

  const removeGoal = async (goalId: number) => {
    setError(null);
    try {
      await onDelete(goalId);
      if (editingId === goalId) reset();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to delete goal.");
    }
  };

  return (
    <Card className="bg-white/80">
      <CardHeader>
        <CardTitle>Practice goals</CardTitle>
        <p className="text-sm text-ink/60">Set measurable targets used by the dashboard and AI coach.</p>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-3 lg:grid-cols-[1.4fr_0.8fr_0.7fr_0.7fr_auto] lg:items-end">
          <label className="space-y-1 text-xs font-semibold text-ink/70">
            Metric
            <Select
              value={form.metric_name}
              disabled={editingId !== null}
              onChange={(event) => setForm({ ...form, metric_name: event.target.value as GoalMetric })}
            >
              {Object.entries(metricLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
          </label>
          <label className="space-y-1 text-xs font-semibold text-ink/70">
            Target rule
            <Select
              value={form.comparison}
              onChange={(event) => setForm({ ...form, comparison: event.target.value as GoalComparison })}
            >
              <option value="gte">At least</option>
              <option value="lte">At most</option>
              <option value="between">Between</option>
            </Select>
          </label>
          <label className="space-y-1 text-xs font-semibold text-ink/70">
            Target
            <Input
              type="number"
              min="0"
              step="any"
              required
              value={form.target_value}
              onChange={(event) => setForm({ ...form, target_value: Number(event.target.value) })}
            />
          </label>
          {form.comparison === "between" && (
            <label className="space-y-1 text-xs font-semibold text-ink/70">
              Upper target
              <Input
                type="number"
                min="0"
                step="any"
                required
                value={form.target_upper ?? ""}
                onChange={(event) => setForm({ ...form, target_upper: Number(event.target.value) })}
              />
            </label>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={saving}>{saving ? "Saving…" : editingId ? "Save" : "Add goal"}</Button>
            {editingId && <Button type="button" variant="ghost" onClick={reset}>Cancel</Button>}
          </div>
        </form>
        {error && <p className="text-sm text-red-600">{error}</p>}

        {goals.length === 0 ? (
          <p className="rounded-2xl bg-white/60 p-4 text-sm text-ink/60">No goals yet. Add one to personalize coaching.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {goals.map((goal) => (
              <div key={goal.id} className="rounded-2xl border border-ink/10 bg-white/70 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{metricLabels[goal.metric_name]}</p>
                    <p className="text-sm text-ink/60">Target {formatTarget(goal)}</p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${goal.achieved ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                    {goal.achieved ? "Achieved" : "In progress"}
                  </span>
                </div>
                <p className="mt-3 text-2xl font-semibold">{goal.current_value ?? "—"}</p>
                <p className="text-xs text-ink/50">Current value</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Toggle
                    type="button"
                    pressed={goal.is_active}
                    onClick={() => toggleGoal(goal)}
                  >
                    {goal.is_active ? "Active" : "Paused"}
                  </Toggle>
                  <Button type="button" size="sm" variant="outline" onClick={() => beginEdit(goal)}>Edit</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => removeGoal(goal.id)}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
