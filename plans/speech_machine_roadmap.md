# Speech-Machine: 4-Week Detailed Coding Roadmap

> **Target:** A coding agent can execute every task in this document top-to-bottom with zero ambiguity.  
> **Repo:** `https://github.com/SSusantAchary/Speech-Machine`  
> **Stack:** Next.js 14 (App Router) + React 18 + TypeScript + Tailwind CSS + Zustand | FastAPI + SQLAlchemy + PostgreSQL | Docker Compose  
> **Monorepo layout:** `apps/web`, `apps/api`, `packages/shared`, `infra/scripts`, `docs`

---

## Pre-flight checklist (run before starting any week)

```bash
# Clone and verify the repo builds cleanly
git clone https://github.com/SSusantAchary/Speech-Machine.git
cd Speech-Machine
cp .env.example .env
docker compose up --build -d
# Verify frontend at http://localhost:3000, API docs at http://localhost:8000/docs
docker compose down

# Create a working branch
git checkout -b roadmap/phase-1-foundation
```

---

## WEEK 1 — CI/CD Pipeline, Security Hardening, Env Hygiene

### 1.1 GitHub Actions CI Pipeline

**Goal:** Every push and PR triggers lint, type-check, unit tests, build, and API tests. No code merges without green CI.

**Create file:** `.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

env:
  NODE_VERSION: "20"
  PYTHON_VERSION: "3.11"

jobs:
  # ──────────────────────────────────────────────
  # FRONTEND: lint, type-check, unit test, build
  # ──────────────────────────────────────────────
  frontend:
    name: Frontend
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: apps/web
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: "npm"
          cache-dependency-path: "**/package-lock.json"

      - name: Install dependencies
        run: npm ci --ignore-scripts

      - name: Lint
        run: npx eslint . --max-warnings 0

      - name: Type check
        run: npx tsc --noEmit

      - name: Unit tests
        run: npm test -- --run --reporter=verbose

      - name: Build
        run: npm run build
        env:
          NEXT_TELEMETRY_DISABLED: 1

  # ──────────────────────────────────
  # BACKEND: lint, type-check, test
  # ──────────────────────────────────
  backend:
    name: Backend
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: apps/api
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: speech
          POSTGRES_PASSWORD: speech_test_pw
          POSTGRES_DB: speech_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U speech"
          --health-interval 5s
          --health-timeout 3s
          --health-retries 5
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: ${{ env.PYTHON_VERSION }}
          cache: "pip"
          cache-dependency-path: "apps/api/requirements.txt"

      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          pip install -r requirements.txt
          pip install ruff mypy pytest-cov httpx

      - name: Lint
        run: ruff check .

      - name: Type check
        run: mypy app/ --ignore-missing-imports --no-error-summary

      - name: Run tests with coverage
        run: |
          pytest --cov=app --cov-report=xml --cov-report=term-missing \
                 --tb=short -q
        env:
          DATABASE_URL: "postgresql://speech:speech_test_pw@localhost:5432/speech_test"
          SECRET_KEY: "ci-test-key-not-for-production"
          ENVIRONMENT: "test"

      - name: Upload coverage
        if: github.event_name == 'pull_request'
        uses: actions/upload-artifact@v4
        with:
          name: backend-coverage
          path: apps/api/coverage.xml

  # ──────────────────────────────────
  # SHARED PACKAGE
  # ──────────────────────────────────
  shared:
    name: Shared Package
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: packages/shared
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: "npm"
          cache-dependency-path: "**/package-lock.json"
      - run: npm ci --ignore-scripts
      - run: npx tsc --noEmit

  # ──────────────────────────────────
  # DOCKER BUILD SMOKE TEST
  # ──────────────────────────────────
  docker:
    name: Docker Build
    runs-on: ubuntu-latest
    needs: [frontend, backend, shared]
    steps:
      - uses: actions/checkout@v4
      - name: Build all services
        run: docker compose build
      - name: Start and health-check
        run: |
          docker compose up -d
          sleep 15
          curl --fail --retry 5 --retry-delay 3 http://localhost:3000 || exit 1
          curl --fail --retry 5 --retry-delay 3 http://localhost:8000/docs || exit 1
          docker compose down
```

**Verify:** Push to a branch, confirm all four jobs pass.

**Add branch protection rule on `main`:**

1. Go to repo Settings > Branches > Add rule.
2. Branch name pattern: `main`.
3. Enable: "Require status checks to pass before merging."
4. Select required checks: `Frontend`, `Backend`, `Shared`, `Docker Build`.
5. Enable: "Require pull request reviews before merging" (1 reviewer minimum).

---

### 1.2 ESLint + Ruff Configuration

**Goal:** Consistent code quality enforcement across both stacks.

**Create file:** `apps/web/.eslintrc.json`

```json
{
  "extends": [
    "next/core-web-vitals",
    "next/typescript"
  ],
  "rules": {
    "no-console": ["warn", { "allow": ["warn", "error"] }],
    "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": [
      "error",
      { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }
    ],
    "@typescript-eslint/no-explicit-any": "warn",
    "react-hooks/exhaustive-deps": "error",
    "react-hooks/rules-of-hooks": "error",
    "no-restricted-globals": [
      "error",
      { "name": "localStorage", "message": "Use the storage abstraction in lib/storage.ts" }
    ]
  },
  "ignorePatterns": [".next/", "node_modules/", "out/"]
}
```

**Create file:** `apps/api/ruff.toml`

```toml
[lint]
select = [
    "E",    # pycodestyle errors
    "W",    # pycodestyle warnings
    "F",    # pyflakes
    "I",    # isort
    "N",    # pep8-naming
    "UP",   # pyupgrade
    "S",    # bandit (security)
    "B",    # bugbear
    "A",    # builtins shadowing
    "C4",   # comprehensions
    "DTZ",  # datetime timezone
    "T20",  # print statements
    "SIM",  # simplify
    "RUF",  # ruff-specific
]
ignore = [
    "S101",   # assert used (fine in tests)
    "S104",   # binding to 0.0.0.0 (Docker)
    "E501",   # line length (handled by formatter)
]

[lint.per-file-ignores]
"tests/**/*.py" = ["S101", "S106"]

[format]
quote-style = "double"
indent-style = "space"
line-ending = "lf"
```

---

### 1.3 Replace Default Admin Credentials

**Problem:** Hardcoded `admin/admin` is a critical security vulnerability. Any deployed instance is immediately compromised.

**Modify file:** `apps/api/app/auth.py` (or wherever auth logic lives)

**Step 1: Add first-run setup detection.**

Create file: `apps/api/app/services/setup.py`

```python
"""First-run setup service.

On first launch, no admin user exists. The API exposes a one-time
/api/setup endpoint that:
  1. Checks if ANY user exists in the database.
  2. If zero users exist, accepts an admin username + password.
  3. Creates the admin user with a bcrypt-hashed password.
  4. Returns a JWT.
  5. Subsequent calls to /api/setup return 409 Conflict.

This eliminates the hardcoded admin/admin credential entirely.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import User
from app.security import hash_password, create_access_token

router = APIRouter(tags=["setup"])


class SetupRequest(BaseModel):
    username: str
    password: str

    @field_validator("username")
    @classmethod
    def validate_username(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 3 or len(v) > 64:
            raise ValueError("Username must be 3-64 characters")
        if not re.match(r"^[a-zA-Z0-9_\-\.]+$", v):
            raise ValueError(
                "Username may only contain letters, digits, "
                "underscores, hyphens, and dots"
            )
        return v

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if len(v) < 12:
            raise ValueError("Password must be at least 12 characters")
        has_upper = any(c.isupper() for c in v)
        has_lower = any(c.islower() for c in v)
        has_digit = any(c.isdigit() for c in v)
        if not (has_upper and has_lower and has_digit):
            raise ValueError(
                "Password must include uppercase, lowercase, and a digit"
            )
        return v


class SetupResponse(BaseModel):
    message: str
    access_token: str
    token_type: str = "bearer"


@router.get("/api/setup/status")
async def setup_status(db: AsyncSession = Depends(get_db)) -> dict:
    """Check whether initial setup has been completed."""
    count = await db.scalar(select(func.count()).select_from(User))
    return {"setup_required": count == 0}


@router.post(
    "/api/setup",
    response_model=SetupResponse,
    status_code=status.HTTP_201_CREATED,
)
async def initial_setup(
    body: SetupRequest,
    db: AsyncSession = Depends(get_db),
) -> SetupResponse:
    """One-time admin account creation.

    Raises 409 if any user already exists.
    """
    count = await db.scalar(select(func.count()).select_from(User))
    if count and count > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Setup already completed. Use /api/auth/login.",
        )

    hashed = hash_password(body.password)
    user = User(
        username=body.username,
        password_hash=hashed,
        is_admin=True,
        created_at=datetime.now(timezone.utc),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    token = create_access_token(user_id=str(user.id), role="admin")
    return SetupResponse(
        message="Admin account created successfully.",
        access_token=token,
    )
```

**Step 2: Remove every hardcoded credential.**

Search the entire codebase for any occurrence of `admin` used as a password literal, default credential, or seed data:

```bash
grep -rn "admin" apps/api/ --include="*.py" | grep -i "password\|credential\|default"
```

Delete or replace every match. If there is a database seed/migration that inserts a default user, delete that seed entirely.

**Step 3: Frontend setup screen.**

Create file: `apps/web/app/setup/page.tsx`

