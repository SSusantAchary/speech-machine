from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app import models, schemas
from app.auth import hash_password, issue_token_pair
from app.db import get_db
from app.rate_limit import rate_limit

router = APIRouter(prefix="/setup", tags=["setup"])


@router.get("/status", response_model=schemas.SetupStatus)
def setup_status(db: Session = Depends(get_db)):
    user_exists = db.query(models.User.id).first() is not None
    return {"setup_required": not user_exists}


@router.post(
    "",
    response_model=schemas.Token,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit(5))],
)
def initial_setup(payload: schemas.UserCreate, response: Response, db: Session = Depends(get_db)):
    user_exists = db.query(models.User.id).first() is not None
    if user_exists:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Setup already completed")

    user = models.User(
        email=payload.email,
        hashed_password=hash_password(payload.password),
        is_admin=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return issue_token_pair(db, response, user)
