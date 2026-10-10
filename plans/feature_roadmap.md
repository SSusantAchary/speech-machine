# Speech-Machine: Analytics Dashboard & AI Coaching Feedback

> **Scope:** Two interconnected features — a practice analytics dashboard and an AI coaching engine — built across 6 phases.  
> **Prerequisite:** The Phase 1 foundation roadmap (CI, auth, job queue, storage) is complete.  
> **Stack alignment:** Next.js 14 App Router, React 18, TypeScript, Tailwind CSS, Zustand, Recharts | FastAPI, SQLAlchemy, PostgreSQL, arq, Redis  
> **Monorepo paths:** `apps/web`, `apps/api`, `packages/shared`

---

## Feature overview

### Analytics dashboard

A dedicated `/dashboard` page that aggregates every practice session into visual insights: trends over time, metric breakdowns, session comparison, practice consistency, and goal tracking. The user should be able to open this page and immediately understand whether they are improving, where their weaknesses are, and how consistently they practice.

### AI coaching feedback

After every completed transcription, a background job sends the transcript, delivery metrics, and historical trend context to an LLM. The LLM returns structured coaching feedback: a summary, specific strengths, specific areas for improvement, actionable drills, and a difficulty-calibrated practice plan. The coaching adapts as the user improves — it remembers what it said last time and adjusts.

---

## Phase 1 — Data layer: models, migrations, aggregation

### 1.1 New database models

These models store precomputed analytics and coaching results. Raw data already lives in `sessions` and `transcript_segments`; these tables hold derived, query-friendly aggregates.

**Create file:** `apps/api/app/models/analytics.py`

```python
"""Analytics and coaching data models.

Design principles:
  - Aggregates are precomputed by a background job, not calculated
    on every dashboard load. This keeps dashboard queries O(1).
  - All timestamps use timezone-aware UTC.
  - Foreign keys cascade on delete so orphaned analytics rows
    are impossible.

Memory safety:
  - No lazy-loaded relationships — all queries are explicit.
  - Mapped columns use slots via __slots__ where possible.
"""

from __future__ import annotations

from datetime import datetime, timezone, date
from typing import Optional

from sqlalchemy import (
    ForeignKey,
    String,
    Float,
    Integer,
    Text,
    Date,
    DateTime,
    JSON,
    UniqueConstraint,
    Index,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class SessionMetrics(Base):
    """Denormalized per-session metrics snapshot.

    One row per completed session. Populated by the post-transcription
    job. Stores every metric in flat columns for fast aggregation queries.
    """

    __tablename__ = "session_metrics"
    __table_args__ = (
        Index("ix_session_metrics_user_date", "user_id", "recorded_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("sessions.id", ondelete="CASCADE"),
        unique=True,
        index=True,
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
    )
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    # Speech metrics
    duration_seconds: Mapped[float] = mapped_column(Float, default=0.0)
    word_count: Mapped[int] = mapped_column(Integer, default=0)
    wpm: Mapped[float] = mapped_column(Float, default=0.0)
    filler_count: Mapped[int] = mapped_column(Integer, default=0)
    filler_rate: Mapped[float] = mapped_column(Float, default=0.0)  # fillers per minute
    pause_count: Mapped[int] = mapped_column(Integer, default=0)
    unique_word_count: Mapped[int] = mapped_column(Integer, default=0)
    vocabulary_density: Mapped[float] = mapped_column(Float, default=0.0)

    # Delivery metrics
    eye_contact_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    smile_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    head_stability_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    loudness_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Composite scores (0-100 scale)
    speech_score: Mapped[float] = mapped_column(Float, default=0.0)
    delivery_score: Mapped[float] = mapped_column(Float, default=0.0)
    overall_score: Mapped[float] = mapped_column(Float, default=0.0)

    # Filler word breakdown as JSON: {"um": 5, "like": 3, ...}
    filler_breakdown: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    # WPM timeline: list of {minute: int, wpm: float} for pace variation chart
    wpm_timeline: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )


class DailyAggregate(Base):
    """One row per user per day.

    Precomputed by a nightly cron job OR updated incrementally
    after each session completes. Powers the activity heatmap,
    streak calculation, and daily trend charts.
    """

    __tablename__ = "daily_aggregates"
    __table_args__ = (
        UniqueConstraint("user_id", "practice_date", name="uq_user_date"),
        Index("ix_daily_agg_user_date", "user_id", "practice_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
    )
    practice_date: Mapped[date] = mapped_column(Date)

    session_count: Mapped[int] = mapped_column(Integer, default=0)
    total_duration_seconds: Mapped[float] = mapped_column(Float, default=0.0)
    avg_wpm: Mapped[float] = mapped_column(Float, default=0.0)
    avg_filler_rate: Mapped[float] = mapped_column(Float, default=0.0)
    avg_overall_score: Mapped[float] = mapped_column(Float, default=0.0)
    avg_speech_score: Mapped[float] = mapped_column(Float, default=0.0)
    avg_delivery_score: Mapped[float] = mapped_column(Float, default=0.0)
    best_overall_score: Mapped[float] = mapped_column(Float, default=0.0)


class UserGoal(Base):
    """User-defined practice goals.

    Goals are metric-specific targets (e.g., "WPM between 130-160",
    "filler rate below 2 per minute", "practice 5 days per week").
    """

    __tablename__ = "user_goals"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
    )

    metric_name: Mapped[str] = mapped_column(String(50))
    # "wpm" | "filler_rate" | "overall_score" | "practice_days_per_week"
    # | "session_duration" | "eye_contact_score" | "delivery_score"

    target_value: Mapped[float] = mapped_column(Float)
    comparison: Mapped[str] = mapped_column(String(10))
    # "gte" | "lte" | "between"

    target_upper: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    # Only used when comparison = "between"

    is_active: Mapped[bool] = mapped_column(default=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )


class CoachingFeedback(Base):
    """LLM-generated coaching feedback per session.

    One row per completed session. Generated asynchronously by the
    coaching background job after transcription finishes.
    """

    __tablename__ = "coaching_feedback"
    __table_args__ = (
        Index("ix_coaching_user_created", "user_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("sessions.id", ondelete="CASCADE"),
        unique=True,
        index=True,
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
    )

    # Generation metadata
    status: Mapped[str] = mapped_column(
        String(20), default="pending"
    )  # pending | generating | completed | failed
    model_used: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    generation_time_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Structured feedback (all stored as JSON for flexible schema evolution)
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    strengths: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    # [{"area": "pace", "detail": "Consistent 140 WPM...", "score_delta": +5}, ...]

    improvements: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    # [{"area": "fillers", "detail": "Reduce 'um' usage...", "priority": "high"}, ...]

    drills: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    # [{"name": "Pause replacement", "description": "...", "duration_minutes": 5}, ...]

    practice_plan: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    # {"focus_areas": [...], "suggested_duration_min": 15, "difficulty": "intermediate"}

    # Raw LLM response for debugging / audit
    raw_response: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Comparison context
    compared_to_session_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    trend_context: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    # {"wpm_trend": "improving", "filler_trend": "stable", "sessions_analyzed": 10}

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
```

**Generate migration:**

```bash
cd apps/api
alembic revision --autogenerate -m "add_analytics_and_coaching_tables"
alembic upgrade head
```

---

### 1.2 Scoring engine (shared package)

This lives in `packages/shared` so both the backend and frontend can use the same scoring logic.

**Create file:** `packages/shared/src/scoring.ts`

