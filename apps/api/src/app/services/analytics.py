from __future__ import annotations

import re
from datetime import date, datetime, time, timedelta
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models
from app.scoring import FILLER_WORDS, compute_score, compute_wpm, count_fillers, tokenize

ALLOWED_TREND_METRICS = {
    "avg_wpm",
    "avg_filler_rate",
    "avg_overall_score",
    "avg_speech_score",
    "avg_delivery_score",
    "session_count",
    "total_duration_seconds",
    "best_overall_score",
}

GOAL_METRICS = {
    "wpm",
    "filler_rate",
    "overall_score",
    "practice_days_per_week",
    "session_duration_minutes",
    "eye_contact_score",
    "delivery_score",
}


def prepare_user_analytics(db: Session, user_id: int, limit: int = 100) -> None:
    missing_sessions = (
        db.query(models.Session.id)
        .outerjoin(models.SessionMetrics, models.SessionMetrics.session_id == models.Session.id)
        .filter(models.Session.user_id == user_id, models.SessionMetrics.id.is_(None))
        .order_by(models.Session.created_at.desc())
        .limit(limit)
        .all()
    )
    for (session_id,) in missing_sessions:
        compute_session_metrics(db, session_id)


def compute_session_metrics(db: Session, session_id: int) -> models.SessionMetrics:
    session = db.query(models.Session).filter(models.Session.id == session_id).first()
    if session is None:
        raise ValueError(f"Session {session_id} not found")

    segments = _segment_payload(session)
    metrics = _metric_payload(session)
    duration_ms = _duration_ms(session)
    duration_seconds = duration_ms / 1000 if duration_ms > 0 else 0
    word_count = sum(len(tokenize(segment["text"])) for segment in segments)
    words = tokenize(" ".join(segment["text"] for segment in segments))
    unique_word_count = len(set(words))
    vocabulary_density = round(unique_word_count / word_count, 3) if word_count else 0
    filler_breakdown = _filler_breakdown(segments)
    filler_count = sum(filler_breakdown.values())
    filler_rate = round(filler_count / (duration_seconds / 60), 2) if duration_seconds > 0 else 0
    pause_count = len([point for point in metrics if point.get("pause_ms", 0) > 0])
    wpm = session.wpm_avg or compute_wpm(word_count, duration_ms)
    score_data = session.score.data if session.score and isinstance(session.score.data, dict) else None
    if score_data is None:
        score_data = compute_score(segments, metrics, duration_ms, [])

    eye_contact = _metric_avg(metrics, "eye_contact")
    if eye_contact == 0 and session.eye_contact_pct:
        eye_contact = session.eye_contact_pct
    smile = _metric_avg(metrics, "smile")
    loudness = min(1.0, _metric_avg(metrics, "rms") / 100) if metrics else None
    head_stability = _head_stability(metrics)

    existing = (
        db.query(models.SessionMetrics)
        .filter(models.SessionMetrics.session_id == session_id)
        .first()
    )
    snapshot = existing or models.SessionMetrics(session_id=session_id, user_id=session.user_id)
    snapshot.user_id = session.user_id
    snapshot.recorded_at = session.created_at or datetime.utcnow()
    snapshot.duration_seconds = duration_seconds
    snapshot.word_count = word_count
    snapshot.wpm = round(float(wpm or 0), 1)
    snapshot.filler_count = filler_count
    snapshot.filler_rate = filler_rate
    snapshot.pause_count = pause_count
    snapshot.unique_word_count = unique_word_count
    snapshot.vocabulary_density = vocabulary_density
    snapshot.eye_contact_score = _nullable_round(eye_contact)
    snapshot.smile_score = _nullable_round(smile)
    snapshot.head_stability_score = _nullable_round(head_stability)
    snapshot.loudness_score = _nullable_round(loudness)
    snapshot.speech_score = _normalize_score(score_data.get("speech", 0), 40)
    snapshot.delivery_score = _normalize_score(score_data.get("delivery", 0), 30)
    snapshot.overall_score = round(float(score_data.get("total", 0) or 0), 1)
    snapshot.filler_breakdown = filler_breakdown
    snapshot.wpm_timeline = _wpm_timeline(session)

    if existing is None:
        db.add(snapshot)
    db.commit()
    db.refresh(snapshot)
    update_daily_aggregate(db, session.user_id, snapshot.recorded_at.date())
    return snapshot