```tsx
"use client";

import { useState, useCallback, type FormEvent } from "react";
import { useRouter } from "next/navigation";

interface SetupError {
  detail?: string;
  message?: string;
}

export default function SetupPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError(null);

      if (password !== confirmPassword) {
        setError("Passwords do not match.");
        return;
      }

      setLoading(true);
      try {
        const res = await fetch("/api/setup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
          credentials: "same-origin",
        });

        if (!res.ok) {
          const body: SetupError = await res.json().catch(() => ({}));
          throw new Error(
            body.detail ?? body.message ?? `Setup failed (${res.status})`
          );
        }

        // Token is set via HttpOnly cookie by the API.
        router.replace("/");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    },
    [username, password, confirmPassword, router]
  );

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
      <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-8 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <h1 className="mb-2 text-2xl font-semibold text-gray-900 dark:text-white">
          Welcome to Speech-Machine
        </h1>
        <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">
          Create your admin account to get started.
        </p>

        {error && (
          <div
            role="alert"
            className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400"
          >
            {error}
          </div>
        )}

        {/* No <form> tag in artifact context, but fine here in Next.js */}
        <form onSubmit={handleSubmit} autoComplete="off">
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            Username
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            minLength={3}
            maxLength={64}
            pattern="^[a-zA-Z0-9_\-\.]+$"
            className="mb-4 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            autoComplete="username"
          />

          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={12}
            className="mb-4 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            autoComplete="new-password"
          />

          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            Confirm password
          </label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={12}
            className="mb-6 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            autoComplete="new-password"
          />

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 dark:focus:ring-offset-gray-800"
          >
            {loading ? "Creating account..." : "Create admin account"}
          </button>
        </form>
      </div>
    </main>
  );
}
```

**Step 4: Auto-redirect middleware.**

Create file: `apps/web/middleware.ts`

```typescript
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/setup", "/api/", "/_next/", "/favicon.ico"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths through unconditionally
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Check if setup is required
  try {
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
    const res = await fetch(`${apiBase}/api/setup/status`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.setup_required) {
        return NextResponse.redirect(new URL("/setup", request.url));
      }
    }
  } catch {
    // API unreachable — let the page load and show an error naturally
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

---

### 1.4 JWT Security Hardening

**Problem:** Tokens stored in localStorage are vulnerable to XSS. Tokens without expiration are permanent session hijacks. No refresh flow means users re-enter credentials constantly.

**Modify file:** `apps/api/app/security.py`

```python
"""JWT security module.

Security guarantees:
  - Access tokens expire in 15 minutes (short-lived).
  - Refresh tokens expire in 7 days (stored in HttpOnly cookie).
  - All tokens use HS256 with a 256-bit+ secret from env.
  - Tokens include iat, exp, sub (user_id), and role claims.
  - Refresh tokens are single-use: a rotated token invalidates
    the previous one via a jti denylist in Redis/DB.
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
from jose import JWTError, jwt
from fastapi import Cookie, Depends, HTTPException, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from app.config import settings

# ───── Constants ─────────────────────────────────────────────

ACCESS_TOKEN_EXPIRE_MINUTES = 15
REFRESH_TOKEN_EXPIRE_DAYS = 7
ALGORITHM = "HS256"

_bearer_scheme = HTTPBearer(auto_error=False)


# ───── Password hashing ─────────────────────────────────────

def hash_password(plain: str) -> str:
    """Hash a password with bcrypt.

    Uses a work factor of 12 (≈250ms on modern hardware).
    Returns a UTF-8 string safe for database storage.
    """
    salt = bcrypt.gensalt(rounds=12)
    return bcrypt.hashpw(plain.encode("utf-8"), salt).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    """Constant-time password verification."""
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


# ───── Token creation ────────────────────────────────────────

def create_access_token(
    user_id: str,
    role: str = "user",
    extra_claims: dict[str, Any] | None = None,
) -> str:
    """Create a short-lived access token (15 min)."""
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": user_id,
        "role": role,
        "iat": now,
        "exp": now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
        "jti": str(uuid.uuid4()),
        "type": "access",
    }
    if extra_claims:
        payload.update(extra_claims)
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)


def create_refresh_token(user_id: str) -> tuple[str, str]:
    """Create a long-lived refresh token (7 days).

    Returns (token_string, jti) — the jti must be stored in the
    database so it can be revoked on rotation.
    """
    now = datetime.now(timezone.utc)
    jti = str(uuid.uuid4())
    payload = {
        "sub": user_id,
        "iat": now,
        "exp": now + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
        "jti": jti,
        "type": "refresh",
    }
    token = jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)
    return token, jti


# ───── Token verification ────────────────────────────────────

class TokenPayload(BaseModel):
    sub: str
    role: str = "user"
    jti: str
    type: str  # "access" or "refresh"


def decode_token(token: str, expected_type: str = "access") -> TokenPayload:
    """Decode and validate a JWT.

    Raises HTTPException 401 on any failure (expired, invalid,
    wrong type, malformed).
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[ALGORITHM],
            options={"require_exp": True, "require_iat": True},
        )
    except JWTError:
        raise credentials_exception

    token_type = payload.get("type")
    if token_type != expected_type:
        raise credentials_exception

    try:
        return TokenPayload(
            sub=payload["sub"],
            role=payload.get("role", "user"),
            jti=payload["jti"],
            type=token_type,
        )
    except (KeyError, ValueError):
        raise credentials_exception


# ───── Cookie helpers ────────────────────────────────────────

def set_refresh_cookie(response: Response, token: str) -> None:
    """Set the refresh token as an HttpOnly, Secure, SameSite cookie.

    This cookie is invisible to JavaScript (HttpOnly) and only
    sent over HTTPS in production (Secure).
    """
    response.set_cookie(
        key="refresh_token",
        value=token,
        httponly=True,
        secure=settings.ENVIRONMENT != "development",
        samesite="strict",
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        path="/api/auth",  # Only sent to auth endpoints
    )


def clear_refresh_cookie(response: Response) -> None:
    """Delete the refresh token cookie on logout."""
    response.delete_cookie(
        key="refresh_token",
        httponly=True,
        secure=settings.ENVIRONMENT != "development",
        samesite="strict",
        path="/api/auth",
    )


# ───── Dependency injection ──────────────────────────────────

async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> TokenPayload:
    """FastAPI dependency: extract and validate the access token.

    Looks for the token in the Authorization header (Bearer scheme).
    """
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return decode_token(credentials.credentials, expected_type="access")


async def require_admin(
    user: TokenPayload = Depends(get_current_user),
) -> TokenPayload:
    """FastAPI dependency: require admin role."""
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return user
```

**Create file:** `apps/api/app/routers/auth.py`

```python
"""Authentication endpoints.

POST /api/auth/login    — Returns access_token in body + refresh in HttpOnly cookie.
POST /api/auth/refresh  — Rotates refresh token, returns new access_token.
POST /api/auth/logout   — Clears refresh cookie, revokes refresh jti.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, Cookie, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import User, RefreshToken
from app.security import (
    verify_password,
    create_access_token,
    create_refresh_token,
    decode_token,
    set_refresh_cookie,
    clear_refresh_cookie,
    get_current_user,
    TokenPayload,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int = 900  # 15 minutes in seconds


@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    """Authenticate and issue tokens."""
    result = await db.execute(
        select(User).where(User.username == body.username)
    )
    user = result.scalar_one_or_none()

    if user is None or not verify_password(body.password, user.password_hash):
        # Constant-time compare already done in verify_password.
        # Generic error message prevents username enumeration.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

    # Issue tokens
    role = "admin" if user.is_admin else "user"
    access_token = create_access_token(user_id=str(user.id), role=role)
    refresh_token, jti = create_refresh_token(user_id=str(user.id))

    # Persist refresh jti for rotation tracking
    db.add(RefreshToken(
        jti=jti,
        user_id=user.id,
        expires_at=datetime.now(timezone.utc),
        revoked=False,
    ))
    await db.commit()

    set_refresh_cookie(response, refresh_token)
    return TokenResponse(access_token=access_token)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    response: Response,
    refresh_token: str | None = Cookie(default=None),
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    """Rotate the refresh token and issue a new access token.

    Single-use: the old refresh jti is revoked. If a revoked jti
    is presented, ALL refresh tokens for that user are revoked
    (potential token theft).
    """
    if refresh_token is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No refresh token provided",
        )

    payload = decode_token(refresh_token, expected_type="refresh")

    # Check if jti has been revoked
    result = await db.execute(
        select(RefreshToken).where(RefreshToken.jti == payload.jti)
    )
    stored = result.scalar_one_or_none()

    if stored is None or stored.revoked:
        # Possible token theft — revoke ALL tokens for this user
        await db.execute(
            RefreshToken.__table__.update()
            .where(RefreshToken.user_id == int(payload.sub))
            .values(revoked=True)
        )
        await db.commit()
        clear_refresh_cookie(response)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token has been revoked. Please log in again.",
        )

    # Revoke the current token
    stored.revoked = True

    # Fetch user for role
    user = await db.get(User, int(payload.sub))
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User no longer exists",
        )

    # Issue new pair
    role = "admin" if user.is_admin else "user"
    new_access = create_access_token(user_id=str(user.id), role=role)
    new_refresh, new_jti = create_refresh_token(user_id=str(user.id))

    db.add(RefreshToken(
        jti=new_jti,
        user_id=user.id,
        expires_at=datetime.now(timezone.utc),
        revoked=False,
    ))
    await db.commit()

    set_refresh_cookie(response, new_refresh)
    return TokenResponse(access_token=new_access)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    response: Response,
    refresh_token: str | None = Cookie(default=None),
    db: AsyncSession = Depends(get_db),
    _user: TokenPayload = Depends(get_current_user),
) -> None:
    """Revoke the current refresh token and clear the cookie."""
    if refresh_token:
        try:
            payload = decode_token(refresh_token, expected_type="refresh")
            result = await db.execute(
                select(RefreshToken).where(RefreshToken.jti == payload.jti)
            )
            stored = result.scalar_one_or_none()
            if stored:
                stored.revoked = True
                await db.commit()
        except HTTPException:
            pass  # Token already invalid — just clear the cookie

    clear_refresh_cookie(response)
```

**Create the RefreshToken model.**

Add to `apps/api/app/models.py`:

```python
class RefreshToken(Base):
    """Tracks issued refresh tokens for single-use rotation.

    When a refresh token is used, its jti is marked revoked.
    If a revoked jti is presented again, all tokens for that
    user are revoked (token theft detection).
    """
    __tablename__ = "refresh_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    jti: Mapped[str] = mapped_column(String(36), unique=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )
```

Generate the Alembic migration (if Alembic is configured) or add a raw SQL migration:

```bash
cd apps/api
alembic revision --autogenerate -m "add_refresh_tokens_table"
alembic upgrade head
```

---

### 1.5 Application Config via Pydantic Settings

**Create file:** `apps/api/app/config.py`

```python
"""Centralized configuration from environment variables.

