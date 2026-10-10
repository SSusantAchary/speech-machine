import logging
import sys

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db import Base, engine
from app.middleware.logging import StructuredLoggingMiddleware
from app.middleware.security_headers import SecurityHeadersMiddleware
from app.routes import auth, coaching, dashboard, health, jobs, sessions, settings as settings_routes, setup

logging.basicConfig(
    level=logging.INFO,
    format="%(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

app = FastAPI(title="Speech-Machine API")

app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(StructuredLoggingMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    # Docker runs Alembic before app startup. This keeps tests and lightweight
    # local runs usable when migrations have not been executed yet.
    Base.metadata.create_all(bind=engine)


app.include_router(setup.router)
app.include_router(auth.router)
app.include_router(dashboard.router)
app.include_router(coaching.router)
app.include_router(sessions.router)
app.include_router(settings_routes.router)
app.include_router(jobs.router)
app.include_router(health.router)
