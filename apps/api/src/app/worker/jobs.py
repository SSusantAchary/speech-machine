from typing import Any

from app import models
from app.config import settings
from app.db import SessionLocal
from app.routes.sessions import _run_transcription
from app.services.analytics import compute_session_metrics, get_active_goal_context, get_session_history
from app.services.coaching import generate_coaching_feedback


async def transcribe_recording(
    ctx: dict[str, Any],
    session_id: int,
    user_id: int,
    model_name: str | None = None,
    backend_id: str | None = None,
) -> dict:
    _run_transcription(session_id, user_id, model_name, backend_id)
    with SessionLocal() as db:
        session = (
            db.query(models.Session)
            .filter(models.Session.id == session_id, models.Session.user_id == user_id)
            .first()
        )
        if session and session.transcription_status == "complete":
            compute_session_metrics(db, session_id)
            if settings.coaching_enabled:
                feedback = _upsert_coaching_status(db, session_id, user_id, "pending")
                pool = ctx.get("redis")
                if pool is not None:
                    job = await pool.enqueue_job("generate_session_coaching", session_id, user_id)
                    feedback.trend_context = {"job_id": job.job_id if job else None}
                    db.commit()
    return {"session_id": session_id, "status": "complete"}


async def generate_session_coaching(
    ctx: dict[str, Any],
    session_id: int,
    user_id: int,
) -> dict:
    with SessionLocal() as db:
        session = (
            db.query(models.Session)
            .filter(models.Session.id == session_id, models.Session.user_id == user_id)
            .first()
        )
        if session is None:
            return {"session_id": session_id, "status": "failed", "error": "Session not found"}

        feedback = _upsert_coaching_status(db, session_id, user_id, "generating")
        snapshot = compute_session_metrics(db, session_id)
        metrics = _snapshot_to_dict(snapshot)
        transcript = _transcript_text(session)
        history = get_session_history(db, user_id, limit=10)
        active_goals = get_active_goal_context(db, user_id)
        previous = (
            db.query(models.CoachingFeedback)
            .filter(
                models.CoachingFeedback.user_id == user_id,
                models.CoachingFeedback.session_id != session_id,
                models.CoachingFeedback.status == "completed",
            )
            .order_by(models.CoachingFeedback.created_at.desc())
            .first()
        )
        previous_feedback = None
        if previous:
            previous_feedback = {
                "summary": previous.summary,
                "improvements": previous.improvements or [],
                "practice_plan": previous.practice_plan or {},
            }

    try:
        result = generate_coaching_feedback(transcript, metrics, history, previous_feedback, active_goals)
    except Exception as exc:
        with SessionLocal() as db:
            feedback = _upsert_coaching_status(db, session_id, user_id, "failed")
            feedback.error_message = str(exc)[:1000]
            db.commit()
        return {"session_id": session_id, "status": "failed", "error": str(exc)}

    with SessionLocal() as db:
        feedback = _upsert_coaching_status(db, session_id, user_id, "completed")
        feedback.summary = result["summary"]
        feedback.strengths = result["strengths"]
        feedback.improvements = result["improvements"]
        feedback.drills = result["drills"]
        feedback.practice_plan = result["practice_plan"]
        feedback.raw_response = result["raw_response"]
        feedback.model_used = result["model_used"]
        feedback.generation_time_ms = result["generation_time_ms"]
        feedback.error_message = None
        feedback.trend_context = {
            "sessions_analyzed": len(history),
            "progress_note": result.get("progress_note", ""),
        }
        db.commit()
        return {"session_id": session_id, "status": "completed", "feedback_id": feedback.id}


def _upsert_coaching_status(
    db,
    session_id: int,
    user_id: int,
    status: str,
) -> models.CoachingFeedback:
    feedback = (
        db.query(models.CoachingFeedback)
        .filter(models.CoachingFeedback.session_id == session_id)
        .first()
    )
    if feedback is None:
        feedback = models.CoachingFeedback(session_id=session_id, user_id=user_id, status=status)
        db.add(feedback)
    feedback.user_id = user_id
    feedback.status = status
    if status in {"pending", "generating"}:
        feedback.error_message = None
    db.commit()
    db.refresh(feedback)
    return feedback


def _transcript_text(session: models.Session) -> str:
    return "\n".join(
        f"[{segment.start_ms / 1000:.1f}s] {segment.text}"
        for segment in session.transcript_segments
    )


def _snapshot_to_dict(snapshot: models.SessionMetrics) -> dict[str, Any]:
    return {
        "duration_seconds": snapshot.duration_seconds,
        "word_count": snapshot.word_count,
        "wpm": snapshot.wpm,
        "filler_count": snapshot.filler_count,
        "filler_rate": snapshot.filler_rate,
        "pause_count": snapshot.pause_count,
        "vocabulary_density": snapshot.vocabulary_density,
        "speech_score": snapshot.speech_score,
        "delivery_score": snapshot.delivery_score,
        "overall_score": snapshot.overall_score,
        "eye_contact_score": snapshot.eye_contact_score,
        "smile_score": snapshot.smile_score,
        "head_stability_score": snapshot.head_stability_score,
        "loudness_score": snapshot.loudness_score,
        "filler_breakdown": snapshot.filler_breakdown or {},
    }