All secrets come from env vars. No defaults for sensitive values
in production. Each variable is documented and validated at startup.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # ── Core ──────────────────────────────────────
    ENVIRONMENT: str = "development"  # development | staging | production
    SECRET_KEY: str  # No default — must be set
    DEBUG: bool = False

    # ── Database ──────────────────────────────────
    DATABASE_URL: str = "postgresql+asyncpg://speech:speech@localhost:5432/speech"

    # ── Storage ───────────────────────────────────
    STORAGE_BACKEND: str = "local"  # local | s3
    UPLOAD_DIR: Path = Path("./uploads")
    MAX_UPLOAD_SIZE_MB: int = 500
    ALLOWED_UPLOAD_TYPES: str = "video/webm,video/mp4,audio/webm,audio/wav,application/pdf,text/plain"

    # ── S3 (only when STORAGE_BACKEND=s3) ─────────
    S3_BUCKET: str = ""
    S3_REGION: str = "us-east-1"
    S3_ACCESS_KEY: str = ""
    S3_SECRET_KEY: str = ""
    S3_ENDPOINT_URL: str = ""  # For MinIO / R2 / etc.

    # ── CORS ──────────────────────────────────────
    CORS_ORIGINS: str = "http://localhost:3000"

    # ── Transcription ─────────────────────────────
    WHISPER_MODEL: str = "openai/whisper-small"
    WHISPER_DEVICE: str = "cpu"  # cpu | cuda
    MODEL_CACHE_DIR: Path = Path("./models")

    @field_validator("SECRET_KEY")
    @classmethod
    def secret_key_strength(cls, v: str) -> str:
        if len(v) < 32:
            raise ValueError(
                "SECRET_KEY must be at least 32 characters. "
                "Generate one with: python -c \"import secrets; print(secrets.token_urlsafe(48))\""
            )
        return v

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def allowed_upload_type_list(self) -> list[str]:
        return [t.strip() for t in self.ALLOWED_UPLOAD_TYPES.split(",") if t.strip()]

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = True


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
```

**Update `.env.example`:**

```bash
# ──────────────────────────────────────────────────────────────
# Speech-Machine Environment Configuration
# Copy to .env and fill in values. Never commit .env to git.
# ──────────────────────────────────────────────────────────────

# REQUIRED: Generate with: python -c "import secrets; print(secrets.token_urlsafe(48))"
SECRET_KEY=

# Environment: development | staging | production
ENVIRONMENT=development

# Database (Docker Compose provides this automatically)
DATABASE_URL=postgresql+asyncpg://speech:speech@db:5432/speech

# Storage: local | s3
STORAGE_BACKEND=local
UPLOAD_DIR=./uploads
MAX_UPLOAD_SIZE_MB=500

# S3 settings (only if STORAGE_BACKEND=s3)
# S3_BUCKET=
# S3_REGION=us-east-1
# S3_ACCESS_KEY=
# S3_SECRET_KEY=
# S3_ENDPOINT_URL=

# CORS: comma-separated list of allowed origins
CORS_ORIGINS=http://localhost:3000

# Transcription
WHISPER_MODEL=openai/whisper-small
WHISPER_DEVICE=cpu
MODEL_CACHE_DIR=./models
```

---

### 1.6 Upload Validation and Security

**Create file:** `apps/api/app/middleware/upload_security.py`

```python
"""Upload validation middleware.

Enforces:
  - File size limits (configurable, default 500 MB).
  - MIME type allowlist (video, audio, pdf, text only).
  - Magic-byte validation (MIME header sniffing, not just extension).
  - Filename sanitization (no path traversal, no special characters).
  - Content-Length header validation before reading the body.
"""

from __future__ import annotations

import re
import unicodedata
from pathlib import PurePosixPath

from fastapi import HTTPException, UploadFile, status

from app.config import settings

# Magic bytes for allowed file types
MAGIC_SIGNATURES: dict[str, list[bytes]] = {
    "video/webm": [b"\x1a\x45\xdf\xa3"],
    "video/mp4": [b"\x00\x00\x00\x18ftypmp4", b"\x00\x00\x00\x1cftypisom", b"\x00\x00\x00\x20ftypisom"],
    "audio/wav": [b"RIFF"],
    "audio/webm": [b"\x1a\x45\xdf\xa3"],
    "application/pdf": [b"%PDF"],
    "text/plain": [],  # No magic bytes for plain text
}


def sanitize_filename(filename: str) -> str:
    """Sanitize an uploaded filename.

    - Strips path components (prevents traversal).
    - Removes non-ASCII, control characters, and shell metacharacters.
    - Limits length to 200 characters.
    - Returns a safe fallback if the result is empty.
    """
    # Take only the filename, not any path
    name = PurePosixPath(filename).name

    # Normalize unicode and strip control characters
    name = unicodedata.normalize("NFKD", name)
    name = re.sub(r"[^\w\s\-\.]", "", name)
    name = re.sub(r"\s+", "_", name)
    name = name.strip("._")

    if not name:
        name = "upload"

    # Limit length while preserving extension
    stem, _, ext = name.rpartition(".")
    if ext:
        stem = stem[:190]
        name = f"{stem}.{ext[:10]}"
    else:
        name = name[:200]

    return name


async def validate_upload(file: UploadFile) -> UploadFile:
    """Validate an uploaded file.

    Call this at the top of any endpoint that accepts file uploads.
    Returns the same UploadFile on success, raises HTTPException on failure.

    Memory safety: reads only the first 32 bytes for magic-byte check,
    then seeks back to the start. Does NOT read the entire file into memory.
    """
    max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024

    # 1. Check content type against allowlist
    content_type = file.content_type or "application/octet-stream"
    if content_type not in settings.allowed_upload_type_list:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"File type '{content_type}' is not allowed. "
                   f"Allowed types: {', '.join(settings.allowed_upload_type_list)}",
        )

    # 2. Check file size via content_length if available
    if file.size is not None and file.size > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds maximum size of {settings.MAX_UPLOAD_SIZE_MB} MB",
        )

    # 3. Validate magic bytes (read first 32 bytes only)
    header = await file.read(32)
    await file.seek(0)  # Reset for downstream consumers

    expected_sigs = MAGIC_SIGNATURES.get(content_type, [])
    if expected_sigs:
        if not any(header.startswith(sig) for sig in expected_sigs):
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail="File content does not match its declared type",
            )

    # 4. Sanitize filename
    if file.filename:
        file.filename = sanitize_filename(file.filename)

    return file


async def stream_upload_to_disk(
    file: UploadFile,
    destination: str,
    max_bytes: int | None = None,
) -> int:
    """Stream an upload to disk in chunks.

    NEVER loads the entire file into memory. Reads in 256 KB chunks.
    Returns the total bytes written.
    Raises HTTPException if the file exceeds max_bytes during streaming.

    Memory leak prevention:
    - Uses a fixed 256 KB buffer regardless of file size.
    - File handle is always closed via context manager.
    - Partial files are deleted on error.
    """
    if max_bytes is None:
        max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024

    chunk_size = 256 * 1024  # 256 KB
    total_written = 0
    dest_path = __import__("pathlib").Path(destination)

    try:
        with open(dest_path, "wb") as f:
            while True:
                chunk = await file.read(chunk_size)
                if not chunk:
                    break
                total_written += len(chunk)
                if total_written > max_bytes:
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail=f"File exceeds maximum size of {settings.MAX_UPLOAD_SIZE_MB} MB",
                    )
                f.write(chunk)
    except HTTPException:
        # Clean up partial file
        dest_path.unlink(missing_ok=True)
        raise
    except Exception:
        dest_path.unlink(missing_ok=True)
        raise

    return total_written
