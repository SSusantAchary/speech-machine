from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app import models, schemas
from app.auth import (
    authenticate_user,
    get_current_user,
    get_refresh_cookie,
    hash_password,
    issue_token_pair,
    revoke_refresh_token,
    rotate_refresh_token,
)
from app.db import get_db
from app.rate_limit import rate_limit

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/signup", response_model=schemas.Token)
def signup(payload: schemas.UserCreate, response: Response, db: Session = Depends(get_db)):
    if db.query(models.User.id).first() is None:
        raise HTTPException(status_code=409, detail="Initial setup required")
    existing = db.query(models.User).filter(models.User.email == payload.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user = models.User(email=payload.email, hashed_password=hash_password(payload.password), is_admin=False)
    db.add(user)
    db.commit()
    db.refresh(user)
    return issue_token_pair(db, response, user)


@router.post("/login", response_model=schemas.Token, dependencies=[Depends(rate_limit(10))])
def login(payload: schemas.UserLogin, response: Response, db: Session = Depends(get_db)):
    user = authenticate_user(db, payload.email, payload.password)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    return issue_token_pair(db, response, user)


@router.post("/refresh", response_model=schemas.Token)
def refresh(
    response: Response,
    refresh_token: str | None = Depends(get_refresh_cookie),
    db: Session = Depends(get_db),
):
    return rotate_refresh_token(db, response, refresh_token)


@router.get("/me", response_model=schemas.UserOut)
def me(current_user: models.User = Depends(get_current_user)):
    return current_user


@router.post("/logout")
def logout(
    response: Response,
    refresh_token: str | None = Depends(get_refresh_cookie),
    db: Session = Depends(get_db),
):
    revoke_refresh_token(db, response, refresh_token)
    return {"status": "ok"}
