import hashlib
import uuid
from datetime import datetime, timedelta

import bcrypt
from fastapi import Cookie, Depends, HTTPException, Response, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import models
from app.config import settings
from app.db import get_db

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")
REFRESH_COOKIE_NAME = "refresh_token"


class TokenPayload(BaseModel):
    sub: str
    email: str | None = None
    role: str = "user"
    jti: str
    type: str


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), hashed_password.encode("utf-8"))


def _utcnow() -> datetime:
    return datetime.utcnow()


def _hash_jti(jti: str) -> str:
    return hashlib.sha256(jti.encode("utf-8")).hexdigest()


def _token_expire_delta(token_type: str) -> timedelta:
    if token_type == "refresh":
        return timedelta(days=settings.refresh_token_expire_days)
    return timedelta(minutes=settings.access_token_expire_minutes)


def _create_token(user: models.User, token_type: str, jti: str | None = None) -> tuple[str, str, datetime]:
    token_jti = jti or str(uuid.uuid4())
    expires_at = _utcnow() + _token_expire_delta(token_type)
    payload = {
        "sub": str(user.id),
        "email": user.email,
        "role": "admin" if user.is_admin else "user",
        "iat": _utcnow(),
        "exp": expires_at,
        "jti": token_jti,
        "type": token_type,
    }
    token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return token, token_jti, expires_at


def create_access_token(user: models.User) -> str:
    token, _jti, _expires_at = _create_token(user, "access")
    return token


def create_refresh_token(db: Session, user: models.User) -> str:
    token, jti, expires_at = _create_token(user, "refresh")
    db.add(
        models.RefreshToken(
            user_id=user.id,
            jti_hash=_hash_jti(jti),
            expires_at=expires_at,
        )
    )
    db.commit()
    return token


def set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=settings.refresh_token_expire_days * 24 * 60 * 60,
        path="/auth",
    )


def clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        key=REFRESH_COOKIE_NAME,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/auth",
    )


def decode_token(token: str, expected_type: str = "access") -> TokenPayload:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
            options={"require_exp": True, "require_iat": True},
        )
    except JWTError as exc:
        raise credentials_exception from exc

    if payload.get("type") != expected_type:
        raise credentials_exception

    try:
        return TokenPayload(
            sub=str(payload["sub"]),
            email=payload.get("email"),
            role=payload.get("role", "user"),
            jti=str(payload["jti"]),
            type=str(payload["type"]),
        )
    except (KeyError, ValueError) as exc:
        raise credentials_exception from exc


def authenticate_user(db: Session, email: str, password: str) -> models.User | None:
    user = db.query(models.User).filter(models.User.email == email).first()
    if not user or not verify_password(password, user.hashed_password):
        return None
    return user


def issue_token_pair(db: Session, response: Response, user: models.User) -> dict:
    access_token = create_access_token(user)
    refresh_token = create_refresh_token(db, user)
    set_refresh_cookie(response, refresh_token)
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "expires_in": settings.access_token_expire_minutes * 60,
        "user": {"id": user.id, "email": user.email, "is_admin": user.is_admin},
    }


def rotate_refresh_token(
    db: Session,
    response: Response,
    refresh_token: str | None,
) -> dict:
    if not refresh_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing refresh token")

    payload = decode_token(refresh_token, expected_type="refresh")
    token_row = (
        db.query(models.RefreshToken)
        .filter(models.RefreshToken.jti_hash == _hash_jti(payload.jti))
        .first()
    )
    if token_row is None or token_row.revoked_at is not None or token_row.expires_at <= _utcnow():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    try:
        user_id = int(payload.sub)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token") from exc

    user = db.query(models.User).filter(models.User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    access_token = create_access_token(user)
    new_refresh_token, new_jti, new_expires_at = _create_token(user, "refresh")
    token_row.revoked_at = _utcnow()
    token_row.replaced_by_jti_hash = _hash_jti(new_jti)
    db.add(
        models.RefreshToken(
            user_id=user.id,
            jti_hash=_hash_jti(new_jti),
            expires_at=new_expires_at,
        )
    )
    db.commit()
    set_refresh_cookie(response, new_refresh_token)
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "expires_in": settings.access_token_expire_minutes * 60,
        "user": {"id": user.id, "email": user.email, "is_admin": user.is_admin},
    }


def revoke_refresh_token(db: Session, response: Response, refresh_token: str | None) -> None:
    if refresh_token:
        try:
            payload = decode_token(refresh_token, expected_type="refresh")
        except HTTPException:
            payload = None
        if payload is not None:
            token_row = (
                db.query(models.RefreshToken)
                .filter(models.RefreshToken.jti_hash == _hash_jti(payload.jti))
                .first()
            )
            if token_row is not None and token_row.revoked_at is None:
                token_row.revoked_at = _utcnow()
                db.commit()
    clear_refresh_cookie(response)


def get_current_user(
    db: Session = Depends(get_db),
    token: str = Depends(oauth2_scheme),
) -> models.User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    payload = decode_token(token, expected_type="access")
    try:
        user_id = int(payload.sub)
    except ValueError as exc:
        raise credentials_exception from exc

    user = db.query(models.User).filter(models.User.id == user_id).first()
    if user is None:
        raise credentials_exception
    return user


def get_refresh_cookie(refresh_token: str | None = Cookie(default=None, alias=REFRESH_COOKIE_NAME)) -> str | None:
    return refresh_token