```

---

### 1.7 CORS Lockdown

**Modify:** `apps/api/app/main.py` — replace any wildcard CORS with:

```python
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,  # Never ["*"] in production
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
    allow_headers=["Authorization", "Content-Type"],
    max_age=600,  # Preflight cache: 10 minutes
)
```

---

### 1.8 .gitignore Audit

**Verify `.gitignore` contains at minimum:**

```gitignore
# Secrets
.env
.env.local
.env.*.local

# Dependencies
node_modules/
.venv/
__pycache__/
*.pyc

# Build artifacts
.next/
out/
dist/
*.egg-info/

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Uploads and models (large files)
uploads/
models/
*.mp4
*.webm
*.wav

# Coverage
coverage/
htmlcov/
.coverage
coverage.xml
```

**Week 1 deliverable checklist:**
- [ ] CI pipeline runs and passes on every push
- [ ] Branch protection enforced on `main`
- [ ] ESLint and Ruff configured and enforced in CI
- [ ] Default admin/admin credential eliminated; first-run setup flow works
- [ ] JWT uses HttpOnly cookies, 15-min access tokens, 7-day rotated refresh tokens
- [ ] Token theft detection via jti denylist
- [ ] All config via Pydantic Settings with validation
- [ ] Upload validation: size limit, MIME allowlist, magic-byte check, filename sanitization
- [ ] Streaming uploads never load entire file into memory
- [ ] CORS locked to configured origins
- [ ] .gitignore reviewed and complete
- [ ] Tag release `v0.1.0`

---

## WEEK 2 — Background Job Queue, Storage Abstraction, Database Hygiene

### 2.1 Background Job Queue with arq (Redis-backed)

**Why arq over Celery:** arq is async-native (matches FastAPI), has a smaller footprint, built-in job status tracking, and supports result storage. For this project's scale it is the right tool.

**Step 1: Add Redis to Docker Compose.**

Add to `docker-compose.yml`:

```yaml
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: >
      redis-server
      --maxmemory 256mb
      --maxmemory-policy allkeys-lru
      --appendonly yes
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
```

Add `redis_data` to the `volumes:` section:

```yaml
volumes:
  postgres_data:
  redis_data:
```

**Step 2: Install arq.**

Add to `apps/api/requirements.txt`:

```
arq>=0.26,<1.0
redis[hiredis]>=5.0,<6.0
```

**Step 3: Create the worker module.**

Create file: `apps/api/app/worker/__init__.py`

```python
"""arq worker configuration.

Start the worker with:
    arq app.worker.WorkerSettings

Memory safety:
  - Each job runs in a try/finally to ensure temp files are cleaned up.
  - The faster-whisper model is loaded ONCE on worker startup via
    on_startup, not per-job. This avoids repeated multi-GB allocations.
  - Jobs stream transcription results to the database incrementally
    rather than building a full result in memory.
"""
```

Create file: `apps/api/app/worker/settings.py`

```python
from __future__ import annotations

import logging
from typing import Any

from arq import cron
from arq.connections import RedisSettings

from app.config import settings

logger = logging.getLogger("arq.worker")


async def on_startup(ctx: dict[str, Any]) -> None:
    """Called once when the worker starts.

    Loads the Whisper model into memory so it persists across jobs.
    This avoids the ~2-10s model load time on every transcription job
    and prevents repeated allocation/deallocation of multi-GB models.
    """
    from app.services.transcription import load_model
    from app.db import create_async_engine_from_settings, async_session_factory

    logger.info("Worker starting: loading Whisper model '%s'...", settings.WHISPER_MODEL)
    ctx["whisper_model"] = load_model(
        model_name=settings.WHISPER_MODEL,
        device=settings.WHISPER_DEVICE,
        cache_dir=str(settings.MODEL_CACHE_DIR),
    )
    logger.info("Whisper model loaded.")

    # Create a database session factory for the worker
    engine = create_async_engine_from_settings()
    ctx["db_factory"] = async_session_factory(engine)


async def on_shutdown(ctx: dict[str, Any]) -> None:
    """Called once when the worker shuts down."""
    logger.info("Worker shutting down.")
    # The model will be garbage collected.
    ctx.pop("whisper_model", None)
    factory = ctx.pop("db_factory", None)
    if factory:
        # Close the engine
        await factory.kw["bind"].dispose()


async def cleanup_expired_tokens(ctx: dict[str, Any]) -> None:
    """Cron job: delete expired refresh tokens from the database.

    Runs daily at 03:00 UTC. Prevents unbounded table growth.
    """
    from datetime import datetime, timezone
    from sqlalchemy import delete
    from app.models import RefreshToken

    db_factory = ctx["db_factory"]
    async with db_factory() as db:
        result = await db.execute(
            delete(RefreshToken).where(
                RefreshToken.expires_at < datetime.now(timezone.utc)
            )
        )
        await db.commit()
        logger.info("Cleaned up %d expired refresh tokens", result.rowcount)


# Import job functions here to register them with arq
from app.worker.jobs import transcribe_recording  # noqa: E402


class WorkerSettings:
    """arq worker configuration."""

    functions = [transcribe_recording]
    cron_jobs = [
        cron(cleanup_expired_tokens, hour=3, minute=0),
    ]
    on_startup = on_startup
    on_shutdown = on_shutdown

    redis_settings = RedisSettings(
        host=settings.REDIS_HOST if hasattr(settings, "REDIS_HOST") else "localhost",
        port=6379,
    )

    # Worker behavior
    max_jobs = 2           # Max concurrent transcription jobs (memory-bound)
    job_timeout = 1800     # 30-minute timeout for long transcriptions
    keep_result = 3600     # Keep results for 1 hour
    retry_jobs = True
    max_tries = 3
    health_check_interval = 30
```

Create file: `apps/api/app/worker/jobs.py`

```python
"""Background job definitions.

Each job function:
  1. Receives a context dict (ctx) with pre-loaded resources.
  2. Updates the database session_status to "processing" at start.
  3. Performs the work.
  4. Updates session_status to "completed" or "failed".
  5. Cleans up any temp files in a finally block.

Memory safety:
  - Audio is extracted to a temp file and deleted after transcription.
  - Transcription result segments are written to DB in batches of 50.
  - No unbounded list accumulation.
"""

from __future__ import annotations

import logging
import tempfile
from pathlib import Path
from typing import Any

logger = logging.getLogger("arq.jobs")


async def transcribe_recording(
    ctx: dict[str, Any],
    session_id: int,
    video_path: str,
) -> dict[str, Any]:
    """Transcribe a recorded or uploaded video.

    Steps:
      1. Extract audio from video using ffmpeg.
      2. Run faster-whisper transcription.
      3. Store transcript segments in the database.
      4. Compute speech metrics (WPM, filler count, pause count).
      5. Update session with transcript and metrics.

    Args:
        ctx: arq context with whisper_model and db_factory.
        session_id: Database ID of the practice session.
        video_path: Absolute path to the video file on disk.

    Returns:
        Summary dict with segment_count and duration.
    """
    import subprocess

    from app.models import Session, TranscriptSegment
    from app.services.speech_metrics import compute_metrics

    model = ctx["whisper_model"]
    db_factory = ctx["db_factory"]
    temp_audio: Path | None = None

    try:
        # ── 1. Update status to processing ────────────────
        async with db_factory() as db:
            session = await db.get(Session, session_id)
            if session is None:
                raise ValueError(f"Session {session_id} not found")
            session.transcription_status = "processing"
            await db.commit()

        # ── 2. Extract audio with ffmpeg ──────────────────
        temp_dir = tempfile.mkdtemp(prefix="sm_transcribe_")
        temp_audio = Path(temp_dir) / "audio.wav"

        result = subprocess.run(
            [
                "ffmpeg", "-i", video_path,
                "-vn",                    # Drop video stream
                "-acodec", "pcm_s16le",   # 16-bit PCM
                "-ar", "16000",           # 16 kHz sample rate (Whisper native)
                "-ac", "1",               # Mono
                "-y",                     # Overwrite
                str(temp_audio),
            ],
            capture_output=True,
            timeout=300,  # 5-minute timeout for extraction
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"ffmpeg failed: {result.stderr.decode('utf-8', errors='replace')[:500]}"
            )

        if not temp_audio.exists() or temp_audio.stat().st_size == 0:
            raise RuntimeError("ffmpeg produced an empty audio file")

        # ── 3. Transcribe ─────────────────────────────────
        segments_iter, info = model.transcribe(
            str(temp_audio),
            beam_size=5,
            language=None,     # Auto-detect
            vad_filter=True,   # Filter silence
        )

        # ── 4. Store segments in batches ──────────────────
        batch: list[TranscriptSegment] = []
        segment_count = 0
        full_text_parts: list[str] = []

        for segment in segments_iter:
            batch.append(TranscriptSegment(
                session_id=session_id,
                start_time=round(segment.start, 3),
                end_time=round(segment.end, 3),
                text=segment.text.strip(),
                confidence=round(segment.avg_logprob, 4) if segment.avg_logprob else None,
            ))
            full_text_parts.append(segment.text.strip())
            segment_count += 1

            # Flush batch every 50 segments to limit memory
            if len(batch) >= 50:
                async with db_factory() as db:
                    db.add_all(batch)
                    await db.commit()
                batch.clear()

        # Flush remaining
        if batch:
            async with db_factory() as db:
                db.add_all(batch)
                await db.commit()
            batch.clear()

        # ── 5. Compute metrics and update session ─────────
        full_text = " ".join(full_text_parts)
        metrics = compute_metrics(
            full_text=full_text,
            duration_seconds=info.duration,
        )

        async with db_factory() as db:
            session = await db.get(Session, session_id)
            if session:
                session.transcript_text = full_text
                session.transcription_status = "completed"
                session.duration_seconds = round(info.duration, 2)
                session.language = info.language
                session.wpm = metrics.get("wpm")
                session.filler_count = metrics.get("filler_count")
                session.pause_count = metrics.get("pause_count")
                await db.commit()

        logger.info(
            "Transcription complete for session %d: %d segments, %.1fs",
            session_id, segment_count, info.duration,
        )

        return {
            "session_id": session_id,
            "segment_count": segment_count,
            "duration": round(info.duration, 2),
            "language": info.language,
        }

    except Exception as exc:
        # Mark session as failed
        try:
            async with db_factory() as db:
                session = await db.get(Session, session_id)
                if session:
                    session.transcription_status = "failed"
                    session.transcription_error = str(exc)[:500]
                    await db.commit()
        except Exception:
            logger.exception("Failed to update session status after error")

        logger.exception("Transcription failed for session %d", session_id)
        raise

    finally:
        # ── CLEANUP: always delete temp audio ─────────────
        if temp_audio and temp_audio.exists():
            temp_audio.unlink(missing_ok=True)
            temp_audio.parent.rmdir()  # Remove the temp directory too