```typescript
/**
 * Composite scoring engine for speech practice sessions.
 *
 * All score functions are pure — no side effects, no I/O.
 * Every function takes metric values and returns a 0-100 score.
 *
 * Scoring philosophy:
 *   - 0-39:  Needs significant work
 *   - 40-59: Below average
 *   - 60-74: Average / acceptable
 *   - 75-89: Good
 *   - 90-100: Excellent
 */

export interface SpeechMetricsInput {
  wpm: number;
  fillerCount: number;
  durationSeconds: number;
  pauseCount: number;
  vocabularyDensity: number;
}

export interface DeliveryMetricsInput {
  eyeContactScore: number | null;  // 0-1 from MediaPipe
  smileScore: number | null;       // 0-1 from MediaPipe
  headStabilityScore: number | null; // 0-1 from MediaPipe
  loudnessScore: number | null;    // 0-1 from Web Audio
}

export interface CompositeScore {
  speechScore: number;
  deliveryScore: number;
  overallScore: number;
  breakdown: {
    paceScore: number;
    fillerScore: number;
    pauseScore: number;
    vocabularyScore: number;
    eyeContactScore: number;
    smileScore: number;
    stabilityScore: number;
    loudnessScore: number;
  };
}

/**
 * Score pace (WPM). Optimal range is 130-170 WPM for public speaking.
 * Returns 0-100.
 */
export function scorePace(wpm: number): number {
  if (wpm <= 0) return 0;

  const OPTIMAL_LOW = 130;
  const OPTIMAL_HIGH = 170;
  const ACCEPTABLE_LOW = 100;
  const ACCEPTABLE_HIGH = 200;

  if (wpm >= OPTIMAL_LOW && wpm <= OPTIMAL_HIGH) {
    return 100;
  }

  if (wpm < OPTIMAL_LOW) {
    if (wpm <= ACCEPTABLE_LOW) return Math.max(0, 30 + (wpm / ACCEPTABLE_LOW) * 20);
    const ratio = (wpm - ACCEPTABLE_LOW) / (OPTIMAL_LOW - ACCEPTABLE_LOW);
    return Math.round(50 + ratio * 50);
  }

  // wpm > OPTIMAL_HIGH
  if (wpm >= ACCEPTABLE_HIGH) return Math.max(0, 50 - ((wpm - ACCEPTABLE_HIGH) / 50) * 30);
  const ratio = (ACCEPTABLE_HIGH - wpm) / (ACCEPTABLE_HIGH - OPTIMAL_HIGH);
  return Math.round(50 + ratio * 50);
}

/**
 * Score filler word usage. Target: < 1 filler per minute.
 * Input: fillers per minute (fillerCount / (durationSeconds / 60)).
 */
export function scoreFillers(fillersPerMinute: number): number {
  if (fillersPerMinute <= 0) return 100;
  if (fillersPerMinute <= 0.5) return 95;
  if (fillersPerMinute <= 1.0) return 85;
  if (fillersPerMinute <= 2.0) return 70;
  if (fillersPerMinute <= 3.0) return 55;
  if (fillersPerMinute <= 5.0) return 35;
  if (fillersPerMinute <= 8.0) return 20;
  return 10;
}

/**
 * Score pauses. Some pauses are good (rhetorical); too many indicate
 * hesitation. Target: 1-3 meaningful pauses per minute.
 */
export function scorePauses(pauseCount: number, durationSeconds: number): number {
  if (durationSeconds <= 0) return 50;
  const pausesPerMinute = pauseCount / (durationSeconds / 60);

  if (pausesPerMinute <= 0.5) return 70; // Too few pauses (monotone)
  if (pausesPerMinute <= 1.5) return 90;
  if (pausesPerMinute <= 3.0) return 100; // Sweet spot
  if (pausesPerMinute <= 5.0) return 75;
  if (pausesPerMinute <= 8.0) return 50;
  return 25;
}

/**
 * Score vocabulary diversity. Higher density = more varied word choice.
 * Density = unique words / total words (0-1 scale).
 */
export function scoreVocabulary(density: number): number {
  if (density <= 0) return 0;
  if (density >= 0.8) return 100;
  if (density >= 0.65) return 85;
  if (density >= 0.5) return 70;
  if (density >= 0.35) return 50;
  return 30;
}

/**
 * Score a 0-1 delivery metric. Converts to 0-100 with a slight curve
 * that rewards consistency above 0.7.
 */
function scoreDeliveryMetric(raw: number | null): number {
  if (raw === null || raw === undefined) return -1; // -1 = not available
  const clamped = Math.max(0, Math.min(1, raw));
  // Apply a curve: x^0.7 * 100 (rewards high consistency)
  return Math.round(Math.pow(clamped, 0.7) * 100);
}

/**
 * Compute composite scores from raw metrics.
 */
export function computeCompositeScore(
  speech: SpeechMetricsInput,
  delivery: DeliveryMetricsInput,
): CompositeScore {
  const durationMinutes = speech.durationSeconds / 60;
  const fillersPerMinute = durationMinutes > 0
    ? speech.fillerCount / durationMinutes
    : 0;

  const paceScore = scorePace(speech.wpm);
  const fillerScore = scoreFillers(fillersPerMinute);
  const pauseScore = scorePauses(speech.pauseCount, speech.durationSeconds);
  const vocabularyScore = scoreVocabulary(speech.vocabularyDensity);

  const eyeContactScore = scoreDeliveryMetric(delivery.eyeContactScore);
  const smileScore = scoreDeliveryMetric(delivery.smileScore);
  const stabilityScore = scoreDeliveryMetric(delivery.headStabilityScore);
  const loudnessScore = scoreDeliveryMetric(delivery.loudnessScore);

  // Speech composite: weighted average
  const speechScore = Math.round(
    paceScore * 0.35 +
    fillerScore * 0.30 +
    pauseScore * 0.15 +
    vocabularyScore * 0.20
  );

  // Delivery composite: average of available metrics
  const deliveryMetrics = [eyeContactScore, smileScore, stabilityScore, loudnessScore]
    .filter((s): s is number => s >= 0);
  const deliveryScore = deliveryMetrics.length > 0
    ? Math.round(deliveryMetrics.reduce((a, b) => a + b, 0) / deliveryMetrics.length)
    : 0;

  // Overall: 60% speech, 40% delivery (speech is primary)
  const overallScore = deliveryMetrics.length > 0
    ? Math.round(speechScore * 0.6 + deliveryScore * 0.4)
    : speechScore;

  return {
    speechScore,
    deliveryScore,
    overallScore,
    breakdown: {
      paceScore,
      fillerScore,
      pauseScore,
      vocabularyScore,
      eyeContactScore: Math.max(0, eyeContactScore),
      smileScore: Math.max(0, smileScore),
      stabilityScore: Math.max(0, stabilityScore),
      loudnessScore: Math.max(0, loudnessScore),
    },
  };
}

/**
 * Compute WPM timeline from transcript segments.
 * Groups segments into 1-minute buckets and calculates WPM per bucket.
 */
export function computeWpmTimeline(
  segments: Array<{ startTime: number; endTime: number; text: string }>,
): Array<{ minute: number; wpm: number }> {
  if (segments.length === 0) return [];

  const buckets = new Map<number, { wordCount: number; durationSec: number }>();

  for (const seg of segments) {
    const minute = Math.floor(seg.startTime / 60);
    const words = seg.text.trim().split(/\s+/).filter(Boolean).length;
    const duration = seg.endTime - seg.startTime;

    const existing = buckets.get(minute);
    if (existing) {
      existing.wordCount += words;
      existing.durationSec += duration;
    } else {
      buckets.set(minute, { wordCount: words, durationSec: duration });
    }
  }

  const timeline: Array<{ minute: number; wpm: number }> = [];
  const sortedMinutes = [...buckets.keys()].sort((a, b) => a - b);

  for (const minute of sortedMinutes) {
    const bucket = buckets.get(minute)!;
    const minuteFraction = bucket.durationSec / 60;
    const wpm = minuteFraction > 0
      ? Math.round(bucket.wordCount / minuteFraction)
      : 0;
    timeline.push({ minute, wpm });
  }

  return timeline;
}

/**
 * Determine trend direction from a series of values.
 * Returns "improving", "declining", "stable", or "insufficient_data".
 */
export function detectTrend(
  values: number[],
  higherIsBetter: boolean = true,
): "improving" | "declining" | "stable" | "insufficient_data" {
  if (values.length < 3) return "insufficient_data";

  // Use last 10 values max to keep the trend recent
  const recent = values.slice(-10);

  // Simple linear regression slope
  const n = recent.length;
  const xMean = (n - 1) / 2;
  const yMean = recent.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    numerator += (i - xMean) * (recent[i] - yMean);
    denominator += (i - xMean) ** 2;
  }

  const slope = denominator !== 0 ? numerator / denominator : 0;

  // Normalize slope relative to the mean to determine significance
  const normalizedSlope = yMean !== 0 ? Math.abs(slope / yMean) : Math.abs(slope);

  if (normalizedSlope < 0.02) return "stable"; // Less than 2% change per session

  if (higherIsBetter) {
    return slope > 0 ? "improving" : "declining";
  } else {
    return slope < 0 ? "improving" : "declining";
  }
}

/**
 * Calculate practice streak (consecutive days with at least one session).
 */
export function calculateStreak(
  practiceDates: string[], // ISO date strings "YYYY-MM-DD", sorted ascending
): { currentStreak: number; longestStreak: number } {
  if (practiceDates.length === 0) return { currentStreak: 0, longestStreak: 0 };

  let currentStreak = 1;
  let longestStreak = 1;
  let tempStreak = 1;

  for (let i = 1; i < practiceDates.length; i++) {
    const prev = new Date(practiceDates[i - 1]);
    const curr = new Date(practiceDates[i]);
    const diffDays = Math.round(
      (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (diffDays === 1) {
      tempStreak++;
    } else if (diffDays > 1) {
      tempStreak = 1;
    }
    // diffDays === 0 means same day, skip

    longestStreak = Math.max(longestStreak, tempStreak);
  }

  // Check if the streak is current (includes today or yesterday)
  const lastDate = new Date(practiceDates[practiceDates.length - 1]);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  lastDate.setHours(0, 0, 0, 0);
  const daysSinceLast = Math.round(
    (today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  currentStreak = daysSinceLast <= 1 ? tempStreak : 0;

  return { currentStreak, longestStreak };
}
```

**Create file:** `packages/shared/src/scoring.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import {
  scorePace,
  scoreFillers,
  scorePauses,
  scoreVocabulary,
  computeCompositeScore,
  computeWpmTimeline,
  detectTrend,
  calculateStreak,
} from "./scoring";

describe("scorePace", () => {
  it("returns 100 for optimal range", () => {
    expect(scorePace(140)).toBe(100);
    expect(scorePace(150)).toBe(100);
    expect(scorePace(130)).toBe(100);
    expect(scorePace(170)).toBe(100);
  });

  it("penalizes slow speech", () => {
    expect(scorePace(100)).toBeLessThan(60);
    expect(scorePace(60)).toBeLessThan(40);
  });

  it("penalizes fast speech", () => {
    expect(scorePace(200)).toBeLessThanOrEqual(55);
    expect(scorePace(250)).toBeLessThan(40);
  });

  it("returns 0 for 0 wpm", () => {
    expect(scorePace(0)).toBe(0);
  });
});

describe("scoreFillers", () => {
  it("rewards zero fillers", () => {
    expect(scoreFillers(0)).toBe(100);
  });

  it("penalizes high filler rate", () => {
    expect(scoreFillers(5)).toBeLessThan(40);
    expect(scoreFillers(10)).toBeLessThan(15);
  });
});

describe("detectTrend", () => {
  it("detects improving trend", () => {
    expect(detectTrend([50, 55, 60, 65, 70])).toBe("improving");
  });

  it("detects declining trend", () => {
    expect(detectTrend([70, 65, 60, 55, 50])).toBe("declining");
  });

  it("detects stable trend", () => {
    expect(detectTrend([50, 50, 51, 50, 50])).toBe("stable");
  });

  it("returns insufficient_data for too few values", () => {
    expect(detectTrend([50, 60])).toBe("insufficient_data");
  });

  it("handles higherIsBetter=false (e.g., filler rate)", () => {
    // Filler rate going down is improving
    expect(detectTrend([5, 4, 3, 2, 1], false)).toBe("improving");
  });
});

describe("calculateStreak", () => {
  it("calculates current streak", () => {
    const today = new Date();
    const dates = [
      offsetDate(today, -3),
      offsetDate(today, -2),
      offsetDate(today, -1),
      offsetDate(today, 0),
    ];
    const result = calculateStreak(dates);
    expect(result.currentStreak).toBe(4);
    expect(result.longestStreak).toBe(4);
  });

  it("returns 0 streak if last practice was 2+ days ago", () => {
    const today = new Date();
    const dates = [offsetDate(today, -5), offsetDate(today, -4), offsetDate(today, -3)];
    const result = calculateStreak(dates);
    expect(result.currentStreak).toBe(0);
    expect(result.longestStreak).toBe(3);
  });

  it("handles empty input", () => {
    expect(calculateStreak([])).toEqual({ currentStreak: 0, longestStreak: 0 });
  });
});

function offsetDate(base: Date, days: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}
```

---

## Phase 2 — Dashboard API endpoints

### 2.1 Analytics aggregation service

**Create file:** `apps/api/app/services/analytics.py`

