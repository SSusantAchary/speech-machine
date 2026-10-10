from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app import models, schemas
from app.auth import get_current_user
from app.db import get_db
from app.services.analytics import (
    compare_sessions,
    get_activity_heatmap,
    get_filler_breakdown,
    get_goal_current_values,
    get_overview_stats,
    get_session_history,
    get_trend_data,
    get_user_goals,
    prepare_user_analytics,
    serialize_goal,
)

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


def _validate_goal_values(comparison: str, target_value: float, target_upper: float | None) -> None:
    if comparison == "between" and (target_upper is None or target_upper <= target_value):
        raise HTTPException(status_code=422, detail="between goals require target_upper greater than target_value")
    if comparison != "between" and target_upper is not None:
        raise HTTPException(status_code=422, detail="target_upper is only valid for between goals")


@router.get("/overview")
def overview(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prepare_user_analytics(db, current_user.id)
    return get_overview_stats(db, current_user.id)


@router.get("/goals", response_model=list[schemas.UserGoalOut])
def goals(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prepare_user_analytics(db, current_user.id)
    return get_user_goals(db, current_user.id)


@router.post("/goals", response_model=schemas.UserGoalOut, status_code=201)
def create_goal(
    payload: schemas.UserGoalCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    existing = (
        db.query(models.UserGoal)
        .filter(
            models.UserGoal.user_id == current_user.id,
            models.UserGoal.metric_name == payload.metric_name,
        )
        .first()
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail="A goal for this metric already exists")
    goal = models.UserGoal(user_id=current_user.id, **payload.model_dump())
    db.add(goal)
    db.commit()
    db.refresh(goal)
    current = get_goal_current_values(db, current_user.id).get(goal.metric_name)
    return serialize_goal(goal, current)


@router.patch("/goals/{goal_id}", response_model=schemas.UserGoalOut)
def update_goal(
    goal_id: int,
    payload: schemas.UserGoalUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    goal = (
        db.query(models.UserGoal)
        .filter(models.UserGoal.id == goal_id, models.UserGoal.user_id == current_user.id)
        .first()
    )
    if goal is None:
        raise HTTPException(status_code=404, detail="Goal not found")
    updates = payload.model_dump(exclude_unset=True)
    comparison = updates.get("comparison", goal.comparison)
    target_value = updates.get("target_value", goal.target_value)
    target_upper = updates.get("target_upper", goal.target_upper)
    if comparison != "between" and "comparison" in updates and "target_upper" not in updates:
        target_upper = None
        updates["target_upper"] = None
    _validate_goal_values(comparison, target_value, target_upper)
    for key, value in updates.items():
        setattr(goal, key, value)
    db.commit()
    db.refresh(goal)
    current = get_goal_current_values(db, current_user.id).get(goal.metric_name)
    return serialize_goal(goal, current)


@router.delete("/goals/{goal_id}")
def delete_goal(
    goal_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    goal = (
        db.query(models.UserGoal)
        .filter(models.UserGoal.id == goal_id, models.UserGoal.user_id == current_user.id)
        .first()
    )
    if goal is None:
        raise HTTPException(status_code=404, detail="Goal not found")
    db.delete(goal)
    db.commit()
    return {"status": "deleted"}


@router.get("/trends/{metric}")
def trends(
    metric: str,
    days: int = Query(default=90, ge=7, le=365),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prepare_user_analytics(db, current_user.id)
    try:
        return get_trend_data(db, current_user.id, metric, days)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/sessions")
def sessions(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prepare_user_analytics(db, current_user.id)
    return get_session_history(db, current_user.id, limit, offset)


@router.get("/heatmap")
def heatmap(
    days: int = Query(default=365, ge=30, le=365),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prepare_user_analytics(db, current_user.id)
    return get_activity_heatmap(db, current_user.id, days)


@router.get("/fillers")
def fillers(
    last_n: int = Query(default=20, ge=5, le=100),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prepare_user_analytics(db, current_user.id)
    return get_filler_breakdown(db, current_user.id, last_n)


@router.get("/compare")
def compare(
    session_a: int = Query(...),
    session_b: int = Query(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prepare_user_analytics(db, current_user.id)
    try:
        return compare_sessions(db, current_user.id, session_a, session_b)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