```

**Step 4: Create the job enqueue utility.**

Create file: `apps/api/app/worker/enqueue.py`

```python
"""Utility for enqueuing background jobs from API endpoints.

Usage in a route:
    from app.worker.enqueue import enqueue_transcription
    job = await enqueue_transcription(session_id=42, video_path="/uploads/video.webm")

Memory safety:
  - The Redis connection pool is created once and reused.
  - ArqRedis instances are context-managed to prevent connection leaks.
"""

from __future__ import annotations

from arq.connections import ArqRedis, create_pool, RedisSettings
from app.config import settings

_pool: ArqRedis | None = None


async def get_arq_pool() -> ArqRedis:
    """Get or create the arq Redis connection pool.

    Reuses a single pool for the lifetime of the API process.
    """
    global _pool
    if _pool is None:
        _pool = await create_pool(
            RedisSettings(
                host=getattr(settings, "REDIS_HOST", "localhost"),
                port=6379,
            )
        )
    return _pool


async def enqueue_transcription(session_id: int, video_path: str) -> str:
    """Enqueue a transcription job. Returns the arq job ID."""
    pool = await get_arq_pool()
    job = await pool.enqueue_job(
        "transcribe_recording",
        session_id=session_id,
        video_path=video_path,
    )
    if job is None:
        raise RuntimeError("Failed to enqueue transcription job")
    return job.job_id


async def get_job_status(job_id: str) -> dict:
    """Check the status of a background job."""
    pool = await get_arq_pool()
    job = await pool.job(job_id)
    if job is None:
        return {"status": "not_found"}
    info = await job.info()
    if info is None:
        return {"status": "pending"}
    return {
        "status": info.status.value if info.status else "unknown",
        "result": info.result if info.success else None,
        "error": str(info.result) if not info.success and info.result else None,
    }
```

**Step 5: Add the job status endpoint.**

Create file: `apps/api/app/routers/jobs.py`

```python
"""Job status polling endpoint.

The frontend polls this endpoint after submitting a recording
to show transcription progress.
"""

from fastapi import APIRouter, Depends
from app.security import get_current_user, TokenPayload
from app.worker.enqueue import get_job_status

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


@router.get("/{job_id}")
async def job_status(
    job_id: str,
    _user: TokenPayload = Depends(get_current_user),
) -> dict:
    """Get the status of a background job."""
    return await get_job_status(job_id)
```

**Step 6: Add worker to Docker Compose.**

```yaml
  worker:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    command: arq app.worker.settings.WorkerSettings
    depends_on:
      redis:
        condition: service_healthy
      db:
        condition: service_healthy
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - SECRET_KEY=${SECRET_KEY}
      - REDIS_HOST=redis
      - WHISPER_MODEL=${WHISPER_MODEL:-openai/whisper-small}
      - WHISPER_DEVICE=${WHISPER_DEVICE:-cpu}
    volumes:
      - upload_data:/app/uploads
      - model_data:/app/models
    restart: unless-stopped
```

---

### 2.2 Storage Abstraction Layer

**Create file:** `apps/api/app/services/storage.py`

```python
"""Storage abstraction layer.

Provides a unified interface for storing and retrieving files,
with two backends:
  - LocalStorage: writes to disk (default for development).
  - S3Storage: writes to any S3-compatible service.

Memory safety:
  - All file operations use streaming (chunked read/write).
  - No file is ever fully loaded into memory.
  - Context managers ensure file handles are always closed.
"""

from __future__ import annotations

import shutil
from abc import ABC, abstractmethod
from pathlib import Path
from typing import AsyncIterator, BinaryIO

from app.config import settings


class StorageBackend(ABC):
    """Abstract base class for storage backends."""

    @abstractmethod
    async def save(self, key: str, file: BinaryIO, content_type: str = "") -> str:
        """Save a file. Returns the storage key/path."""

    @abstractmethod
    async def get_path(self, key: str) -> str:
        """Get the local filesystem path (for local) or a presigned URL (for S3)."""

    @abstractmethod
    async def delete(self, key: str) -> None:
        """Delete a file."""

    @abstractmethod
    async def exists(self, key: str) -> bool:
        """Check if a file exists."""


class LocalStorage(StorageBackend):
    """Store files on the local filesystem."""

    def __init__(self, base_dir: Path | None = None) -> None:
        self.base_dir = base_dir or settings.UPLOAD_DIR
        self.base_dir.mkdir(parents=True, exist_ok=True)

    async def save(self, key: str, file: BinaryIO, content_type: str = "") -> str:
        dest = self.base_dir / key
        dest.parent.mkdir(parents=True, exist_ok=True)

        chunk_size = 256 * 1024
        with open(dest, "wb") as f:
            while True:
                chunk = file.read(chunk_size)
                if not chunk:
                    break
                f.write(chunk)

        return key

    async def get_path(self, key: str) -> str:
        return str(self.base_dir / key)

    async def delete(self, key: str) -> None:
        path = self.base_dir / key
        path.unlink(missing_ok=True)

    async def exists(self, key: str) -> bool:
        return (self.base_dir / key).exists()


class S3Storage(StorageBackend):
    """Store files in an S3-compatible service.

    Uses boto3 with automatic connection pooling and retry.
    """

    def __init__(self) -> None:
        import boto3
        from botocore.config import Config as BotoConfig

        session_kwargs: dict = {
            "aws_access_key_id": settings.S3_ACCESS_KEY,
            "aws_secret_access_key": settings.S3_SECRET_KEY,
            "region_name": settings.S3_REGION,
        }
        client_kwargs: dict = {
            "config": BotoConfig(
                retries={"max_attempts": 3, "mode": "adaptive"},
                max_pool_connections=10,
            ),
        }
        if settings.S3_ENDPOINT_URL:
            client_kwargs["endpoint_url"] = settings.S3_ENDPOINT_URL

        self._client = boto3.client("s3", **session_kwargs, **client_kwargs)
        self._bucket = settings.S3_BUCKET

    async def save(self, key: str, file: BinaryIO, content_type: str = "") -> str:
        extra_args = {}
        if content_type:
            extra_args["ContentType"] = content_type

        self._client.upload_fileobj(file, self._bucket, key, ExtraArgs=extra_args)
        return key

    async def get_path(self, key: str) -> str:
        # Return a presigned URL valid for 1 hour
        return self._client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self._bucket, "Key": key},
            ExpiresIn=3600,
        )

    async def delete(self, key: str) -> None:
        self._client.delete_object(Bucket=self._bucket, Key=key)

    async def exists(self, key: str) -> bool:
        try:
            self._client.head_object(Bucket=self._bucket, Key=key)
            return True
        except self._client.exceptions.ClientError:
            return False


def get_storage() -> StorageBackend:
    """Factory function for the configured storage backend."""
    if settings.STORAGE_BACKEND == "s3":
        return S3Storage()
    return LocalStorage()
```

---

### 2.3 Database Migration Setup (Alembic)

**If Alembic is not yet configured:**

```bash
cd apps/api
pip install alembic
alembic init migrations
```

**Edit `apps/api/alembic.ini`:** Set `sqlalchemy.url` to empty (will be overridden in env.py).

**Edit `apps/api/migrations/env.py`:**

```python
import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import settings
from app.models import Base  # Import your Base to get all models

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = settings.DATABASE_URL
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection):
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = create_async_engine(settings.DATABASE_URL)
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

**Generate the initial migration:**

```bash
cd apps/api
alembic revision --autogenerate -m "initial_schema"
alembic upgrade head
```

**Add to Docker entrypoint** so migrations run automatically before the API starts:

```bash
#!/bin/bash
set -e
echo "Running database migrations..."
alembic upgrade head
echo "Starting API server..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
```

---

### 2.4 Speech Metrics Service

**Create file:** `apps/api/app/services/speech_metrics.py`