```python
"""Analytics aggregation queries.

All queries use the precomputed session_metrics and daily_aggregates
tables. No raw transcript scanning at query time.

Memory safety:
  - All queries return bounded result sets (max 365 days, max 100 sessions).
  - No ORM lazy loading — all fields explicitly selected.
  - Date ranges are always bounded to prevent full-table scans.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select, func, desc, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.analytics import SessionMetrics, DailyAggregate, UserGoal


async def get_overview_stats(
    db: AsyncSession,
    user_id: int,
) -> dict[str, Any]:
    """Dashboard header stats: totals and recent averages."""

    # Total sessions and practice time
    totals = await db.execute(
        select(
            func.count(SessionMetrics.id).label("total_sessions"),
            func.coalesce(func.sum(SessionMetrics.duration_seconds), 0).label("total_seconds"),
        ).where(SessionMetrics.user_id == user_id)
    )
    row = totals.one()
    total_sessions = row.total_sessions
    total_seconds = float(row.total_seconds)

    # Averages from the last 30 days
    thirty_days_ago = datetime.now(timezone.utc) - timedelta(days=30)
    recent = await db.execute(
        select(
            func.avg(SessionMetrics.overall_score).label("avg_score"),
            func.avg(SessionMetrics.wpm).label("avg_wpm"),
            func.avg(SessionMetrics.filler_rate).label("avg_filler_rate"),
            func.avg(SessionMetrics.delivery_score).label("avg_delivery"),
            func.count(SessionMetrics.id).label("recent_count"),
        ).where(
            and_(
                SessionMetrics.user_id == user_id,
                SessionMetrics.recorded_at >= thirty_days_ago,
            )
        )
    )
    recent_row = recent.one()

    # Practice days in last 30 days
    practice_days = await db.scalar(
        select(func.count(func.distinct(DailyAggregate.practice_date))).where(
            and_(
                DailyAggregate.user_id == user_id,
                DailyAggregate.practice_date >= thirty_days_ago.date(),
            )
        )
    )

    return {
        "total_sessions": total_sessions,
        "total_practice_minutes": round(total_seconds / 60, 1),
        "recent_30d": {
            "session_count": recent_row.recent_count,
            "avg_overall_score": _safe_round(recent_row.avg_score),
            "avg_wpm": _safe_round(recent_row.avg_wpm),
            "avg_filler_rate": _safe_round(recent_row.avg_filler_rate),
            "avg_delivery_score": _safe_round(recent_row.avg_delivery),
            "practice_days": practice_days or 0,
        },
    }


async def get_trend_data(
    db: AsyncSession,
    user_id: int,
    metric: str,
    days: int = 90,
) -> list[dict[str, Any]]:
    """Time-series data for a specific metric.

    Returns daily aggregates for the requested metric over the
    specified number of days. Used by the trend line charts.

    Allowed metrics: avg_wpm, avg_filler_rate, avg_overall_score,
    avg_speech_score, avg_delivery_score, session_count,
    total_duration_seconds.
    """
    allowed_metrics = {
        "avg_wpm", "avg_filler_rate", "avg_overall_score",
        "avg_speech_score", "avg_delivery_score", "session_count",
        "total_duration_seconds", "best_overall_score",
    }
    if metric not in allowed_metrics:
        raise ValueError(f"Invalid metric: {metric}. Allowed: {allowed_metrics}")

    start_date = date.today() - timedelta(days=days)

    result = await db.execute(
        select(
            DailyAggregate.practice_date,
            getattr(DailyAggregate, metric),
        )
        .where(
            and_(
                DailyAggregate.user_id == user_id,
                DailyAggregate.practice_date >= start_date,
            )
        )
        .order_by(DailyAggregate.practice_date.asc())
        .limit(365)
    )

    return [
        {"date": str(row[0]), "value": _safe_round(row[1])}
        for row in result.all()
    ]


async def get_session_history(
    db: AsyncSession,
    user_id: int,
    limit: int = 50,
    offset: int = 0,
) -> list[dict[str, Any]]:
    """Paginated session history with scores."""
    result = await db.execute(
        select(SessionMetrics)
        .where(SessionMetrics.user_id == user_id)
        .order_by(desc(SessionMetrics.recorded_at))
        .limit(min(limit, 100))
        .offset(offset)
    )

    return [
        {
            "session_id": sm.session_id,
            "recorded_at": sm.recorded_at.isoformat(),
            "duration_seconds": sm.duration_seconds,
            "wpm": sm.wpm,
            "filler_count": sm.filler_count,
            "filler_rate": _safe_round(sm.filler_rate),
            "speech_score": sm.speech_score,
            "delivery_score": sm.delivery_score,
            "overall_score": sm.overall_score,
            "eye_contact_score": sm.eye_contact_score,
        }
        for sm in result.scalars().all()
    ]


async def get_activity_heatmap(
    db: AsyncSession,
    user_id: int,
    days: int = 365,
) -> list[dict[str, Any]]:
    """Practice activity data for a GitHub-style heatmap.

    Returns one entry per day with session_count and total_duration.
    Days with zero sessions are omitted (frontend fills gaps).
    """
    start_date = date.today() - timedelta(days=days)

    result = await db.execute(
        select(
            DailyAggregate.practice_date,
            DailyAggregate.session_count,
            DailyAggregate.total_duration_seconds,
        )
        .where(
            and_(
                DailyAggregate.user_id == user_id,
                DailyAggregate.practice_date >= start_date,
            )
        )
        .order_by(DailyAggregate.practice_date.asc())
    )

    return [
        {
            "date": str(row[0]),
            "count": row[1],
            "minutes": round(row[2] / 60, 1),
        }
        for row in result.all()
    ]


async def get_filler_breakdown(
    db: AsyncSession,
    user_id: int,
    last_n_sessions: int = 20,
) -> dict[str, int]:
    """Aggregate filler word breakdown across recent sessions."""
    result = await db.execute(
        select(SessionMetrics.filler_breakdown)
        .where(SessionMetrics.user_id == user_id)
        .order_by(desc(SessionMetrics.recorded_at))
        .limit(last_n_sessions)
    )

    combined: dict[str, int] = {}
    for (breakdown,) in result.all():
        if breakdown:
            for word, count in breakdown.items():
                combined[word] = combined.get(word, 0) + count

    return dict(sorted(combined.items(), key=lambda x: x[1], reverse=True))


async def compare_sessions(
    db: AsyncSession,
    user_id: int,
    session_id_a: int,
    session_id_b: int,
) -> dict[str, Any]:
    """Side-by-side comparison of two sessions."""
    result = await db.execute(
        select(SessionMetrics).where(
            and_(
                SessionMetrics.user_id == user_id,
                SessionMetrics.session_id.in_([session_id_a, session_id_b]),
            )
        )
    )
    sessions = {sm.session_id: sm for sm in result.scalars().all()}

    if len(sessions) != 2:
        raise ValueError("One or both sessions not found")

    a = sessions[session_id_a]
    b = sessions[session_id_b]

    def diff(attr: str) -> dict:
        va = getattr(a, attr, 0) or 0
        vb = getattr(b, attr, 0) or 0
        return {"a": va, "b": vb, "delta": round(vb - va, 2)}

    return {
        "session_a": {"id": session_id_a, "date": a.recorded_at.isoformat()},
        "session_b": {"id": session_id_b, "date": b.recorded_at.isoformat()},
        "comparison": {
            "overall_score": diff("overall_score"),
            "speech_score": diff("speech_score"),
            "delivery_score": diff("delivery_score"),
            "wpm": diff("wpm"),
            "filler_rate": diff("filler_rate"),
            "eye_contact_score": diff("eye_contact_score"),
            "vocabulary_density": diff("vocabulary_density"),
        },
    }


def _safe_round(value: Any, decimals: int = 1) -> float:
    if value is None:
        return 0.0
    return round(float(value), decimals)
```

### 2.2 Dashboard API router

**Create file:** `apps/api/app/routers/dashboard.py`

```python
"""Dashboard analytics API endpoints.

All endpoints are user-scoped — a user can only see their own data.
The user_id is extracted from the JWT token via the auth dependency.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.security import get_current_user, TokenPayload
from app.services.analytics import (
    get_overview_stats,
    get_trend_data,
    get_session_history,
    get_activity_heatmap,
    get_filler_breakdown,
    compare_sessions,
)

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/overview")
async def overview(
    user: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Dashboard header stats: totals, 30-day averages, streaks."""
    return await get_overview_stats(db, int(user.sub))


@router.get("/trends/{metric}")
async def trends(
    metric: str,
    days: int = Query(default=90, ge=7, le=365),
    user: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list:
    """Time-series trend data for a specific metric."""
    try:
        return await get_trend_data(db, int(user.sub), metric, days)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/sessions")
async def sessions(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list:
    """Paginated session history with scores."""
    return await get_session_history(db, int(user.sub), limit, offset)


@router.get("/heatmap")
async def heatmap(
    days: int = Query(default=365, ge=30, le=365),
    user: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list:
    """Activity heatmap data."""
    return await get_activity_heatmap(db, int(user.sub), days)


@router.get("/fillers")
async def fillers(
    last_n: int = Query(default=20, ge=5, le=100),
    user: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Filler word breakdown across recent sessions."""
    return await get_filler_breakdown(db, int(user.sub), last_n)


@router.get("/compare")
async def compare(
    session_a: int = Query(...),
    session_b: int = Query(...),
    user: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Side-by-side session comparison."""
    try:
        return await compare_sessions(db, int(user.sub), session_a, session_b)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
```

**Register the router in `apps/api/app/main.py`:**

```python
from app.routers.dashboard import router as dashboard_router
app.include_router(dashboard_router)
```

---

## Phase 3 — AI coaching engine (backend)

### 3.1 LLM integration service

**Create file:** `apps/api/app/services/coaching.py`

