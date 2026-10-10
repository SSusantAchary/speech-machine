import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api";
import { isCoachingAvailable, isCoachingPending } from "@/lib/dashboard";
import { resetDashboardStore, useDashboardStore } from "@/store/useDashboardStore";

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(),
}));

const mockedApiFetch = vi.mocked(apiFetch);

describe("dashboard store", () => {
  beforeEach(() => {
    resetDashboardStore();
    mockedApiFetch.mockReset();
  });

  it("fetches dashboard slices with the JSON apiFetch contract", async () => {
    mockedApiFetch.mockImplementation(async (path) => {
      if (path === "/dashboard/overview") {
        return {
          total_sessions: 2,
          total_practice_minutes: 12,
          current_streak: 1,
          longest_streak: 2,
          recent_30d: {
            session_count: 2,
            avg_overall_score: 80,
            avg_wpm: 135,
            avg_filler_rate: 1.2,
            avg_delivery_score: 76,
            practice_days: 1,
          },
        };
      }
      if (String(path).startsWith("/dashboard/trends/")) {
        return [{ date: "2026-06-08", value: 80 }];
      }
      if (String(path).startsWith("/dashboard/sessions")) {
        return [
          {
            session_id: 1,
            recorded_at: "2026-06-08T00:00:00",
            duration_seconds: 60,
            wpm: 135,
            filler_count: 1,
            filler_rate: 1,
            speech_score: 80,
            delivery_score: 75,
            overall_score: 78,
            eye_contact_score: 0.7,
            vocabulary_density: 0.6,
          },
        ];
      }
      if (String(path).startsWith("/dashboard/heatmap")) {
        return [{ date: "2026-06-08", count: 1, minutes: 1 }];
      }
      if (String(path).startsWith("/dashboard/fillers")) {
        return { um: 2 };
      }
      if (path === "/coaching/latest") {
        return { status: "completed", summary: "Good work.", session_id: 1 };
      }
      if (path === "/dashboard/goals") {
        return [
          {
            id: 1,
            metric_name: "wpm",
            comparison: "between",
            target_value: 120,
            target_upper: 150,
            is_active: true,
            current_value: 135,
            achieved: true,
            created_at: "2026-09-04T00:00:00",
            updated_at: "2026-09-04T00:00:00",
          },
        ];
      }
      throw new Error(`Unexpected path ${path}`);
    });

    await useDashboardStore.getState().fetchAll();

    const state = useDashboardStore.getState();
    expect(state.overview?.total_sessions).toBe(2);
    expect(state.trends.avg_overall_score).toHaveLength(1);
    expect(state.sessions[0].session_id).toBe(1);
    expect(state.fillers.um).toBe(2);
    expect(state.latestCoaching?.status).toBe("completed");
    expect(state.goals[0].achieved).toBe(true);
  });

  it("keeps latest coaching unavailable as a normal empty state", async () => {
    mockedApiFetch.mockImplementation(async (path) => {
      if (path === "/coaching/latest") return { status: "not_available" };
      if (path === "/dashboard/overview") {
        return {
          total_sessions: 0,
          total_practice_minutes: 0,
          current_streak: 0,
          longest_streak: 0,
          recent_30d: {
            session_count: 0,
            avg_overall_score: 0,
            avg_wpm: 0,
            avg_filler_rate: 0,
            avg_delivery_score: 0,
            practice_days: 0,
          },
        };
      }
      if (String(path).startsWith("/dashboard/trends/")) return [];
      if (String(path).startsWith("/dashboard/sessions")) return [];
      if (String(path).startsWith("/dashboard/heatmap")) return [];
      if (String(path).startsWith("/dashboard/fillers")) return {};
      if (path === "/dashboard/goals") return [];
      throw new Error(`Unexpected path ${path}`);
    });

    await useDashboardStore.getState().fetchAll();

    expect(useDashboardStore.getState().latestCoaching?.status).toBe("not_available");
    expect(isCoachingAvailable(useDashboardStore.getState().latestCoaching)).toBe(false);
  });

  it("creates, updates, and deletes goals", async () => {
    const goal = {
      id: 7,
      metric_name: "filler_rate" as const,
      comparison: "lte" as const,
      target_value: 1,
      target_upper: null,
      is_active: true,
      current_value: 2,
      achieved: false,
      created_at: "2026-09-04T00:00:00",
      updated_at: "2026-09-04T00:00:00",
    };
    mockedApiFetch
      .mockResolvedValueOnce(goal)
      .mockResolvedValueOnce({ ...goal, is_active: false })
      .mockResolvedValueOnce({ status: "deleted" });

    await useDashboardStore.getState().createGoal({
      metric_name: "filler_rate",
      comparison: "lte",
      target_value: 1,
      target_upper: null,
      is_active: true,
    });
    expect(useDashboardStore.getState().goals).toHaveLength(1);

    await useDashboardStore.getState().updateGoal(7, { is_active: false });
    expect(useDashboardStore.getState().goals[0].is_active).toBe(false);

    await useDashboardStore.getState().deleteGoal(7);
    expect(useDashboardStore.getState().goals).toHaveLength(0);
  });
});

describe("coaching state helpers", () => {
  it("recognizes polling states", () => {
    expect(isCoachingPending({ status: "pending" })).toBe(true);
    expect(isCoachingPending({ status: "generating" })).toBe(true);
    expect(isCoachingPending({ status: "completed" })).toBe(false);
    expect(isCoachingAvailable({ status: "failed" })).toBe(true);
    expect(isCoachingAvailable({ status: "not_available" })).toBe(false);
  });
});