def update_daily_aggregate(db: Session, user_id: int, practice_date: date) -> models.DailyAggregate:
    start = datetime.combine(practice_date, time.min)
    end = start + timedelta(days=1)
    rows = (
        db.query(models.SessionMetrics)
        .filter(
            models.SessionMetrics.user_id == user_id,
            models.SessionMetrics.recorded_at >= start,
            models.SessionMetrics.recorded_at < end,
        )
        .all()
    )
    aggregate = (
        db.query(models.DailyAggregate)
        .filter(
            models.DailyAggregate.user_id == user_id,
            models.DailyAggregate.practice_date == practice_date,
        )
        .first()
    )
    if aggregate is None:
        aggregate = models.DailyAggregate(user_id=user_id, practice_date=practice_date)
        db.add(aggregate)

    aggregate.session_count = len(rows)
    aggregate.total_duration_seconds = round(sum(row.duration_seconds for row in rows), 1)
    aggregate.avg_wpm = _avg([row.wpm for row in rows])
    aggregate.avg_filler_rate = _avg([row.filler_rate for row in rows])
    aggregate.avg_overall_score = _avg([row.overall_score for row in rows])
    aggregate.avg_speech_score = _avg([row.speech_score for row in rows])
    aggregate.avg_delivery_score = _avg([row.delivery_score for row in rows])
    aggregate.best_overall_score = round(max([row.overall_score for row in rows] or [0]), 1)
    db.commit()
    db.refresh(aggregate)
    return aggregate


def get_overview_stats(db: Session, user_id: int) -> dict[str, Any]:
    total_sessions = db.query(func.count(models.SessionMetrics.id)).filter(models.SessionMetrics.user_id == user_id).scalar() or 0
    total_seconds = db.query(func.coalesce(func.sum(models.SessionMetrics.duration_seconds), 0)).filter(models.SessionMetrics.user_id == user_id).scalar() or 0
    start = datetime.utcnow() - timedelta(days=30)
    recent = (
        db.query(models.SessionMetrics)
        .filter(models.SessionMetrics.user_id == user_id, models.SessionMetrics.recorded_at >= start)
        .all()
    )
    practice_days = (
        db.query(func.count(func.distinct(models.DailyAggregate.practice_date)))
        .filter(models.DailyAggregate.user_id == user_id, models.DailyAggregate.practice_date >= start.date())
        .scalar()
        or 0
    )
    practice_dates = [
        value[0].isoformat()
        for value in db.query(models.DailyAggregate.practice_date)
        .filter(models.DailyAggregate.user_id == user_id)
        .order_by(models.DailyAggregate.practice_date.asc())
        .all()
    ]
    streaks = calculate_streak(practice_dates)
    return {
        "total_sessions": total_sessions,
        "total_practice_minutes": round(float(total_seconds) / 60, 1),
        "current_streak": streaks["current_streak"],
        "longest_streak": streaks["longest_streak"],
        "recent_30d": {
            "session_count": len(recent),
            "avg_overall_score": _avg([row.overall_score for row in recent]),
            "avg_wpm": _avg([row.wpm for row in recent]),
            "avg_filler_rate": _avg([row.filler_rate for row in recent]),
            "avg_delivery_score": _avg([row.delivery_score for row in recent]),
            "practice_days": practice_days,
        },
    }


def get_trend_data(db: Session, user_id: int, metric: str, days: int = 90) -> list[dict[str, Any]]:
    if metric not in ALLOWED_TREND_METRICS:
        raise ValueError(f"Invalid metric: {metric}")
    bounded_days = min(max(days, 7), 365)
    start = date.today() - timedelta(days=bounded_days)
    rows = (
        db.query(models.DailyAggregate)
        .filter(models.DailyAggregate.user_id == user_id, models.DailyAggregate.practice_date >= start)
        .order_by(models.DailyAggregate.practice_date.asc())
        .limit(365)
        .all()
    )
    return [
        {"date": row.practice_date.isoformat(), "value": round(float(getattr(row, metric) or 0), 1)}
        for row in rows
    ]


def get_session_history(db: Session, user_id: int, limit: int = 20, offset: int = 0) -> list[dict[str, Any]]:
    rows = (
        db.query(models.SessionMetrics)
        .filter(models.SessionMetrics.user_id == user_id)
        .order_by(models.SessionMetrics.recorded_at.desc())
        .limit(min(limit, 100))
        .offset(offset)
        .all()
    )
    return [_session_metrics_to_dict(row) for row in rows]


def get_activity_heatmap(db: Session, user_id: int, days: int = 365) -> list[dict[str, Any]]:
    bounded_days = min(max(days, 30), 365)
    start = date.today() - timedelta(days=bounded_days)
    rows = (
        db.query(models.DailyAggregate)
        .filter(models.DailyAggregate.user_id == user_id, models.DailyAggregate.practice_date >= start)
        .order_by(models.DailyAggregate.practice_date.asc())
        .limit(365)
        .all()
    )
    return [
        {
            "date": row.practice_date.isoformat(),
            "count": row.session_count,
            "minutes": round(row.total_duration_seconds / 60, 1),
        }
        for row in rows
    ]