```python
"""AI coaching feedback service.

Sends session transcript + metrics + historical context to an LLM
and returns structured coaching feedback.

Design principles:
  - The LLM is called via a generic interface so the provider
    can be swapped (Anthropic, OpenAI, local).
  - The prompt is deterministic and version-controlled.
  - Structured output is enforced by asking for JSON and parsing.
  - Token usage is logged for cost monitoring.
  - Failures are retried by the arq worker, not here.

Memory safety:
  - Transcript is truncated to 8000 characters max before sending.
  - Historical context is limited to last 10 sessions.
  - Raw response is stored for debugging but not held in memory
    after database write.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any

import httpx

from app.config import settings

logger = logging.getLogger("coaching")

COACHING_PROMPT_VERSION = "v1.0"

MAX_TRANSCRIPT_CHARS = 8000
MAX_HISTORY_SESSIONS = 10


def build_coaching_prompt(
    transcript: str,
    metrics: dict[str, Any],
    history: list[dict[str, Any]],
    previous_feedback: dict[str, Any] | None,
) -> str:
    """Build the coaching prompt.

    The prompt is structured to produce deterministic, parseable JSON.
    """

    truncated_transcript = transcript[:MAX_TRANSCRIPT_CHARS]
    if len(transcript) > MAX_TRANSCRIPT_CHARS:
        truncated_transcript += "\n[...transcript truncated...]"

    history_summary = ""
    if history:
        history_lines = []
        for h in history[-MAX_HISTORY_SESSIONS:]:
            history_lines.append(
                f"  - Session {h.get('session_id')}: "
                f"score={h.get('overall_score', 'N/A')}, "
                f"wpm={h.get('wpm', 'N/A')}, "
                f"fillers={h.get('filler_count', 'N/A')}, "
                f"date={h.get('recorded_at', 'N/A')}"
            )
        history_summary = "Recent session history (newest first):\n" + "\n".join(history_lines)

    previous_context = ""
    if previous_feedback:
        prev_improvements = previous_feedback.get("improvements", [])
        if prev_improvements:
            prev_items = [f"  - {imp.get('area', '')}: {imp.get('detail', '')}"
                          for imp in prev_improvements[:5]]
            previous_context = (
                "In the previous coaching session, the following improvements "
                "were recommended:\n" + "\n".join(prev_items) +
                "\nAssess whether the user has made progress on these areas."
            )

    return f"""You are an expert speech coach analyzing a practice session.
Your role is to give actionable, specific, encouraging feedback that
helps the speaker improve their next session.

## Current session metrics
- Duration: {metrics.get('duration_seconds', 0):.0f} seconds
- Words per minute: {metrics.get('wpm', 0):.1f}
- Filler word count: {metrics.get('filler_count', 0)}
- Filler rate (per minute): {metrics.get('filler_rate', 0):.1f}
- Pause count: {metrics.get('pause_count', 0)}
- Vocabulary density: {metrics.get('vocabulary_density', 0):.2f}
- Speech score: {metrics.get('speech_score', 0):.0f}/100
- Delivery score: {metrics.get('delivery_score', 0):.0f}/100
- Overall score: {metrics.get('overall_score', 0):.0f}/100
- Eye contact score: {metrics.get('eye_contact_score', 'N/A')}
- Smile score: {metrics.get('smile_score', 'N/A')}
- Head stability: {metrics.get('head_stability_score', 'N/A')}
- Top filler words: {json.dumps(metrics.get('filler_breakdown', {{}}))}

{history_summary}

{previous_context}

## Transcript
{truncated_transcript}

## Instructions
Analyze this practice session and respond with ONLY a JSON object
(no markdown, no backticks, no preamble). Use this exact structure:

{{
  "summary": "2-3 sentence overall assessment of this session",
  "strengths": [
    {{
      "area": "short label (e.g., pace, structure, vocabulary)",
      "detail": "specific observation with data from the metrics",
      "score_contribution": "how this strength impacts their score"
    }}
  ],
  "improvements": [
    {{
      "area": "short label",
      "detail": "specific, actionable suggestion",
      "priority": "high | medium | low",
      "example": "concrete example or replacement phrase if applicable"
    }}
  ],
  "drills": [
    {{
      "name": "drill name",
      "description": "step-by-step instructions",
      "duration_minutes": 5,
      "targets": "which metric this drill improves"
    }}
  ],
  "practice_plan": {{
    "focus_areas": ["area1", "area2"],
    "suggested_duration_minutes": 15,
    "difficulty": "beginner | intermediate | advanced",
    "next_session_goal": "one specific, measurable goal for next time"
  }},
  "progress_note": "comment on improvement trends if history is available"
}}

Rules:
- Strengths and improvements arrays must each have 2-4 items.
- Drills array must have 1-3 items.
- Be specific: cite exact numbers, exact filler words, exact phrases.
- Be encouraging but honest. Never fabricate improvements.
- If this is a first session with no history, omit progress_note.
- Adjust difficulty based on overall_score: <50 = beginner, 50-75 = intermediate, >75 = advanced.
"""


async def generate_coaching_feedback(
    transcript: str,
    metrics: dict[str, Any],
    history: list[dict[str, Any]],
    previous_feedback: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Call the LLM and return parsed coaching feedback.

    Returns a dict with the structured coaching fields plus metadata.
    Raises on API error or JSON parse failure (caller handles retry).
    """
    prompt = build_coaching_prompt(transcript, metrics, history, previous_feedback)

    start_time = time.perf_counter()

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            f"{settings.LLM_API_BASE_URL}/v1/messages",
            headers={
                "Content-Type": "application/json",
                "x-api-key": settings.LLM_API_KEY,
                "anthropic-version": "2023-06-01",
            },
            json={
                "model": settings.LLM_MODEL,
                "max_tokens": 2000,
                "temperature": 0.3,  # Low temp for consistent structure
                "messages": [
                    {"role": "user", "content": prompt},
                ],
            },
        )

    generation_time_ms = int((time.perf_counter() - start_time) * 1000)

    if response.status_code != 200:
        raise RuntimeError(
            f"LLM API returned {response.status_code}: "
            f"{response.text[:500]}"
        )

    response_data = response.json()

    # Extract text from content blocks
    raw_text = ""
    for block in response_data.get("content", []):
        if block.get("type") == "text":
            raw_text += block.get("text", "")

    # Strip any accidental markdown fences
    cleaned = raw_text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned[3:]
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]
    cleaned = cleaned.strip()

    # Parse JSON
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as e:
        raise RuntimeError(
            f"LLM returned invalid JSON: {e}. Raw: {cleaned[:300]}"
        )

    # Validate required fields
    required_keys = {"summary", "strengths", "improvements", "drills", "practice_plan"}
    missing = required_keys - set(parsed.keys())
    if missing:
        raise RuntimeError(f"LLM response missing required keys: {missing}")

    return {
        "summary": parsed["summary"],
        "strengths": parsed["strengths"],
        "improvements": parsed["improvements"],
        "drills": parsed["drills"],
        "practice_plan": parsed["practice_plan"],
        "progress_note": parsed.get("progress_note"),
        "raw_response": raw_text,
        "model_used": settings.LLM_MODEL,
        "generation_time_ms": generation_time_ms,
    }
```

### 3.2 Configuration additions

**Add to `apps/api/app/config.py`:**

```python
    # ── LLM / Coaching ────────────────────────────
    LLM_API_BASE_URL: str = "https://api.anthropic.com"
    LLM_API_KEY: str = ""  # Required for coaching feature
    LLM_MODEL: str = "claude-sonnet-4-20250514"
    COACHING_ENABLED: bool = True
```

**Add to `.env.example`:**

```bash
# AI Coaching (optional — set to enable post-session coaching feedback)
LLM_API_KEY=
LLM_MODEL=claude-sonnet-4-20250514
COACHING_ENABLED=true
```

### 3.3 Coaching background job

**Create file:** `apps/api/app/worker/coaching_job.py`

```python
"""Background job: generate coaching feedback after transcription.

Chained from the transcription job — when transcription completes,
it enqueues this job automatically.

Memory safety:
  - Transcript truncated to 8000 chars before LLM call.
  - Historical context limited to 10 sessions.
  - Database session is context-managed per operation.
"""

from __future__ import annotations

import logging
from typing import Any

from app.models.analytics import CoachingFeedback, SessionMetrics
from app.services.coaching import generate_coaching_feedback
from app.services.analytics import get_session_history

logger = logging.getLogger("arq.coaching")


async def generate_session_coaching(
    ctx: dict[str, Any],
    session_id: int,
    user_id: int,
) -> dict[str, Any]:
    """Generate AI coaching feedback for a completed session.

    Steps:
      1. Load session metrics and transcript.
      2. Load recent session history for trend context.
      3. Load previous coaching feedback (if any).
      4. Call the LLM.
      5. Store structured feedback in the database.
    """
    db_factory = ctx["db_factory"]

    try:
        # ── 1. Load current session data ──────────────
        async with db_factory() as db:
            sm = await db.execute(
                SessionMetrics.__table__.select().where(
                    SessionMetrics.session_id == session_id
                )
            )
            session_metrics = sm.mappings().first()

            if not session_metrics:
                raise ValueError(
                    f"No metrics found for session {session_id}"
                )

            # Load transcript from the sessions table
            from app.models import Session
            session = await db.get(Session, session_id)
            transcript = session.transcript_text or "" if session else ""

            # Mark coaching as generating
            feedback_row = CoachingFeedback(
                session_id=session_id,
                user_id=user_id,
                status="generating",
            )
            db.add(feedback_row)
            await db.commit()
            feedback_id = feedback_row.id

        # ── 2. Load history ───────────────────────────
        async with db_factory() as db:
            history = await get_session_history(db, user_id, limit=10)

        # ── 3. Load previous coaching ─────────────────
        previous_feedback: dict[str, Any] | None = None
        async with db_factory() as db:
            from sqlalchemy import select, desc
            prev = await db.execute(
                select(CoachingFeedback)
                .where(
                    CoachingFeedback.user_id == user_id,
                    CoachingFeedback.status == "completed",
                    CoachingFeedback.session_id != session_id,
                )
                .order_by(desc(CoachingFeedback.created_at))
                .limit(1)
            )
            prev_row = prev.scalar_one_or_none()
            if prev_row:
                previous_feedback = {
                    "improvements": prev_row.improvements,
                    "practice_plan": prev_row.practice_plan,
                }

        # ── 4. Call LLM ──────────────────────────────
        metrics_dict = dict(session_metrics)
        result = await generate_coaching_feedback(
            transcript=transcript,
            metrics=metrics_dict,
            history=history,
            previous_feedback=previous_feedback,
        )

        # ── 5. Store results ─────────────────────────
        async with db_factory() as db:
            fb = await db.get(CoachingFeedback, feedback_id)
            if fb:
                fb.status = "completed"
                fb.summary = result["summary"]
                fb.strengths = result["strengths"]
                fb.improvements = result["improvements"]
                fb.drills = result["drills"]
                fb.practice_plan = result["practice_plan"]
                fb.raw_response = result["raw_response"]
                fb.model_used = result["model_used"]
                fb.generation_time_ms = result["generation_time_ms"]
                fb.trend_context = {
                    "sessions_analyzed": len(history),
                    "progress_note": result.get("progress_note"),
                }
                await db.commit()

        logger.info(
            "Coaching feedback generated for session %d in %dms",
            session_id,
            result["generation_time_ms"],
        )
        return {"status": "completed", "feedback_id": feedback_id}

    except Exception as exc:
        # Mark as failed
        try:
            async with db_factory() as db:
                from sqlalchemy import select
                fb_result = await db.execute(
                    select(CoachingFeedback).where(
                        CoachingFeedback.session_id == session_id
                    )
                )
                fb = fb_result.scalar_one_or_none()
                if fb:
                    fb.status = "failed"
                    fb.error_message = str(exc)[:500]
                    await db.commit()
        except Exception:
            logger.exception("Failed to update coaching status")

        logger.exception("Coaching generation failed for session %d", session_id)
        raise
```