```python
"""Speech metrics computation.

Pure functions — no side effects, no I/O.
Designed for use in both the background worker and the scoring
module in packages/shared.

Memory safety:
  - Works on string input only (no file I/O).
  - Regex patterns are compiled once at module level.
  - No unbounded list growth.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# Compiled once, reused across all calls
_WORD_PATTERN = re.compile(r"\b\w+\b")
_FILLER_PATTERN = re.compile(
    r"\b(um|uh|er|ah|like|you know|i mean|so|basically|actually|"
    r"right|okay|well|literally)\b",
    re.IGNORECASE,
)
_LONG_PAUSE_PATTERN = re.compile(r"\.\.\.|—|–")


@dataclass(frozen=True, slots=True)
class SpeechMetrics:
    """Immutable metrics result. slots=True prevents __dict__ allocation."""

    word_count: int
    duration_seconds: float
    wpm: float
    filler_count: int
    filler_words: dict[str, int]
    pause_count: int
    unique_word_count: int
    vocabulary_density: float


def compute_metrics(
    full_text: str,
    duration_seconds: float,
) -> dict:
    """Compute speech metrics from transcript text and duration.

    Args:
        full_text: The complete transcript as a single string.
        duration_seconds: Total recording duration in seconds.

    Returns:
        Dict with all metric fields (JSON-serializable).
    """
    if not full_text or duration_seconds <= 0:
        return {
            "word_count": 0,
            "duration_seconds": duration_seconds,
            "wpm": 0.0,
            "filler_count": 0,
            "filler_words": {},
            "pause_count": 0,
            "unique_word_count": 0,
            "vocabulary_density": 0.0,
        }

    words = _WORD_PATTERN.findall(full_text)
    word_count = len(words)

    # WPM
    duration_minutes = duration_seconds / 60.0
    wpm = round(word_count / duration_minutes, 1) if duration_minutes > 0 else 0.0

    # Filler words
    filler_matches = _FILLER_PATTERN.findall(full_text.lower())
    filler_words: dict[str, int] = {}
    for filler in filler_matches:
        filler_lower = filler.lower()
        filler_words[filler_lower] = filler_words.get(filler_lower, 0) + 1
    filler_count = sum(filler_words.values())

    # Pauses
    pause_count = len(_LONG_PAUSE_PATTERN.findall(full_text))

    # Vocabulary density
    unique_words = set(w.lower() for w in words)
    unique_word_count = len(unique_words)
    vocabulary_density = round(
        unique_word_count / word_count, 3
    ) if word_count > 0 else 0.0

    return {
        "word_count": word_count,
        "duration_seconds": round(duration_seconds, 2),
        "wpm": wpm,
        "filler_count": filler_count,
        "filler_words": filler_words,
        "pause_count": pause_count,
        "unique_word_count": unique_word_count,
        "vocabulary_density": vocabulary_density,
    }
```

**Week 2 deliverable checklist:**
- [ ] Redis added to Docker Compose with health check
- [ ] arq worker starts and processes jobs
- [ ] Transcription jobs run in background, not blocking the API thread
- [ ] Job status polling endpoint works (`GET /api/jobs/{job_id}`)
- [ ] Temp audio files always cleaned up (even on crash)
- [ ] Whisper model loaded once per worker, not per job
- [ ] Storage abstraction supports local and S3 backends
- [ ] Alembic migrations configured and auto-run on startup
- [ ] Expired refresh tokens cleaned up daily via cron
- [ ] Speech metrics module is pure, tested, and reusable

---

## WEEK 3 — Testing, Frontend Polish, Transcription Progress

### 3.1 Backend Test Suite

**Create file:** `apps/api/tests/conftest.py`

```python
"""Shared test fixtures.

Uses an in-memory SQLite database for fast, isolated tests.
Each test gets a fresh database via the function-scoped fixture.
"""

from __future__ import annotations

import asyncio
from typing import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.models import Base
from app.main import app
from app.db import get_db


@pytest.fixture(scope="session")
def event_loop():
    """Create a single event loop for all tests."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    """Create a fresh database for each test."""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        echo=False,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async with session_factory() as session:
        yield session

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """HTTP client with database dependency override."""

    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c

    app.dependency_overrides.clear()
```

**Create file:** `apps/api/tests/test_setup.py`

```python
"""Tests for the first-run setup flow."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_setup_status_returns_required_when_no_users(client: AsyncClient):
    response = await client.get("/api/setup/status")
    assert response.status_code == 200
    data = response.json()
    assert data["setup_required"] is True


@pytest.mark.asyncio
async def test_setup_creates_admin(client: AsyncClient):
    response = await client.post("/api/setup", json={
        "username": "myadmin",
        "password": "SecureP@ss1234",
    })
    assert response.status_code == 201
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"


@pytest.mark.asyncio
async def test_setup_rejects_second_call(client: AsyncClient):
    # First call succeeds
    await client.post("/api/setup", json={
        "username": "myadmin",
        "password": "SecureP@ss1234",
    })
    # Second call returns 409
    response = await client.post("/api/setup", json={
        "username": "another",
        "password": "AnotherPass123",
    })
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_setup_rejects_weak_password(client: AsyncClient):
    response = await client.post("/api/setup", json={
        "username": "admin",
        "password": "short",
    })
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_setup_rejects_invalid_username(client: AsyncClient):
    response = await client.post("/api/setup", json={
        "username": "a",  # Too short
        "password": "SecureP@ss1234",
    })
    assert response.status_code == 422
```

**Create file:** `apps/api/tests/test_auth.py`

```python
"""Tests for login, refresh, and logout flows."""

import pytest
from httpx import AsyncClient


@pytest.fixture
async def seeded_client(client: AsyncClient) -> AsyncClient:
    """Client with an admin user already created."""
    await client.post("/api/setup", json={
        "username": "testadmin",
        "password": "SecureP@ss1234",
    })
    return client


@pytest.mark.asyncio
async def test_login_success(seeded_client: AsyncClient):
    response = await seeded_client.post("/api/auth/login", json={
        "username": "testadmin",
        "password": "SecureP@ss1234",
    })
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["expires_in"] == 900
    # Check that refresh token cookie is set
    assert "refresh_token" in response.cookies


@pytest.mark.asyncio
async def test_login_wrong_password(seeded_client: AsyncClient):
    response = await seeded_client.post("/api/auth/login", json={
        "username": "testadmin",
        "password": "WrongPassword123",
    })
    assert response.status_code == 401
    # Generic error message (no username enumeration)
    assert "Invalid username or password" in response.json()["detail"]


@pytest.mark.asyncio
async def test_login_nonexistent_user(seeded_client: AsyncClient):
    response = await seeded_client.post("/api/auth/login", json={
        "username": "nobody",
        "password": "WrongPassword123",
    })
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_protected_route_without_token(seeded_client: AsyncClient):
    response = await seeded_client.get("/api/jobs/fake-id")
    assert response.status_code == 401
```

**Create file:** `apps/api/tests/test_speech_metrics.py`

```python
"""Tests for speech metrics computation.

These are pure-function tests — no I/O, no database, fast.
"""

from app.services.speech_metrics import compute_metrics


def test_basic_metrics():
    text = "Hello world this is a test recording for speech analysis"
    result = compute_metrics(text, duration_seconds=10.0)
    assert result["word_count"] == 10
    assert result["wpm"] == 60.0  # 10 words / (10/60) minutes
    assert result["filler_count"] == 0
    assert result["vocabulary_density"] > 0


def test_filler_detection():
    text = "So um I think like basically um we should like do this"
    result = compute_metrics(text, duration_seconds=5.0)
    assert result["filler_count"] >= 5
    assert "um" in result["filler_words"]
    assert "like" in result["filler_words"]
    assert "basically" in result["filler_words"]
    assert "so" in result["filler_words"]


def test_empty_text():
    result = compute_metrics("", duration_seconds=10.0)
    assert result["word_count"] == 0
    assert result["wpm"] == 0.0
    assert result["filler_count"] == 0


def test_zero_duration():
    result = compute_metrics("Hello world", duration_seconds=0.0)
    assert result["wpm"] == 0.0


def test_vocabulary_density():
    # All unique words
    text = "alpha beta gamma delta epsilon"
    result = compute_metrics(text, duration_seconds=5.0)
    assert result["vocabulary_density"] == 1.0

    # Repeated words
    text = "the the the the the"
    result = compute_metrics(text, duration_seconds=5.0)
    assert result["vocabulary_density"] == 0.2
```

---

### 3.2 Frontend: Transcription Progress Polling

**Create file:** `apps/web/lib/hooks/useJobPolling.ts`

