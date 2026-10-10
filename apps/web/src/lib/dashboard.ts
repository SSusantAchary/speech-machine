import { apiFetch } from "@/lib/api";

export type OverviewStats = {
  total_sessions: number;
  total_practice_minutes: number;
  current_streak: number;
  longest_streak: number;
  recent_30d: {
    session_count: number;
    avg_overall_score: number;
    avg_wpm: number;
    avg_filler_rate: number;
    avg_delivery_score: number;
    practice_days: number;
  };
};

export type TrendPoint = {
  date: string;
  value: number;
};

export type DashboardSession = {
  session_id: number;
  recorded_at: string;
  duration_seconds: number;
  wpm: number;
  filler_count: number;
  filler_rate: number;
  speech_score: number;
  delivery_score: number;
  overall_score: number;
  eye_contact_score: number | null;
  vocabulary_density: number;
};

export type HeatmapDay = {
  date: string;
  count: number;
  minutes: number;
};

export type GoalMetric =
  | "wpm"
  | "filler_rate"
  | "overall_score"
  | "practice_days_per_week"
  | "session_duration_minutes"
  | "eye_contact_score"
  | "delivery_score";

export type GoalComparison = "gte" | "lte" | "between";

export type UserGoal = {
  id: number;
  metric_name: GoalMetric;
  comparison: GoalComparison;
  target_value: number;
  target_upper: number | null;
  is_active: boolean;
  current_value: number | null;
  achieved: boolean;
  created_at: string;
  updated_at: string;
};

export type UserGoalInput = Pick<
  UserGoal,
  "metric_name" | "comparison" | "target_value" | "target_upper" | "is_active"
>;

export type CoachingFeedback = {
  id?: number;
  session_id?: number;
  status: "not_available" | "pending" | "generating" | "completed" | "failed" | string;
  summary?: string | null;
  strengths?: Array<{ area: string; detail: string; score_contribution?: string }>;
  improvements?: Array<{ area: string; detail: string; priority?: string; example?: string }>;
  drills?: Array<{ name: string; description: string; duration_minutes?: number; targets?: string }>;
  practice_plan?: {
    focus_areas?: string[];
    suggested_duration_minutes?: number;
    difficulty?: string;
    next_session_goal?: string;
  };
  trend_context?: Record<string, unknown>;
  model_used?: string | null;
  generation_time_ms?: number | null;
  created_at?: string | null;
  error_message?: string | null;
};

export type CoachingRetryResponse = {
  status: "queued";
  job_id: string;
};

export const dashboardApi = {
  overview: () => apiFetch<OverviewStats>("/dashboard/overview"),
  trend: (metric: string, days = 90) => apiFetch<TrendPoint[]>(`/dashboard/trends/${metric}?days=${days}`),
  sessions: (limit = 20, offset = 0) =>
    apiFetch<DashboardSession[]>(`/dashboard/sessions?limit=${limit}&offset=${offset}`),
  heatmap: (days = 365) => apiFetch<HeatmapDay[]>(`/dashboard/heatmap?days=${days}`),
  fillers: (lastN = 20) => apiFetch<Record<string, number>>(`/dashboard/fillers?last_n=${lastN}`),
  goals: () => apiFetch<UserGoal[]>("/dashboard/goals"),
  createGoal: (goal: UserGoalInput) =>
    apiFetch<UserGoal>("/dashboard/goals", { method: "POST", body: JSON.stringify(goal) }),
  updateGoal: (goalId: number, goal: Partial<Omit<UserGoalInput, "metric_name">>) =>
    apiFetch<UserGoal>(`/dashboard/goals/${goalId}`, { method: "PATCH", body: JSON.stringify(goal) }),
  deleteGoal: (goalId: number) =>
    apiFetch<{ status: "deleted" }>(`/dashboard/goals/${goalId}`, { method: "DELETE" }),
};

export const coachingApi = {
  latest: () => apiFetch<CoachingFeedback>("/coaching/latest"),
  session: (sessionId: number) => apiFetch<CoachingFeedback>(`/coaching/session/${sessionId}`),
  history: (limit = 10) => apiFetch<CoachingFeedback[]>(`/coaching/history?limit=${limit}`),
  retry: (sessionId: number) =>
    apiFetch<CoachingRetryResponse>(`/coaching/session/${sessionId}/retry`, { method: "POST" }),
};

export const isCoachingAvailable = (feedback: CoachingFeedback | null | undefined) =>
  Boolean(feedback && feedback.status !== "not_available");

export const isCoachingPending = (feedback: CoachingFeedback | null | undefined) =>
  feedback?.status === "pending" || feedback?.status === "generating";