**Register in worker settings** (`apps/api/app/worker/settings.py`):

```python
from app.worker.coaching_job import generate_session_coaching

class WorkerSettings:
    functions = [transcribe_recording, generate_session_coaching]
    # ...rest unchanged
```

**Chain from transcription job** — add at the end of `transcribe_recording` in `apps/api/app/worker/jobs.py`, after the metrics update:

```python
        # ── 6. Enqueue coaching feedback generation ───
        from app.config import settings as app_settings
        if app_settings.COACHING_ENABLED and app_settings.LLM_API_KEY:
            from arq.connections import ArqRedis
            pool: ArqRedis = ctx.get("arq_pool")  # Set in on_startup
            if pool:
                await pool.enqueue_job(
                    "generate_session_coaching",
                    session_id=session_id,
                    user_id=session.user_id,
                )
                logger.info("Enqueued coaching job for session %d", session_id)
```

### 3.4 Coaching API endpoints

**Create file:** `apps/api/app/routers/coaching.py`

```python
"""Coaching feedback API endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.security import get_current_user, TokenPayload
from app.models.analytics import CoachingFeedback

router = APIRouter(prefix="/api/coaching", tags=["coaching"])


@router.get("/session/{session_id}")
async def get_session_coaching(
    session_id: int,
    user: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Get coaching feedback for a specific session."""
    result = await db.execute(
        select(CoachingFeedback).where(
            CoachingFeedback.session_id == session_id,
            CoachingFeedback.user_id == int(user.sub),
        )
    )
    fb = result.scalar_one_or_none()

    if fb is None:
        raise HTTPException(status_code=404, detail="No coaching feedback found")

    return {
        "status": fb.status,
        "summary": fb.summary,
        "strengths": fb.strengths,
        "improvements": fb.improvements,
        "drills": fb.drills,
        "practice_plan": fb.practice_plan,
        "trend_context": fb.trend_context,
        "model_used": fb.model_used,
        "generation_time_ms": fb.generation_time_ms,
        "created_at": fb.created_at.isoformat() if fb.created_at else None,
        "error_message": fb.error_message if fb.status == "failed" else None,
    }


@router.get("/latest")
async def get_latest_coaching(
    user: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Get the most recent completed coaching feedback."""
    result = await db.execute(
        select(CoachingFeedback)
        .where(
            CoachingFeedback.user_id == int(user.sub),
            CoachingFeedback.status == "completed",
        )
        .order_by(desc(CoachingFeedback.created_at))
        .limit(1)
    )
    fb = result.scalar_one_or_none()

    if fb is None:
        raise HTTPException(status_code=404, detail="No coaching feedback available yet")

    return {
        "session_id": fb.session_id,
        "summary": fb.summary,
        "strengths": fb.strengths,
        "improvements": fb.improvements,
        "drills": fb.drills,
        "practice_plan": fb.practice_plan,
        "trend_context": fb.trend_context,
        "created_at": fb.created_at.isoformat() if fb.created_at else None,
    }


@router.get("/history")
async def coaching_history(
    limit: int = Query(default=10, ge=1, le=50),
    user: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list:
    """List coaching feedback history (summaries only)."""
    result = await db.execute(
        select(CoachingFeedback)
        .where(
            CoachingFeedback.user_id == int(user.sub),
            CoachingFeedback.status == "completed",
        )
        .order_by(desc(CoachingFeedback.created_at))
        .limit(limit)
    )

    return [
        {
            "session_id": fb.session_id,
            "summary": fb.summary,
            "focus_areas": (fb.practice_plan or {}).get("focus_areas", []),
            "created_at": fb.created_at.isoformat() if fb.created_at else None,
        }
        for fb in result.scalars().all()
    ]
```

---

## Phase 4 — Dashboard frontend

### 4.1 Dashboard Zustand store

**Create file:** `apps/web/lib/stores/dashboardStore.ts`

```typescript
/**
 * Dashboard state management.
 *
 * Fetches and caches all dashboard data. Each data slice has its
 * own loading/error state so partial failures don't block the
 * entire dashboard.
 *
 * Memory safety:
 * - AbortController cancels in-flight requests when the store
 *   is re-fetched (prevents stale data from late responses).
 * - Data arrays are bounded by the API (max 365 days, max 100 sessions).
 */

import { create } from "zustand";
import { apiFetch } from "@/lib/api";

interface OverviewStats {
  total_sessions: number;
  total_practice_minutes: number;
  recent_30d: {
    session_count: number;
    avg_overall_score: number;
    avg_wpm: number;
    avg_filler_rate: number;
    avg_delivery_score: number;
    practice_days: number;
  };
}

interface TrendPoint {
  date: string;
  value: number;
}

interface SessionRow {
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
}

interface HeatmapDay {
  date: string;
  count: number;
  minutes: number;
}

interface DashboardState {
  // Data
  overview: OverviewStats | null;
  trendData: Record<string, TrendPoint[]>;
  sessions: SessionRow[];
  heatmap: HeatmapDay[];
  fillerBreakdown: Record<string, number>;

  // Loading states
  loadingOverview: boolean;
  loadingTrend: boolean;
  loadingSessions: boolean;
  loadingHeatmap: boolean;

  // Error states
  errorOverview: string | null;
  errorTrend: string | null;

  // Actions
  fetchOverview: () => Promise<void>;
  fetchTrend: (metric: string, days?: number) => Promise<void>;
  fetchSessions: (limit?: number, offset?: number) => Promise<void>;
  fetchHeatmap: (days?: number) => Promise<void>;
  fetchFillers: () => Promise<void>;
  fetchAll: () => Promise<void>;
}

let overviewController: AbortController | null = null;
let trendController: AbortController | null = null;

export const useDashboardStore = create<DashboardState>((set, get) => ({
  overview: null,
  trendData: {},
  sessions: [],
  heatmap: [],
  fillerBreakdown: {},
  loadingOverview: false,
  loadingTrend: false,
  loadingSessions: false,
  loadingHeatmap: false,
  errorOverview: null,
  errorTrend: null,

  fetchOverview: async () => {
    overviewController?.abort();
    overviewController = new AbortController();

    set({ loadingOverview: true, errorOverview: null });
    try {
      const res = await apiFetch("/api/dashboard/overview", {
        signal: overviewController.signal,
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const data = await res.json();
      set({ overview: data, loadingOverview: false });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      set({
        errorOverview: err instanceof Error ? err.message : "Unknown error",
        loadingOverview: false,
      });
    }
  },

  fetchTrend: async (metric: string, days = 90) => {
    trendController?.abort();
    trendController = new AbortController();

    set({ loadingTrend: true, errorTrend: null });
    try {
      const res = await apiFetch(
        `/api/dashboard/trends/${metric}?days=${days}`,
        { signal: trendController.signal },
      );
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const data: TrendPoint[] = await res.json();
      set((state) => ({
        trendData: { ...state.trendData, [metric]: data },
        loadingTrend: false,
      }));
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      set({
        errorTrend: err instanceof Error ? err.message : "Unknown error",
        loadingTrend: false,
      });
    }
  },

  fetchSessions: async (limit = 20, offset = 0) => {
    set({ loadingSessions: true });
    try {
      const res = await apiFetch(
        `/api/dashboard/sessions?limit=${limit}&offset=${offset}`,
      );
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const data: SessionRow[] = await res.json();
      set({ sessions: data, loadingSessions: false });
    } catch {
      set({ loadingSessions: false });
    }
  },

  fetchHeatmap: async (days = 365) => {
    set({ loadingHeatmap: true });
    try {
      const res = await apiFetch(`/api/dashboard/heatmap?days=${days}`);
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const data: HeatmapDay[] = await res.json();
      set({ heatmap: data, loadingHeatmap: false });
    } catch {
      set({ loadingHeatmap: false });
    }
  },

  fetchFillers: async () => {
    try {
      const res = await apiFetch("/api/dashboard/fillers");
      if (!res.ok) return;
      const data: Record<string, number> = await res.json();
      set({ fillerBreakdown: data });
    } catch {
      // Non-critical — silently fail
    }
  },

  fetchAll: async () => {
    const store = get();
    await Promise.allSettled([
      store.fetchOverview(),
      store.fetchTrend("avg_overall_score"),
      store.fetchTrend("avg_wpm"),
      store.fetchTrend("avg_filler_rate"),
      store.fetchSessions(),
      store.fetchHeatmap(),
      store.fetchFillers(),
    ]);
  },
}));
```

### 4.2 Dashboard page

**Create file:** `apps/web/app/dashboard/page.tsx`

```tsx
"use client";

import { useEffect } from "react";
import { useDashboardStore } from "@/lib/stores/dashboardStore";
import { OverviewCards } from "./components/OverviewCards";
import { TrendChart } from "./components/TrendChart";
import { ActivityHeatmap } from "./components/ActivityHeatmap";
import { SessionHistory } from "./components/SessionHistory";
import { FillerBreakdown } from "./components/FillerBreakdown";
import { CoachingPanel } from "./components/CoachingPanel";

export default function DashboardPage() {
  const fetchAll = useDashboardStore((s) => s.fetchAll);
  const loadingOverview = useDashboardStore((s) => s.loadingOverview);

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <header>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
            Practice dashboard
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Your speech practice analytics and AI coaching insights.
          </p>
        </header>

        {/* Row 1: Overview stats cards */}
        <OverviewCards />

        {/* Row 2: Coaching spotlight + Activity heatmap */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <CoachingPanel />
          </div>
          <div>
            <ActivityHeatmap />
          </div>
        </div>

        {/* Row 3: Trend charts */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <TrendChart
            metric="avg_overall_score"
            label="Overall score"
            color="#534AB7"
            unit="/100"
          />
          <TrendChart
            metric="avg_wpm"
            label="Words per minute"
            color="#1D9E75"
            unit=" WPM"
          />
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <TrendChart
            metric="avg_filler_rate"
            label="Fillers per minute"
            color="#D85A30"
            unit="/min"
            lowerIsBetter
          />
          <FillerBreakdown />
        </div>

        {/* Row 4: Session history table */}
        <SessionHistory />
      </div>
    </div>
  );
}
```

### 4.3 Overview cards component

**Create file:** `apps/web/app/dashboard/components/OverviewCards.tsx`