def get_filler_breakdown(db: Session, user_id: int, last_n: int = 20) -> dict[str, int]:
    rows = (
        db.query(models.SessionMetrics.filler_breakdown)
        .filter(models.SessionMetrics.user_id == user_id)
        .order_by(models.SessionMetrics.recorded_at.desc())
        .limit(min(last_n, 100))
        .all()
    )
    combined: dict[str, int] = {}
    for (breakdown,) in rows:
        if not isinstance(breakdown, dict):
            continue
        for word, count in breakdown.items():
            combined[str(word)] = combined.get(str(word), 0) + int(count or 0)
    return dict(sorted(combined.items(), key=lambda item: item[1], reverse=True))


def compare_sessions(db: Session, user_id: int, session_a: int, session_b: int) -> dict[str, Any]:
    rows = (
        db.query(models.SessionMetrics)
        .filter(
            models.SessionMetrics.user_id == user_id,
            models.SessionMetrics.session_id.in_([session_a, session_b]),
        )
        .all()
    )
    by_id = {row.session_id: row for row in rows}
    if session_a not in by_id or session_b not in by_id:
        raise ValueError("One or both sessions not found")

    left = by_id[session_a]
    right = by_id[session_b]

    def diff(attr: str) -> dict[str, float]:
        a_value = float(getattr(left, attr) or 0)
        b_value = float(getattr(right, attr) or 0)
        return {"a": round(a_value, 2), "b": round(b_value, 2), "delta": round(b_value - a_value, 2)}

    return {
        "session_a": {"id": left.session_id, "date": left.recorded_at.isoformat()},
        "session_b": {"id": right.session_id, "date": right.recorded_at.isoformat()},
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


def get_user_goals(db: Session, user_id: int) -> list[dict[str, Any]]:
    rows = (
        db.query(models.UserGoal)
        .filter(models.UserGoal.user_id == user_id)
        .order_by(models.UserGoal.is_active.desc(), models.UserGoal.created_at.asc())
        .all()
    )
    current_values = get_goal_current_values(db, user_id)
    return [serialize_goal(row, current_values.get(row.metric_name)) for row in rows]


def get_active_goal_context(db: Session, user_id: int) -> list[dict[str, Any]]:
    rows = (
        db.query(models.UserGoal)
        .filter(models.UserGoal.user_id == user_id, models.UserGoal.is_active.is_(True))
        .order_by(models.UserGoal.created_at.asc())
        .all()
    )
    current_values = get_goal_current_values(db, user_id)
    return [serialize_goal(row, current_values.get(row.metric_name)) for row in rows]


def get_goal_current_values(db: Session, user_id: int) -> dict[str, float | None]:
    latest = (
        db.query(models.SessionMetrics)
        .filter(models.SessionMetrics.user_id == user_id)
        .order_by(models.SessionMetrics.recorded_at.desc())
        .first()
    )
    week_start = date.today() - timedelta(days=6)
    practice_days = (
        db.query(func.count(models.DailyAggregate.id))
        .filter(
            models.DailyAggregate.user_id == user_id,
            models.DailyAggregate.practice_date >= week_start,
            models.DailyAggregate.session_count > 0,
        )
        .scalar()
        or 0
    )
    if latest is None:
        return {
            metric: (float(practice_days) if metric == "practice_days_per_week" else None)
            for metric in GOAL_METRICS
        }
    return {
        "wpm": float(latest.wpm),
        "filler_rate": float(latest.filler_rate),
        "overall_score": float(latest.overall_score),
        "practice_days_per_week": float(practice_days),
        "session_duration_minutes": round(float(latest.duration_seconds) / 60, 1),
        "eye_contact_score": float(latest.eye_contact_score) if latest.eye_contact_score is not None else None,
        "delivery_score": float(latest.delivery_score),
    }


def serialize_goal(goal: models.UserGoal, current_value: float | None) -> dict[str, Any]:
    achieved = False
    if current_value is not None:
        if goal.comparison == "gte":
            achieved = current_value >= goal.target_value
        elif goal.comparison == "lte":
            achieved = current_value <= goal.target_value
        elif goal.comparison == "between" and goal.target_upper is not None:
            achieved = goal.target_value <= current_value <= goal.target_upper
    return {
        "id": goal.id,
        "metric_name": goal.metric_name,
        "comparison": goal.comparison,
        "target_value": goal.target_value,
        "target_upper": goal.target_upper,
        "is_active": goal.is_active,
        "current_value": current_value,
        "achieved": achieved,
        "created_at": goal.created_at,
        "updated_at": goal.updated_at,
    }


def calculate_streak(practice_dates: list[str]) -> dict[str, int]:
    if not practice_dates:
        return {"current_streak": 0, "longest_streak": 0}
    parsed = sorted({datetime.strptime(value, "%Y-%m-%d").date() for value in practice_dates})
    longest = 1
    current_run = 1
    for index in range(1, len(parsed)):
        gap = (parsed[index] - parsed[index - 1]).days
        if gap == 1:
            current_run += 1
        elif gap > 1:
            current_run = 1
        longest = max(longest, current_run)
    days_since_last = (date.today() - parsed[-1]).days
    return {"current_streak": current_run if days_since_last <= 1 else 0, "longest_streak": longest}


def _session_metrics_to_dict(row: models.SessionMetrics) -> dict[str, Any]:
    return {
        "session_id": row.session_id,
        "recorded_at": row.recorded_at.isoformat(),
        "duration_seconds": row.duration_seconds,
        "wpm": row.wpm,
        "filler_count": row.filler_count,
        "filler_rate": row.filler_rate,
        "speech_score": row.speech_score,
        "delivery_score": row.delivery_score,
        "overall_score": row.overall_score,
        "eye_contact_score": row.eye_contact_score,
        "vocabulary_density": row.vocabulary_density,
    }


def _segment_payload(session: models.Session) -> list[dict[str, Any]]:
    return [
        {"start_ms": segment.start_ms, "end_ms": segment.end_ms, "text": segment.text}
        for segment in session.transcript_segments
    ]


def _metric_payload(session: models.Session) -> list[dict[str, Any]]:
    return [
        {
            "t": point.t,
            "wpm": point.wpm,
            "rms": point.rms,
            "eye_contact": point.eye_contact,
            "smile": point.smile,
            "yaw": point.yaw,
            "pitch": point.pitch,
            "roll": point.roll,
            "filler_count": point.filler_count,
            "pause_ms": point.pause_ms,
        }
        for point in session.metrics
    ]


def _duration_ms(session: models.Session) -> int:
    if session.duration_ms:
        return session.duration_ms
    if session.transcript_segments:
        return max(segment.end_ms for segment in session.transcript_segments)
    return 0


def _filler_breakdown(segments: list[dict[str, Any]]) -> dict[str, int]:
    text = " ".join(str(segment.get("text", "")).lower() for segment in segments)
    counts: dict[str, int] = {}
    for filler in FILLER_WORDS:
        escaped = re.escape(filler).replace(" ", r"\s+")
        pattern = re.compile(rf"\b{escaped}\b")
        count = len(pattern.findall(text))
        if count:
            counts[filler] = count
    if not counts:
        total = count_fillers(segments)
        if total:
            counts["fillers"] = total
    return counts


def _wpm_timeline(session: models.Session) -> list[dict[str, float]]:
    buckets: dict[int, dict[str, float]] = {}
    for segment in session.transcript_segments:
        minute = max(segment.start_ms, 0) // 60000
        duration_seconds = max((segment.end_ms - segment.start_ms) / 1000, 0)
        words = len(tokenize(segment.text))
        bucket = buckets.setdefault(minute, {"words": 0, "seconds": 0})
        bucket["words"] += words
        bucket["seconds"] += duration_seconds
    return [
        {"minute": minute, "wpm": round(bucket["words"] / (bucket["seconds"] / 60), 1) if bucket["seconds"] else 0}
        for minute, bucket in sorted(buckets.items())
    ]


def _metric_avg(metrics: list[dict[str, Any]], key: str) -> float | None:
    values = [float(point.get(key) or 0) for point in metrics if point.get(key) is not None]
    if not values:
        return None
    return sum(values) / len(values)


def _head_stability(metrics: list[dict[str, Any]]) -> float | None:
    if not metrics:
        return None
    variance_total = sum(_variance([float(point.get(axis) or 0) for point in metrics]) for axis in ("yaw", "pitch", "roll"))
    return max(0.0, min(1.0, 1 - variance_total / 20))


def _variance(values: list[float]) -> float:
    if not values:
        return 0
    average = sum(values) / len(values)
    return sum((value - average) ** 2 for value in values) / len(values)


def _avg(values: list[float]) -> float:
    clean = [float(value or 0) for value in values]
    return round(sum(clean) / len(clean), 1) if clean else 0.0


def _normalize_score(value: Any, max_value: float) -> float:
    if max_value <= 0:
        return 0
    return round(max(0, min(100, (float(value or 0) / max_value) * 100)), 1)


def _nullable_round(value: float | None) -> float | None:
    if value is None:
        return None
    return round(float(value), 3)
