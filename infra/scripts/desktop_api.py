#!/usr/bin/env python3
from __future__ import annotations

import os
import platform
import sys
from pathlib import Path


APP_NAME = os.environ.get("DESKTOP_APP_NAME", "Speech-Machine")
DEFAULT_HOST = os.environ.get("DESKTOP_API_HOST", "127.0.0.1")
DEFAULT_PORT = int(os.environ.get("DESKTOP_API_PORT", "18000"))
REPO_ROOT = Path(__file__).resolve().parents[2]
API_SRC = REPO_ROOT / "apps" / "api" / "src"


def resolve_app_data_dir() -> Path:
    system = platform.system()
    home = Path.home()
    if system == "Darwin":
        return home / "Library" / "Application Support" / APP_NAME
    if system == "Windows":
        appdata = os.environ.get("APPDATA")
        if appdata:
            return Path(appdata) / APP_NAME
        return home / "AppData" / "Roaming" / APP_NAME

    xdg_data_home = os.environ.get("XDG_DATA_HOME")
    if xdg_data_home:
        return Path(xdg_data_home) / APP_NAME.lower().replace(" ", "-")
    return home / ".local" / "share" / APP_NAME.lower().replace(" ", "-")


def configure_env(base_dir: Path) -> None:
    storage_dir = base_dir / "storage"
    db_dir = base_dir / "data"
    models_dir = base_dir / "models"
    db_dir.mkdir(parents=True, exist_ok=True)
    storage_dir.mkdir(parents=True, exist_ok=True)
    models_dir.mkdir(parents=True, exist_ok=True)

    database_path = db_dir / "video_coach.db"
    os.environ.setdefault("DATABASE_URL", f"sqlite:///{database_path}")
    os.environ.setdefault("STORAGE_DIR", str(storage_dir))
    os.environ.setdefault("LOCAL_ONLY_MODE", "true")
    os.environ.setdefault("LOCAL_ADMIN_EMAIL", "admin")
    os.environ.setdefault("LOCAL_ADMIN_PASSWORD", "admin")
    os.environ.setdefault("JWT_SECRET", "desktop-local-secret")
    os.environ.setdefault("TRANSCRIPTION_BACKEND", "server")
    os.environ.setdefault("WHISPER_MODEL", "small")
    os.environ.setdefault("WHISPER_DEVICE", "cpu")
    os.environ.setdefault("MLX_AUDIO_MODEL", "mlx-community/parakeet-tdt-0.6b-v3")


def main() -> None:
    base_dir = resolve_app_data_dir()
    base_dir.mkdir(parents=True, exist_ok=True)
    configure_env(base_dir)

    if str(API_SRC) not in sys.path:
        sys.path.insert(0, str(API_SRC))

    from app.main import app  # noqa: WPS433
    import uvicorn  # noqa: WPS433

    uvicorn.run(app, host=DEFAULT_HOST, port=DEFAULT_PORT)


if __name__ == "__main__":
    main()