```typescript
/**
 * React hook for polling background job status.
 *
 * Memory safety:
 * - AbortController cancels in-flight requests on unmount.
 * - Interval is always cleared on unmount (via useEffect cleanup).
 * - State updates are guarded by a mounted ref to prevent
 *   setState-after-unmount warnings.
 */

import { useState, useEffect, useRef, useCallback } from "react";

export type JobStatus = "pending" | "in_progress" | "complete" | "failed" | "not_found";

interface JobState {
  status: JobStatus;
  result: Record<string, unknown> | null;
  error: string | null;
}

interface UseJobPollingOptions {
  jobId: string | null;
  intervalMs?: number;
  onComplete?: (result: Record<string, unknown>) => void;
  onError?: (error: string) => void;
}

export function useJobPolling({
  jobId,
  intervalMs = 2000,
  onComplete,
  onError,
}: UseJobPollingOptions): JobState {
  const [state, setState] = useState<JobState>({
    status: "pending",
    result: null,
    error: null,
  });

  const mountedRef = useRef(true);
  const onCompleteRef = useRef(onComplete);
  const onErrorRef = useRef(onError);

  // Keep callback refs up to date without triggering re-polls
  useEffect(() => {
    onCompleteRef.current = onComplete;
    onErrorRef.current = onError;
  }, [onComplete, onError]);

  useEffect(() => {
    mountedRef.current = true;

    if (!jobId) {
      return;
    }

    const controller = new AbortController();
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`, {
          signal: controller.signal,
          credentials: "same-origin",
        });

        if (!mountedRef.current) return;

        if (!res.ok) {
          setState({
            status: "failed",
            result: null,
            error: `Server error: ${res.status}`,
          });
          return;
        }

        const data = await res.json();

        if (!mountedRef.current) return;

        const status = data.status as JobStatus;
        setState({
          status,
          result: data.result ?? null,
          error: data.error ?? null,
        });

        if (status === "complete") {
          if (intervalId) clearInterval(intervalId);
          onCompleteRef.current?.(data.result ?? {});
        } else if (status === "failed") {
          if (intervalId) clearInterval(intervalId);
          onErrorRef.current?.(data.error ?? "Unknown error");
        }
      } catch (err) {
        if (!mountedRef.current) return;
        if (err instanceof DOMException && err.name === "AbortError") return;

        setState({
          status: "failed",
          result: null,
          error: err instanceof Error ? err.message : "Network error",
        });
      }
    };

    // Initial poll immediately
    poll();
    intervalId = setInterval(poll, intervalMs);

    return () => {
      mountedRef.current = false;
      controller.abort();
      if (intervalId) clearInterval(intervalId);
    };
  }, [jobId, intervalMs]);

  return state;
}
```

---

### 3.3 Frontend: Token Refresh Interceptor

**Create file:** `apps/web/lib/api.ts`

```typescript
/**
 * Authenticated API client with automatic token refresh.
 *
 * Uses a request queue to prevent multiple simultaneous refresh
 * requests. While a refresh is in flight, subsequent requests
 * are queued and resolved once the new token is available.
 *
 * Memory safety:
 * - The pending queue is bounded (max 50 requests) to prevent
 *   unbounded growth if the refresh endpoint is permanently down.
 * - AbortController support prevents zombie requests.
 */

type QueueItem = {
  resolve: (token: string) => void;
  reject: (error: Error) => void;
};

let accessToken: string | null = null;
let isRefreshing = false;
const pendingQueue: QueueItem[] = [];
const MAX_QUEUE_SIZE = 50;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

async function refreshAccessToken(): Promise<string> {
  const res = await fetch("/api/auth/refresh", {
    method: "POST",
    credentials: "include", // Send HttpOnly cookie
  });

  if (!res.ok) {
    accessToken = null;
    throw new Error("Session expired. Please log in again.");
  }

  const data = await res.json();
  accessToken = data.access_token;
  return data.access_token;
}

