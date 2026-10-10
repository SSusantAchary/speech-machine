import { create } from "zustand";
import {
  coachingApi,
  dashboardApi,
  type CoachingFeedback,
  type DashboardSession,
  type HeatmapDay,
  type OverviewStats,
  type TrendPoint,
  type UserGoal,
  type UserGoalInput,
} from "@/lib/dashboard";

type DashboardState = {
  overview: OverviewStats | null;
  trends: Record<string, TrendPoint[]>;
  sessions: DashboardSession[];
  heatmap: HeatmapDay[];
  fillers: Record<string, number>;
  latestCoaching: CoachingFeedback | null;
  goals: UserGoal[];
  loading: boolean;
  error: string | null;
  fetchAll: () => Promise<void>;
  fetchLatestCoaching: () => Promise<void>;
  createGoal: (goal: UserGoalInput) => Promise<void>;
  updateGoal: (goalId: number, goal: Partial<Omit<UserGoalInput, "metric_name">>) => Promise<void>;
  deleteGoal: (goalId: number) => Promise<void>;
  reset: () => void;
};

const initialState = {
  overview: null,
  trends: {},
  sessions: [] as DashboardSession[],
  heatmap: [] as HeatmapDay[],
  fillers: {} as Record<string, number>,
  latestCoaching: null,
  goals: [] as UserGoal[],
  loading: false,
  error: null,
};

export const useDashboardStore = create<DashboardState>((set) => ({
  ...initialState,
  fetchAll: async () => {
    set({ loading: true, error: null });
    const [overview, scoreTrend, wpmTrend, fillerTrend, sessions, heatmap, fillers, coaching, goals] =
      await Promise.allSettled([
        dashboardApi.overview(),
        dashboardApi.trend("avg_overall_score"),
        dashboardApi.trend("avg_wpm"),
        dashboardApi.trend("avg_filler_rate"),
        dashboardApi.sessions(),
        dashboardApi.heatmap(),
        dashboardApi.fillers(),
        coachingApi.latest(),
        dashboardApi.goals(),
      ]);

    set((state) => ({
      overview: overview.status === "fulfilled" ? overview.value : state.overview,
      trends: {
        ...state.trends,
        ...(scoreTrend.status === "fulfilled" ? { avg_overall_score: scoreTrend.value } : {}),
        ...(wpmTrend.status === "fulfilled" ? { avg_wpm: wpmTrend.value } : {}),
        ...(fillerTrend.status === "fulfilled" ? { avg_filler_rate: fillerTrend.value } : {}),
      },
      sessions: sessions.status === "fulfilled" ? sessions.value : state.sessions,
      heatmap: heatmap.status === "fulfilled" ? heatmap.value : state.heatmap,
      fillers: fillers.status === "fulfilled" ? fillers.value : state.fillers,
      latestCoaching: coaching.status === "fulfilled" ? coaching.value : state.latestCoaching,
      goals: goals.status === "fulfilled" ? goals.value : state.goals,
      loading: false,
      error: overview.status === "rejected" ? "Unable to load dashboard overview." : null,
    }));
  },
  fetchLatestCoaching: async () => {
    const latestCoaching = await coachingApi.latest();
    set({ latestCoaching });
  },
  createGoal: async (input) => {
    const goal = await dashboardApi.createGoal(input);
    set((state) => ({ goals: [...state.goals, goal] }));
  },
  updateGoal: async (goalId, input) => {
    const goal = await dashboardApi.updateGoal(goalId, input);
    set((state) => ({ goals: state.goals.map((item) => (item.id === goalId ? goal : item)) }));
  },
  deleteGoal: async (goalId) => {
    await dashboardApi.deleteGoal(goalId);
    set((state) => ({ goals: state.goals.filter((item) => item.id !== goalId) }));
  },
  reset: () => set({ ...initialState }),
}));

export const resetDashboardStore = () => useDashboardStore.getState().reset();
export const refreshDashboard = () => useDashboardStore.getState().fetchAll();