```tsx
"use client";

import { useDashboardStore } from "@/lib/stores/dashboardStore";

interface StatCardProps {
  label: string;
  value: string | number;
  subtext: string;
  trend?: "up" | "down" | "neutral";
}

function StatCard({ label, value, subtext, trend }: StatCardProps) {
  const trendColor =
    trend === "up"
      ? "text-green-600 dark:text-green-400"
      : trend === "down"
        ? "text-red-600 dark:text-red-400"
        : "text-gray-500 dark:text-gray-400";

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">
        {value}
      </p>
      <p className={`mt-1 text-xs ${trendColor}`}>{subtext}</p>
    </div>
  );
}

export function OverviewCards() {
  const overview = useDashboardStore((s) => s.overview);
  const loading = useDashboardStore((s) => s.loadingOverview);

  if (loading || !overview) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-28 animate-pulse rounded-xl border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-800"
          />
        ))}
      </div>
    );
  }

  const r = overview.recent_30d;

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <StatCard
        label="Total sessions"
        value={overview.total_sessions}
        subtext={`${r.session_count} in the last 30 days`}
      />
      <StatCard
        label="Practice time"
        value={`${Math.round(overview.total_practice_minutes)}m`}
        subtext={`${r.practice_days} practice days this month`}
      />
      <StatCard
        label="Avg score (30d)"
        value={`${r.avg_overall_score}/100`}
        subtext={`${r.avg_wpm} WPM average`}
        trend={r.avg_overall_score >= 70 ? "up" : r.avg_overall_score >= 50 ? "neutral" : "down"}
      />
      <StatCard
        label="Filler rate (30d)"
        value={`${r.avg_filler_rate}/min`}
        subtext={r.avg_filler_rate <= 1 ? "Great control" : "Room to improve"}
        trend={r.avg_filler_rate <= 1 ? "up" : r.avg_filler_rate <= 3 ? "neutral" : "down"}
      />
    </div>
  );
}
```

### 4.4 Trend chart component

**Create file:** `apps/web/app/dashboard/components/TrendChart.tsx`

```tsx
"use client";

import { useEffect } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useDashboardStore } from "@/lib/stores/dashboardStore";

interface TrendChartProps {
  metric: string;
  label: string;
  color: string;
  unit?: string;
  lowerIsBetter?: boolean;
}

export function TrendChart({
  metric,
  label,
  color,
  unit = "",
  lowerIsBetter = false,
}: TrendChartProps) {
  const trendData = useDashboardStore((s) => s.trendData[metric]);
  const loading = useDashboardStore((s) => s.loadingTrend);
  const fetchTrend = useDashboardStore((s) => s.fetchTrend);

  useEffect(() => {
    if (!trendData) {
      fetchTrend(metric);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metric]);

  if (loading && !trendData) {
    return (
      <div className="h-72 animate-pulse rounded-xl border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-800" />
    );
  }

  const data = trendData ?? [];

  // Format dates as "Mar 5" style
  const formatted = data.map((d) => ({
    ...d,
    label: new Date(d.date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
  }));

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <h3 className="mb-4 text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
      </h3>
      {data.length === 0 ? (
        <p className="flex h-48 items-center justify-center text-sm text-gray-400">
          No data yet. Complete a few practice sessions to see trends.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={formatted}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11 }}
              interval="preserveStartEnd"
            />
            <YAxis tick={{ fontSize: 11 }} width={45} />
            <Tooltip
              formatter={(value: number) => [`${value}${unit}`, label]}
              contentStyle={{
                borderRadius: "8px",
                fontSize: "13px",
                border: "1px solid #e5e7eb",
              }}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
```

### 4.5 Coaching panel component

**Create file:** `apps/web/app/dashboard/components/CoachingPanel.tsx`

```tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api";

interface CoachingData {
  session_id: number;
  summary: string;
  strengths: Array<{ area: string; detail: string }>;
  improvements: Array<{
    area: string;
    detail: string;
    priority: string;
    example?: string;
  }>;
  drills: Array<{
    name: string;
    description: string;
    duration_minutes: number;
    targets: string;
  }>;
  practice_plan: {
    focus_areas: string[];
    suggested_duration_minutes: number;
    difficulty: string;
    next_session_goal: string;
  };
  created_at: string;
}

export function CoachingPanel() {
  const [coaching, setCoaching] = useState<CoachingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<
    "summary" | "drills" | "plan"
  >("summary");

  const fetchCoaching = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/coaching/latest");
      if (res.ok) {
        const data = await res.json();
        setCoaching(data);
      }
    } catch {
      // Coaching not available yet
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCoaching();
  }, [fetchCoaching]);

  if (loading) {
    return (
      <div className="h-64 animate-pulse rounded-xl border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-800" />
    );
  }

  if (!coaching) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-800">
        <div className="text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No coaching feedback yet
          </p>
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
            Complete a practice session to receive AI coaching.
          </p>
        </div>
      </div>
    );
  }

  const priorityColor = {
    high: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    low: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700">
        {(["summary", "drills", "plan"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`px-5 py-3 text-sm font-medium transition-colors ${
              activeTab === tab
                ? "border-b-2 border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
            }`}
          >
            {tab === "summary" ? "Coach notes" : tab === "drills" ? "Drills" : "Next plan"}
          </button>
        ))}
      </div>

      <div className="p-5">
        {activeTab === "summary" && (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">
              {coaching.summary}
            </p>

            {coaching.strengths.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-green-600 dark:text-green-400">
                  Strengths
                </h4>
                <div className="space-y-2">
                  {coaching.strengths.map((s, i) => (
                    <div
                      key={i}
                      className="rounded-lg bg-green-50 p-3 dark:bg-green-900/20"
                    >
                      <span className="text-xs font-medium text-green-700 dark:text-green-400">
                        {s.area}
                      </span>
                      <p className="mt-0.5 text-sm text-green-800 dark:text-green-300">
                        {s.detail}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {coaching.improvements.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                  Areas to improve
                </h4>
                <div className="space-y-2">
                  {coaching.improvements.map((imp, i) => (
                    <div
                      key={i}
                      className="rounded-lg bg-amber-50 p-3 dark:bg-amber-900/20"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                          {imp.area}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            priorityColor[imp.priority as keyof typeof priorityColor] ??
                            priorityColor.medium
                          }`}
                        >
                          {imp.priority}
                        </span>
                      </div>
                      <p className="mt-0.5 text-sm text-amber-800 dark:text-amber-300">
                        {imp.detail}
                      </p>
                      {imp.example && (
                        <p className="mt-1 text-xs italic text-amber-600 dark:text-amber-500">
                          Try: {imp.example}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "drills" && (
          <div className="space-y-4">
            {coaching.drills.map((drill, i) => (
              <div
                key={i}
                className="rounded-lg border border-gray-200 p-4 dark:border-gray-600"
              >
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white">
                    {drill.name}
                  </h4>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {drill.duration_minutes} min
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                  {drill.description}
                </p>
                <p className="mt-2 text-xs text-blue-600 dark:text-blue-400">
                  Targets: {drill.targets}
                </p>
              </div>
            ))}
          </div>
        )}

        {activeTab === "plan" && (
          <div className="space-y-4">
            <div className="rounded-lg bg-blue-50 p-4 dark:bg-blue-900/20">
              <h4 className="text-sm font-medium text-blue-800 dark:text-blue-300">
                Next session goal
              </h4>
              <p className="mt-1 text-sm text-blue-700 dark:text-blue-400">
                {coaching.practice_plan.next_session_goal}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-600">
                <p className="text-xs text-gray-500 dark:text-gray-400">Duration</p>
                <p className="text-lg font-semibold text-gray-900 dark:text-white">
                  {coaching.practice_plan.suggested_duration_minutes} min
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-600">
                <p className="text-xs text-gray-500 dark:text-gray-400">Difficulty</p>
                <p className="text-lg font-semibold capitalize text-gray-900 dark:text-white">
                  {coaching.practice_plan.difficulty}
                </p>
              </div>
            </div>

            {coaching.practice_plan.focus_areas.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">
                  Focus areas
                </p>
                <div className="flex flex-wrap gap-2">
                  {coaching.practice_plan.focus_areas.map((area, i) => (
                    <span
                      key={i}
                      className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-300"
                    >
                      {area}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

### 4.6 Remaining dashboard components

**Create file:** `apps/web/app/dashboard/components/ActivityHeatmap.tsx`

```tsx
"use client";

import { useMemo } from "react";
import { useDashboardStore } from "@/lib/stores/dashboardStore";

export function ActivityHeatmap() {
  const heatmapData = useDashboardStore((s) => s.heatmap);
  const loading = useDashboardStore((s) => s.loadingHeatmap);

  // Build a lookup map: date string -> count
  const dateMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const day of heatmapData) {
      map.set(day.date, day.count);
    }
    return map;
  }, [heatmapData]);

  // Generate last 20 weeks of dates (140 days)
  const weeks = useMemo(() => {
    const result: string[][] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find the most recent Sunday
    const dayOfWeek = today.getDay();
    const startSunday = new Date(today);
    startSunday.setDate(today.getDate() - dayOfWeek - 20 * 7);

    for (let w = 0; w < 20; w++) {
      const week: string[] = [];
      for (let d = 0; d < 7; d++) {
        const date = new Date(startSunday);
        date.setDate(startSunday.getDate() + w * 7 + d);
        if (date <= today) {
          week.push(date.toISOString().split("T")[0]);
        }
      }
      result.push(week);
    }
    return result;
  }, []);

  const getIntensity = (count: number): string => {
    if (count === 0) return "bg-gray-100 dark:bg-gray-700";
    if (count === 1) return "bg-green-200 dark:bg-green-800";
    if (count <= 3) return "bg-green-400 dark:bg-green-600";
    return "bg-green-600 dark:bg-green-400";
  };

  if (loading) {
    return (
      <div className="h-64 animate-pulse rounded-xl border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-800" />
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <h3 className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">
        Practice activity
      </h3>
      <div className="flex gap-[3px] overflow-x-auto">
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-[3px]">
            {week.map((dateStr) => {
              const count = dateMap.get(dateStr) ?? 0;
              return (
                <div
                  key={dateStr}
                  className={`h-3 w-3 rounded-sm ${getIntensity(count)}`}
                  title={`${dateStr}: ${count} session${count !== 1 ? "s" : ""}`}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-1 text-[10px] text-gray-400">
        <span>Less</span>
        <div className="h-2.5 w-2.5 rounded-sm bg-gray-100 dark:bg-gray-700" />
        <div className="h-2.5 w-2.5 rounded-sm bg-green-200 dark:bg-green-800" />
        <div className="h-2.5 w-2.5 rounded-sm bg-green-400 dark:bg-green-600" />
        <div className="h-2.5 w-2.5 rounded-sm bg-green-600 dark:bg-green-400" />
        <span>More</span>
      </div>
    </div>
  );
}
```

**Create file:** `apps/web/app/dashboard/components/SessionHistory.tsx`

```tsx
"use client";

import { useDashboardStore } from "@/lib/stores/dashboardStore";

function scoreColor(score: number): string {
  if (score >= 80) return "text-green-600 dark:text-green-400";
  if (score >= 60) return "text-blue-600 dark:text-blue-400";
  if (score >= 40) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

export function SessionHistory() {
  const sessions = useDashboardStore((s) => s.sessions);
  const loading = useDashboardStore((s) => s.loadingSessions);

  if (loading) {
    return (
      <div className="h-48 animate-pulse rounded-xl border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-800" />
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-800">
        <p className="text-sm text-gray-400">No sessions recorded yet.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <div className="px-5 py-4">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Session history
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-t border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
            <tr>
              <th className="px-5 py-2.5 font-medium text-gray-500 dark:text-gray-400">Date</th>
              <th className="px-5 py-2.5 font-medium text-gray-500 dark:text-gray-400">Duration</th>
              <th className="px-5 py-2.5 font-medium text-gray-500 dark:text-gray-400">WPM</th>
              <th className="px-5 py-2.5 font-medium text-gray-500 dark:text-gray-400">Fillers/min</th>
              <th className="px-5 py-2.5 font-medium text-gray-500 dark:text-gray-400">Speech</th>
              <th className="px-5 py-2.5 font-medium text-gray-500 dark:text-gray-400">Delivery</th>
              <th className="px-5 py-2.5 font-medium text-gray-500 dark:text-gray-400">Overall</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {sessions.map((s) => (
              <tr
                key={s.session_id}
                className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-750"
                onClick={() => {
                  window.location.href = `/sessions/${s.session_id}`;
                }}
              >
                <td className="px-5 py-3 text-gray-700 dark:text-gray-300">
                  {new Date(s.recorded_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </td>
                <td className="px-5 py-3 text-gray-600 dark:text-gray-400">
                  {Math.round(s.duration_seconds / 60)}m {Math.round(s.duration_seconds % 60)}s
                </td>
                <td className="px-5 py-3 text-gray-700 dark:text-gray-300">{s.wpm}</td>
                <td className="px-5 py-3 text-gray-700 dark:text-gray-300">{s.filler_rate}</td>
                <td className={`px-5 py-3 font-medium ${scoreColor(s.speech_score)}`}>
                  {s.speech_score}
                </td>
                <td className={`px-5 py-3 font-medium ${scoreColor(s.delivery_score)}`}>
                  {s.delivery_score}
                </td>
                <td className={`px-5 py-3 font-semibold ${scoreColor(s.overall_score)}`}>
                  {s.overall_score}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

**Create file:** `apps/web/app/dashboard/components/FillerBreakdown.tsx`

```tsx
"use client";

import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useDashboardStore } from "@/lib/stores/dashboardStore";

export function FillerBreakdown() {
  const fillers = useDashboardStore((s) => s.fillerBreakdown);

  const data = useMemo(() => {
    return Object.entries(fillers)
      .slice(0, 8) // Top 8 filler words
      .map(([word, count]) => ({ word, count }));
  }, [fillers]);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <h3 className="mb-4 text-sm font-medium text-gray-700 dark:text-gray-300">
        Top filler words (last 20 sessions)
      </h3>
      {data.length === 0 ? (
        <p className="flex h-48 items-center justify-center text-sm text-gray-400">
          No filler data yet.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} layout="vertical" margin={{ left: 50 }}>
            <XAxis type="number" tick={{ fontSize: 11 }} />
            <YAxis
              type="category"
              dataKey="word"
              tick={{ fontSize: 12 }}
              width={50}
            />
            <Tooltip
              formatter={(value: number) => [`${value} times`, "Used"]}
              contentStyle={{
                borderRadius: "8px",
                fontSize: "13px",
                border: "1px solid #e5e7eb",
              }}
            />
            <Bar
              dataKey="count"
              fill="#D85A30"
              radius={[0, 4, 4, 0]}
              barSize={18}
            />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
```

---

## Phase 5 — Backend tests for analytics and coaching

**Create file:** `apps/api/tests/test_analytics.py`

```python
"""Tests for analytics service — pure query tests."""

import pytest
from datetime import datetime, timezone, date, timedelta

from app.models.analytics import SessionMetrics, DailyAggregate
from app.services.analytics import (
    get_overview_stats,
    get_trend_data,
    get_filler_breakdown,
)


@pytest.mark.asyncio
async def test_overview_stats_empty(db_session):
    """Overview returns zeroes when no sessions exist."""
    result = await get_overview_stats(db_session, user_id=1)
    assert result["total_sessions"] == 0
    assert result["total_practice_minutes"] == 0.0


@pytest.mark.asyncio
async def test_overview_stats_with_sessions(db_session):
    """Overview calculates correct totals."""
    now = datetime.now(timezone.utc)
    for i in range(3):
        db_session.add(SessionMetrics(
            session_id=i + 1,
            user_id=1,
            recorded_at=now - timedelta(days=i),
            duration_seconds=300,
            wpm=140,
            filler_count=3,
            filler_rate=1.0,
            word_count=700,
            speech_score=75,
            delivery_score=70,
            overall_score=73,
        ))
    await db_session.commit()

    result = await get_overview_stats(db_session, user_id=1)
    assert result["total_sessions"] == 3
    assert result["total_practice_minutes"] == 15.0  # 300s * 3 / 60


@pytest.mark.asyncio
async def test_trend_data_rejects_invalid_metric(db_session):
    """Trend endpoint rejects unknown metric names."""
    with pytest.raises(ValueError, match="Invalid metric"):
        await get_trend_data(db_session, user_id=1, metric="hacked_column")


@pytest.mark.asyncio
async def test_filler_breakdown_aggregates(db_session):
    """Filler breakdown sums across sessions."""
    now = datetime.now(timezone.utc)
    db_session.add(SessionMetrics(
        session_id=1, user_id=1, recorded_at=now,
        duration_seconds=60, wpm=140, filler_count=5,
        filler_rate=5.0, word_count=140,
        speech_score=60, delivery_score=60, overall_score=60,
        filler_breakdown={"um": 3, "like": 2},
    ))
    db_session.add(SessionMetrics(
        session_id=2, user_id=1, recorded_at=now - timedelta(days=1),
        duration_seconds=60, wpm=140, filler_count=4,
        filler_rate=4.0, word_count=140,
        speech_score=65, delivery_score=65, overall_score=65,
        filler_breakdown={"um": 2, "so": 2},
    ))
    await db_session.commit()

    result = await get_filler_breakdown(db_session, user_id=1)
    assert result["um"] == 5
    assert result["like"] == 2
    assert result["so"] == 2
```

**Create file:** `apps/api/tests/test_coaching_prompt.py`

```python
"""Tests for coaching prompt construction.

These test the prompt builder, not the LLM call itself.
"""

from app.services.coaching import build_coaching_prompt, MAX_TRANSCRIPT_CHARS


def test_prompt_includes_metrics():
    prompt = build_coaching_prompt(
        transcript="Hello world",
        metrics={"wpm": 140, "filler_count": 3, "duration_seconds": 60},
        history=[],
        previous_feedback=None,
    )
    assert "140" in prompt
    assert "filler_count" in prompt.lower() or "Filler word count: 3" in prompt


def test_prompt_truncates_long_transcript():
    long_text = "word " * 10000
    prompt = build_coaching_prompt(
        transcript=long_text,
        metrics={"wpm": 100},
        history=[],
        previous_feedback=None,
    )
    assert "[...transcript truncated...]" in prompt
    assert len(prompt) < len(long_text) + 5000


def test_prompt_includes_history():
    prompt = build_coaching_prompt(
        transcript="Test",
        metrics={"wpm": 130},
        history=[
            {"session_id": 1, "overall_score": 72, "wpm": 130,
             "filler_count": 5, "recorded_at": "2026-01-01"},
        ],
        previous_feedback=None,
    )
    assert "Session 1" in prompt
    assert "score=72" in prompt


def test_prompt_includes_previous_feedback():
    prompt = build_coaching_prompt(
        transcript="Test",
        metrics={"wpm": 130},
        history=[],
        previous_feedback={
            "improvements": [
                {"area": "fillers", "detail": "Reduce um usage"},
            ],
        },
    )
    assert "previous coaching" in prompt.lower()
    assert "fillers" in prompt
```

---

## Phase 6 — Integration, navigation, and polish

### 6.1 Add dashboard route to the app navigation

**Modify:** `apps/web/app/layout.tsx` or the existing navigation component to include a dashboard link:

```tsx
<Link
  href="/dashboard"
  className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
>
  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
  </svg>
  Dashboard
</Link>
```

### 6.2 Wire coaching into session review page

After transcription completes and the user views a session, display a coaching tab. Add to the existing session detail page:

```tsx
// In the session detail/review page, add a coaching section:
import { CoachingSessionView } from "./CoachingSessionView";

// Inside the page component, after the transcript viewer:
<CoachingSessionView sessionId={sessionId} />
```

**Create file:** `apps/web/app/sessions/[id]/CoachingSessionView.tsx`

```tsx
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch } from "@/lib/api";

interface Props {
  sessionId: number;
}

export function CoachingSessionView({ sessionId }: Props) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [status, setStatus] = useState<string>("loading");
  const mountedRef = useRef(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchFeedback = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/coaching/session/${sessionId}`);
      if (!mountedRef.current) return;

      if (res.status === 404) {
        setStatus("not_available");
        return;
      }

      if (!res.ok) {
        setStatus("error");
        return;
      }

      const result = await res.json();
      setData(result);

      if (result.status === "completed" || result.status === "failed") {
        setStatus(result.status);
        if (intervalRef.current) clearInterval(intervalRef.current);
      } else {
        setStatus(result.status);
      }
    } catch {
      if (mountedRef.current) setStatus("error");
    }
  }, [sessionId]);

  useEffect(() => {
    mountedRef.current = true;
    fetchFeedback();

    // Poll while generating
    intervalRef.current = setInterval(fetchFeedback, 3000);

    return () => {
      mountedRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchFeedback]);

  if (status === "loading" || status === "pending" || status === "generating") {
    return (
      <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center gap-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {status === "generating"
              ? "Your AI coach is analyzing this session..."
              : "Preparing coaching feedback..."}
          </p>
        </div>
      </div>
    );
  }

  if (status === "not_available") return null;

  if (status === "failed") {
    return (
      <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-900/20">
        <p className="text-sm text-red-700 dark:text-red-400">
          Coaching feedback could not be generated for this session.
        </p>
      </div>
    );
  }

  if (!data) return null;

  // Render the full coaching feedback — reuse same structure as CoachingPanel
  return (
    <div className="mt-6">
      <h3 className="mb-3 text-lg font-medium text-gray-900 dark:text-white">
        AI coaching feedback
      </h3>
      <p className="mb-4 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
        {data.summary as string}
      </p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Strengths */}
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-900/20">
          <h4 className="mb-2 text-sm font-medium text-green-800 dark:text-green-300">
            What you did well
          </h4>
          <div className="space-y-2">
            {(data.strengths as Array<{ area: string; detail: string }>)?.map(
              (s, i) => (
                <div key={i}>
                  <span className="text-xs font-semibold uppercase text-green-600 dark:text-green-400">
                    {s.area}
                  </span>
                  <p className="text-sm text-green-800 dark:text-green-300">
                    {s.detail}
                  </p>
                </div>
              )
            )}
          </div>
        </div>

        {/* Improvements */}
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
          <h4 className="mb-2 text-sm font-medium text-amber-800 dark:text-amber-300">
            What to work on
          </h4>
          <div className="space-y-2">
            {(
              data.improvements as Array<{
                area: string;
                detail: string;
                priority: string;
              }>
            )?.map((imp, i) => (
              <div key={i}>
                <span className="text-xs font-semibold uppercase text-amber-600 dark:text-amber-400">
                  {imp.area}
                </span>
                <p className="text-sm text-amber-800 dark:text-amber-300">
                  {imp.detail}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
```

### 6.3 Metrics population job

This job runs after every transcription to compute and store the `SessionMetrics` row that powers the dashboard.

**Create file:** `apps/api/app/worker/metrics_job.py`

```python
"""Background job: compute and store session metrics after transcription.

Runs between transcription and coaching in the job chain:
  transcription -> compute_metrics -> coaching
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import select, func

from app.models import Session
from app.models.analytics import SessionMetrics, DailyAggregate

logger = logging.getLogger("arq.metrics")


async def compute_session_metrics(
    ctx: dict[str, Any],
    session_id: int,
    user_id: int,
) -> dict[str, Any]:
    """Compute all metrics for a session and store them.

    Also updates the daily aggregate for the session's date.
    """
    db_factory = ctx["db_factory"]

    async with db_factory() as db:
        session = await db.get(Session, session_id)
        if not session:
            raise ValueError(f"Session {session_id} not found")

        # Check if metrics already exist
        existing = await db.execute(
            select(SessionMetrics).where(
                SessionMetrics.session_id == session_id
            )
        )
        if existing.scalar_one_or_none():
            logger.info("Metrics already exist for session %d, skipping", session_id)
            return {"status": "already_computed"}

        # Compute scores using shared scoring logic
        from packages_shared.scoring import compute_composite_score_py

        duration_minutes = (session.duration_seconds or 0) / 60
        filler_rate = (
            session.filler_count / duration_minutes
            if duration_minutes > 0
            else 0
        )

        # Use the Python port of shared scoring (see below)
        speech_score, delivery_score, overall_score = compute_scores_py(
            wpm=session.wpm or 0,
            filler_count=session.filler_count or 0,
            duration_seconds=session.duration_seconds or 0,
            pause_count=session.pause_count or 0,
            vocabulary_density=session.vocabulary_density or 0,
            eye_contact=session.eye_contact_score,
            smile=session.smile_score,
            head_stability=session.head_stability_score,
            loudness=session.loudness_score,
        )

        sm = SessionMetrics(
            session_id=session_id,
            user_id=user_id,
            recorded_at=session.created_at or datetime.now(timezone.utc),
            duration_seconds=session.duration_seconds or 0,
            word_count=session.word_count or 0,
            wpm=session.wpm or 0,
            filler_count=session.filler_count or 0,
            filler_rate=round(filler_rate, 2),
            pause_count=session.pause_count or 0,
            unique_word_count=session.unique_word_count or 0,
            vocabulary_density=session.vocabulary_density or 0,
            eye_contact_score=session.eye_contact_score,
            smile_score=session.smile_score,
            head_stability_score=session.head_stability_score,
            loudness_score=session.loudness_score,
            speech_score=speech_score,
            delivery_score=delivery_score,
            overall_score=overall_score,
            filler_breakdown=session.filler_breakdown,
        )

        db.add(sm)
        await db.commit()

    # Update daily aggregate
    await _update_daily_aggregate(ctx, user_id, sm.recorded_at.date())

    logger.info("Metrics computed for session %d: score=%d", session_id, overall_score)
    return {"status": "computed", "overall_score": overall_score}


async def _update_daily_aggregate(
    ctx: dict[str, Any],
    user_id: int,
    practice_date: date,
) -> None:
    """Recompute the daily aggregate for a given date."""
    db_factory = ctx["db_factory"]

    async with db_factory() as db:
        result = await db.execute(
            select(
                func.count(SessionMetrics.id).label("count"),
                func.sum(SessionMetrics.duration_seconds).label("total_dur"),
                func.avg(SessionMetrics.wpm).label("avg_wpm"),
                func.avg(SessionMetrics.filler_rate).label("avg_filler"),
                func.avg(SessionMetrics.overall_score).label("avg_overall"),
                func.avg(SessionMetrics.speech_score).label("avg_speech"),
                func.avg(SessionMetrics.delivery_score).label("avg_delivery"),
                func.max(SessionMetrics.overall_score).label("best"),
            ).where(
                SessionMetrics.user_id == user_id,
                func.date(SessionMetrics.recorded_at) == practice_date,
            )
        )
        row = result.one()

        # Upsert
        existing = await db.execute(
            select(DailyAggregate).where(
                DailyAggregate.user_id == user_id,
                DailyAggregate.practice_date == practice_date,
            )
        )
        agg = existing.scalar_one_or_none()

        if agg:
            agg.session_count = row.count or 0
            agg.total_duration_seconds = float(row.total_dur or 0)
            agg.avg_wpm = round(float(row.avg_wpm or 0), 1)
            agg.avg_filler_rate = round(float(row.avg_filler or 0), 2)
            agg.avg_overall_score = round(float(row.avg_overall or 0), 1)
            agg.avg_speech_score = round(float(row.avg_speech or 0), 1)
            agg.avg_delivery_score = round(float(row.avg_delivery or 0), 1)
            agg.best_overall_score = round(float(row.best or 0), 1)
        else:
            db.add(DailyAggregate(
                user_id=user_id,
                practice_date=practice_date,
                session_count=row.count or 0,
                total_duration_seconds=float(row.total_dur or 0),
                avg_wpm=round(float(row.avg_wpm or 0), 1),
                avg_filler_rate=round(float(row.avg_filler or 0), 2),
                avg_overall_score=round(float(row.avg_overall or 0), 1),
                avg_speech_score=round(float(row.avg_speech or 0), 1),
                avg_delivery_score=round(float(row.avg_delivery or 0), 1),
                best_overall_score=round(float(row.best or 0), 1),
            ))

        await db.commit()


def compute_scores_py(
    wpm: float,
    filler_count: int,
    duration_seconds: float,
    pause_count: int,
    vocabulary_density: float,
    eye_contact: float | None,
    smile: float | None,
    head_stability: float | None,
    loudness: float | None,
) -> tuple[float, float, float]:
    """Python port of the TypeScript scoring logic.

    Returns (speech_score, delivery_score, overall_score).
    """
    duration_minutes = duration_seconds / 60 if duration_seconds > 0 else 0

    # Pace score
    if wpm <= 0:
        pace = 0
    elif 130 <= wpm <= 170:
        pace = 100
    elif wpm < 130:
        pace = max(0, int(50 + (wpm - 100) / (130 - 100) * 50)) if wpm > 100 else max(0, int(30 + (wpm / 100) * 20))
    else:
        pace = max(0, int(50 + (200 - wpm) / (200 - 170) * 50)) if wpm < 200 else max(0, int(50 - ((wpm - 200) / 50) * 30))

    # Filler score
    fpm = filler_count / duration_minutes if duration_minutes > 0 else 0
    if fpm <= 0: filler_s = 100
    elif fpm <= 0.5: filler_s = 95
    elif fpm <= 1.0: filler_s = 85
    elif fpm <= 2.0: filler_s = 70
    elif fpm <= 3.0: filler_s = 55
    elif fpm <= 5.0: filler_s = 35
    elif fpm <= 8.0: filler_s = 20
    else: filler_s = 10

    # Vocabulary score
    if vocabulary_density >= 0.8: vocab = 100
    elif vocabulary_density >= 0.65: vocab = 85
    elif vocabulary_density >= 0.5: vocab = 70
    elif vocabulary_density >= 0.35: vocab = 50
    else: vocab = 30

    speech_score = round(pace * 0.35 + filler_s * 0.30 + 70 * 0.15 + vocab * 0.20)

    # Delivery
    delivery_metrics = []
    for raw in [eye_contact, smile, head_stability, loudness]:
        if raw is not None:
            clamped = max(0.0, min(1.0, raw))
            delivery_metrics.append(round(pow(clamped, 0.7) * 100))

    delivery_score = (
        round(sum(delivery_metrics) / len(delivery_metrics))
        if delivery_metrics
        else 0
    )

    overall = (
        round(speech_score * 0.6 + delivery_score * 0.4)
        if delivery_metrics
        else speech_score
    )

    return speech_score, delivery_score, overall
```

---

## Verification matrix

| Feature | Check | How to verify |
|---|---|---|
| Dashboard loads | Overview stats appear | Navigate to `/dashboard`, verify 4 stat cards render |
| Trend charts | Score trend line visible | Check `/dashboard` after 3+ sessions, verify line chart has data |
| Activity heatmap | Green squares on practice days | Check heatmap shows today's date filled after a session |
| Session history | Table with clickable rows | Verify table rows link to session detail pages |
| Filler breakdown | Bar chart shows top fillers | Complete a session with filler words, check bar chart |
| Coaching feedback | AI feedback appears after session | Complete a session, wait for coaching job, verify summary shows |
| Coaching drills | Drills tab shows exercises | Click Drills tab in coaching panel, verify structured drills |
| Practice plan | Next-session goal displayed | Click Plan tab, verify focus areas and goal |
| Coaching history | Previous coaching summaries listed | `GET /api/coaching/history` returns sorted list |
| Session comparison | Two sessions compared side-by-side | `GET /api/dashboard/compare?session_a=1&session_b=2` |
| Scoring consistency | TypeScript and Python produce same scores | Run same inputs through both, assert matching output |
| Prompt truncation | 100K-char transcript does not crash | Feed oversized transcript, verify truncation and success |
| Error isolation | One failed API call does not break others | Kill Redis, verify dashboard still loads overview from DB |
| Memory: long transcript | No OOM on 2-hour recording transcript | Monitor memory during 8000-char truncation |
| Memory: polling | No leaked intervals after unmount | Navigate away from session detail, verify no console warnings |
| Migration | Tables created on fresh DB | `docker compose up` with empty volume, verify tables exist |