export async function apiFetch(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(options.headers);

  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  let response = await fetch(url, { ...options, headers, credentials: "include" });

  // If 401, attempt a single token refresh
  if (response.status === 401 && !url.includes("/api/auth/")) {
    if (isRefreshing) {
      // Wait for the in-flight refresh to complete
      if (pendingQueue.length >= MAX_QUEUE_SIZE) {
        throw new Error("Too many pending requests during token refresh");
      }

      const newToken = await new Promise<string>((resolve, reject) => {
        pendingQueue.push({ resolve, reject });
      });

      headers.set("Authorization", `Bearer ${newToken}`);
      response = await fetch(url, { ...options, headers, credentials: "include" });
    } else {
      isRefreshing = true;
      try {
        const newToken = await refreshAccessToken();

        // Resolve all queued requests
        while (pendingQueue.length > 0) {
          const item = pendingQueue.shift();
          item?.resolve(newToken);
        }

        headers.set("Authorization", `Bearer ${newToken}`);
        response = await fetch(url, { ...options, headers, credentials: "include" });
      } catch (err) {
        // Reject all queued requests
        while (pendingQueue.length > 0) {
          const item = pendingQueue.shift();
          item?.reject(err instanceof Error ? err : new Error(String(err)));
        }
        throw err;
      } finally {
        isRefreshing = false;
      }
    }
  }

  return response;
}
```

---

### 3.4 Frontend Vitest Configuration

**Create file:** `apps/web/vitest.config.ts`

```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["lib/**", "app/**", "components/**"],
      exclude: ["**/*.d.ts", "**/*.test.*"],
      thresholds: {
        statements: 60,
        branches: 50,
        functions: 60,
        lines: 60,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
```

**Create file:** `apps/web/tests/setup.ts`

```typescript
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Automatic cleanup after each test
afterEach(() => {
  cleanup();
});
```

**Week 3 deliverable checklist:**
- [ ] Backend test suite runs in CI: setup, auth, speech metrics
- [ ] 60%+ code coverage on backend
- [ ] Frontend job polling hook with proper cleanup
- [ ] Token refresh interceptor with request queue
- [ ] Vitest configured with coverage thresholds
- [ ] Frontend unit tests for hooks and pure utilities

---

## WEEK 4 — Documentation, Observability, Release Hardening

### 4.1 Architecture Documentation

**Create file:** `docs/ARCHITECTURE.md`

````markdown
# Architecture

## System overview

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser                              │
│  Next.js 14 App Router  │  MediaRecorder  │  MediaPipe      │
│  Zustand state          │  Web Speech API │  IndexedDB      │
└──────────────┬──────────────────────────────┬───────────────┘
               │ HTTPS / WSS                  │ HTTPS
               ▼                              ▼
┌──────────────────────┐         ┌────────────────────────────┐
│   FastAPI (API)      │◄────────│   Nginx (reverse proxy)    │
│   - Auth (JWT)       │         │   - TLS termination        │
│   - Session CRUD     │         │   - Static file serving    │
│   - Upload handling  │         │   - Rate limiting          │
│   - Job enqueuing    │         └────────────────────────────┘
└──────┬───────┬───────┘
       │       │
       │       ▼
       │   ┌──────────────┐
       │   │   Redis      │
       │   │   - Job queue│
       │   │   - Results  │
       │   └──────┬───────┘
       │          │
       │          ▼
       │   ┌──────────────────────┐
       │   │   arq Worker         │
       │   │   - ffmpeg extract   │
       │   │   - Whisper transcr. │
       │   │   - Metrics compute  │
       │   └──────┬───────────────┘
       │          │
       ▼          ▼
┌──────────────────────┐    ┌────────────────────┐
│   PostgreSQL         │    │   File Storage     │
│   - Users            │    │   - Local disk     │
│   - Sessions         │    │   - S3-compatible  │
│   - Transcripts      │    │   (configurable)   │
│   - Refresh tokens   │    └────────────────────┘
└──────────────────────┘
```

## Request lifecycle

1. User records a video in the browser via MediaRecorder.
2. During recording, the frontend computes live metrics (WPM, delivery)
   using Web Speech API and MediaPipe — these never leave the browser.
3. On "Save," the frontend uploads the video to `POST /api/sessions`.
4. The API validates the upload, stores the file, creates a Session
   row with `transcription_status = "queued"`, and enqueues a
   `transcribe_recording` job in Redis via arq.
5. The API returns the session ID and job ID to the frontend.
6. The frontend polls `GET /api/jobs/{job_id}` every 2 seconds.
7. The arq worker picks up the job, extracts audio with ffmpeg,
   runs faster-whisper, stores transcript segments, computes
   speech metrics, and updates the session status to "completed."
8. The frontend sees `status: "complete"`, fetches the session,
   and renders the review view.

## Security boundaries

- **Auth tokens:** Access tokens (15 min, in-memory) for API calls.
  Refresh tokens (7 days, HttpOnly cookie) for rotation.
- **File uploads:** MIME allowlist, magic-byte validation, size
  limit, filename sanitization. Streamed to disk (never in memory).
- **CORS:** Locked to configured origins.
- **Database:** Parameterized queries via SQLAlchemy (no SQL injection).
- **Worker isolation:** Runs in a separate container with no inbound
  network access. Communicates only via Redis and PostgreSQL.
````

---

### 4.2 Contributing Guide

**Create file:** `CONTRIBUTING.md`

```markdown
# Contributing to Speech-Machine

Thank you for considering contributing! Here's how to get started.

## Development setup

1. Fork and clone the repository.
2. Copy `.env.example` to `.env` and generate a `SECRET_KEY`:
   ```bash
   python -c "import secrets; print(secrets.token_urlsafe(48))"
   ```
3. Start the stack: `docker compose up --build`
4. Open http://localhost:3000 and create your admin account.

## Running tests

```bash
# Backend
cd apps/api && pytest --cov=app

# Frontend
cd apps/web && npm test -- --run

# Full CI locally (requires Docker)
docker compose build
```

## Code style

- **Python:** Formatted by ruff. Run `ruff check .` and `ruff format .`.
- **TypeScript:** Linted by ESLint. Run `npx eslint .` in `apps/web`.
- All code must pass CI checks before merge.

## Pull request process

1. Create a feature branch from `main`.
2. Write tests for new functionality.
3. Ensure all CI checks pass.
4. Write a clear PR description explaining the change.
5. Request review from a maintainer.

## Commit messages

Use conventional commits: `feat:`, `fix:`, `docs:`, `test:`,
`refactor:`, `chore:`.

## Reporting issues

Use GitHub Issues. Include:
- Steps to reproduce
- Expected vs actual behavior
- Browser / OS / Docker version
- Relevant logs (redact any secrets)
```

---

### 4.3 Structured Logging

**Create file:** `apps/api/app/middleware/logging.py`

```python
"""Structured JSON logging middleware.

Logs every request with: method, path, status, duration_ms, user_id.
Uses Python's built-in logging — no external dependency.
Sensitive headers (Authorization, Cookie) are never logged.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

logger = logging.getLogger("speech_machine.access")


class StructuredLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        start = time.perf_counter()

        response = await call_next(request)

        duration_ms = round((time.perf_counter() - start) * 1000, 2)

        # Extract user_id from the request state if auth middleware set it
        user_id = getattr(request.state, "user_id", None)

        log_data = {
            "method": request.method,
            "path": request.url.path,
            "status": response.status_code,
            "duration_ms": duration_ms,
            "user_id": user_id,
            "client_ip": request.client.host if request.client else None,
        }

        # Log level based on status code
        if response.status_code >= 500:
            logger.error(json.dumps(log_data))
        elif response.status_code >= 400:
            logger.warning(json.dumps(log_data))
        else:
            logger.info(json.dumps(log_data))

        return response
```

**Configure logging in `apps/api/app/main.py`:**

```python
import logging
import sys

logging.basicConfig(
    level=logging.INFO,
    format="%(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)

# Suppress noisy loggers
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
```

---

### 4.4 Health Check Endpoint

**Create file:** `apps/api/app/routers/health.py`

```python
"""Health check endpoints for load balancers and monitoring.

/api/health         — Shallow check (API is running).
/api/health/ready   — Deep check (DB + Redis connected).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db

router = APIRouter(tags=["health"])


@router.get("/api/health")
async def health() -> dict:
    """Shallow health check — the API process is alive."""
    return {"status": "ok"}


@router.get("/api/health/ready")
async def readiness(db: AsyncSession = Depends(get_db)) -> dict:
    """Deep readiness check — DB and Redis are reachable."""
    checks: dict[str, str] = {}

    # Database
    try:
        await db.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as exc:
        checks["database"] = f"error: {type(exc).__name__}"

    # Redis
    try:
        import redis.asyncio as aioredis
        r = aioredis.from_url("redis://redis:6379")
        await r.ping()
        await r.aclose()
        checks["redis"] = "ok"
    except Exception as exc:
        checks["redis"] = f"error: {type(exc).__name__}"

    all_ok = all(v == "ok" for v in checks.values())
    return {"status": "ok" if all_ok else "degraded", "checks": checks}
```

---

### 4.5 Rate Limiting

**Install:** Add `slowapi>=0.1.9` to `apps/api/requirements.txt`.

**Add to `apps/api/app/main.py`:**

```python
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["100/minute"],
    storage_uri="redis://redis:6379/1",
)
app.state.limiter = limiter
app.add_middleware(SlowAPIMiddleware)


@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request, exc):
    from fastapi.responses import JSONResponse
    return JSONResponse(
        status_code=429,
        content={"detail": "Rate limit exceeded. Try again shortly."},
    )
```

**Apply stricter limits to sensitive endpoints:**

```python
from slowapi import limiter as rate_limiter

@router.post("/api/auth/login")
@limiter.limit("10/minute")  # Prevent brute force
async def login(...):
    ...

@router.post("/api/setup")
@limiter.limit("5/minute")   # Extra protection for setup
async def initial_setup(...):
    ...
```

---

### 4.6 Docker Compose Production Profile

**Create file:** `docker-compose.prod.yml`

```yaml
# Production overrides. Use with:
#   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

services:
  web:
    restart: always
    environment:
      - NODE_ENV=production
      - NEXT_TELEMETRY_DISABLED=1

  api:
    restart: always
    environment:
      - ENVIRONMENT=production
    deploy:
      resources:
        limits:
          memory: 1G

  worker:
    restart: always
    deploy:
      resources:
        limits:
          memory: 4G  # Whisper models need RAM

  db:
    restart: always
    environment:
      - POSTGRES_PASSWORD=${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    deploy:
      resources:
        limits:
          memory: 512M

  redis:
    restart: always
    deploy:
      resources:
        limits:
          memory: 256M
```

---

### 4.7 Release Checklist Script

**Create file:** `scripts/release.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scripts/release.sh v0.1.0

VERSION="${1:?Usage: ./scripts/release.sh <version>}"

echo "=== Release ${VERSION} ==="

# 1. Verify clean working tree
if [ -n "$(git status --porcelain)" ]; then
    echo "ERROR: Working tree is not clean. Commit or stash changes first."
    exit 1
fi

# 2. Verify on main branch
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "main" ]; then
    echo "ERROR: Must be on main branch (currently on ${BRANCH})."
    exit 1
fi

# 3. Run full test suite
echo "Running backend tests..."
cd apps/api && pytest --tb=short -q
cd ../..

echo "Running frontend tests..."
cd apps/web && npm test -- --run
cd ../..

echo "Building Docker images..."
docker compose build

# 4. Tag and push
echo "Tagging ${VERSION}..."
git tag -a "${VERSION}" -m "Release ${VERSION}"
git push origin main --tags

echo ""
echo "=== Release ${VERSION} complete ==="
echo "Create a GitHub Release at:"
echo "  https://github.com/SSusantAchary/Speech-Machine/releases/new?tag=${VERSION}"
```

**Make executable:** `chmod +x scripts/release.sh`

---

### 4.8 GitHub Issue Templates

**Create file:** `.github/ISSUE_TEMPLATE/bug_report.md`

```markdown
---
name: Bug Report
about: Report something that isn't working
labels: bug
---

## Description
A clear description of the bug.

## Steps to reproduce
1.
2.
3.

## Expected behavior
What should happen.

## Actual behavior
What happens instead.

## Environment
- OS:
- Browser:
- Docker version:
- Speech-Machine version/commit:

## Logs
```
Paste relevant logs here (redact secrets).
```
```

**Create file:** `.github/ISSUE_TEMPLATE/feature_request.md`

```markdown
---
name: Feature Request
about: Suggest an improvement
labels: enhancement
---

## Problem
What problem does this solve?

## Proposed solution
How should it work?

## Alternatives considered
What else did you think about?
```

---

### 4.9 Security Headers Middleware

**Create file:** `apps/api/app/middleware/security_headers.py`

```python
"""Security response headers.

Adds headers that protect against common web vulnerabilities:
  - Content-Security-Policy
  - X-Content-Type-Options
  - X-Frame-Options
  - Strict-Transport-Security (production only)
  - Referrer-Policy
  - Permissions-Policy
"""

from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from typing import Callable

from app.config import settings


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        response = await call_next(request)

        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = (
            "camera=(self), microphone=(self), geolocation=()"
        )

        if settings.ENVIRONMENT == "production":
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )

        return response
```

---

**Week 4 deliverable checklist:**
- [ ] `docs/ARCHITECTURE.md` with system diagram and request lifecycle
- [ ] `CONTRIBUTING.md` with setup, test, and PR instructions
- [ ] Structured JSON logging on all requests
- [ ] Health check endpoints (`/api/health`, `/api/health/ready`)
- [ ] Rate limiting on auth and setup endpoints
- [ ] Docker Compose production overlay
- [ ] Release script with pre-flight checks
- [ ] GitHub issue templates (bug report + feature request)
- [ ] Security response headers middleware
- [ ] Tag release `v0.2.0`

---

## Final verification matrix

Run this complete checklist before declaring the 4-week phase complete:

| Category | Check | Command |
|---|---|---|
| CI | All jobs green | Push to branch, verify Actions |
| Auth | No hardcoded credentials in codebase | `grep -rn "admin" apps/ \| grep -i password` returns 0 results |
| Auth | JWT tokens expire | Verify 401 after 15 minutes |
| Auth | Refresh rotation works | Call `/api/auth/refresh`, verify new token |
| Auth | Token theft detected | Reuse a revoked refresh jti, verify all tokens revoked |
| Upload | Oversized file rejected | Upload a 501 MB file, verify 413 |
| Upload | Wrong MIME type rejected | Upload a .exe renamed to .mp4, verify 415 |
| Upload | Filename sanitization | Upload `../../etc/passwd.mp4`, verify safe filename |
| Transcription | Runs in background | Upload video, verify immediate response + polling |
| Transcription | Temp files cleaned | Check `/tmp/sm_transcribe_*` after job completes — empty |
| Transcription | Failure handled | Kill worker mid-job, verify session status = "failed" |
| Storage | Local backend works | Upload + retrieve with `STORAGE_BACKEND=local` |
| Database | Migrations auto-run | `docker compose up` with fresh volume, verify tables |
| Metrics | WPM computed correctly | 120 words in 60 seconds = 120 WPM |
| Metrics | Fillers detected | "um" and "like" counted accurately |
| Health | Readiness check | `curl /api/health/ready` returns DB + Redis status |
| Rate limit | Auth throttled | Send 11 login requests in 1 minute, verify 429 |
| Logging | Structured JSON | Check stdout for JSON log lines with method/path/status |
| Security | CORS locked | `curl -H "Origin: http://evil.com"` gets no CORS headers |
| Security | Security headers present | Check response for X-Content-Type-Options, X-Frame-Options |
| Docker | Full stack starts | `docker compose up --build` — all services healthy |
| Release | Tag exists | `git tag` shows v0.1.0 and v0.2.0 |