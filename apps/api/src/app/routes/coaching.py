from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app import models
from app.auth import get_current_user
from app.db import get_db
from app.worker.enqueue import enqueue_coaching

router = APIRouter(prefix="/coaching", tags=["coaching"])


@router.get("/session/{session_id}")
def get_session_coaching(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    feedback = (
        db.query(models.CoachingFeedback)
        .filter(
            models.CoachingFeedback.session_id == session_id,
            models.CoachingFeedback.user_id == current_user.id,
        )
        .first()
    )
    if feedback is None:
        return {"status": "not_available"}
    return _serialize_feedback(feedback)


@router.get("/latest")
def latest_coaching(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    feedback = (
        db.query(models.CoachingFeedback)
        .filter(
            models.CoachingFeedback.user_id == current_user.id,
            models.CoachingFeedback.status == "completed",
        )
        .order_by(models.CoachingFeedback.created_at.desc())
        .first()
    )
    if feedback is None:
        return {"status": "not_available"}
    return _serialize_feedback(feedback)


@router.get("/history")
def coaching_history(
    limit: int = Query(default=10, ge=1, le=50),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    rows = (
        db.query(models.CoachingFeedback)
        .filter(
            models.CoachingFeedback.user_id == current_user.id,
            models.CoachingFeedback.status == "completed",
        )
        .order_by(models.CoachingFeedback.created_at.desc())
        .limit(limit)
        .all()
    )
    return [_serialize_feedback(row, include_raw=False) for row in rows]


@router.post("/session/{session_id}/retry")
async def retry_session_coaching(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    session = (
        db.query(models.Session)
        .filter(models.Session.id == session_id, models.Session.user_id == current_user.id)
        .first()
    )
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    feedback = (
        db.query(models.CoachingFeedback)
        .filter(models.CoachingFeedback.session_id == session_id)
        .first()
    )
    if feedback is None:
        feedback = models.CoachingFeedback(
            session_id=session_id,
            user_id=current_user.id,
            status="pending",
        )
        db.add(feedback)
    feedback.user_id = current_user.id
    feedback.status = "pending"
    feedback.error_message = None
    feedback.trend_context = None
    db.commit()

    try:
        job_id = await enqueue_coaching(session_id, current_user.id)
    except Exception as exc:
        feedback.status = "failed"
        feedback.error_message = "Job backend unavailable"
        db.commit()
        raise HTTPException(status_code=503, detail="Job backend unavailable") from exc

    feedback.trend_context = {"job_id": job_id}
    db.commit()
    return {"status": "queued", "job_id": job_id}


def _serialize_feedback(feedback: models.CoachingFeedback, include_raw: bool = False) -> dict:
    payload = {
        "id": feedback.id,
        "session_id": feedback.session_id,
        "status": feedback.status,
        "summary": feedback.summary,
        "strengths": feedback.strengths or [],
        "improvements": feedback.improvements or [],
        "drills": feedback.drills or [],
        "practice_plan": feedback.practice_plan or {},
        "trend_context": feedback.trend_context or {},
        "model_used": feedback.model_used,
        "generation_time_ms": feedback.generation_time_ms,
        "created_at": feedback.created_at.isoformat() if feedback.created_at else None,
        "error_message": feedback.error_message if feedback.status == "failed" else None,
    }
    if include_raw:
        payload["raw_response"] = feedback.raw_response
    return payload
