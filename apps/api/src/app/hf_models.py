from __future__ import annotations

import inspect
import json
import re
import shutil
from pathlib import Path
from typing import Any, Callable

from app.config import settings

SERVER_BACKEND = "server"
MLX_AUDIO_BACKEND = "mlx_audio"
DOWNLOAD_MARKER = ".sparks-model-download.json"

SERVER_WHISPER_MODELS: tuple[dict[str, str], ...] = (
    {
        "id": "openai/whisper-tiny",
        "name": "Whisper Tiny",
        "repo_id": "openai/whisper-tiny",
        "runtime_model_id": "tiny",
        "description": "OpenAI Whisper Tiny served through the faster-whisper runtime.",
        "languages": "99+ languages",
        "backend": SERVER_BACKEND,
    },
    {
        "id": "openai/whisper-base",
        "name": "Whisper Base",
        "repo_id": "openai/whisper-base",
        "runtime_model_id": "base",
        "description": "OpenAI Whisper Base served through the faster-whisper runtime.",
        "languages": "99+ languages",
        "backend": SERVER_BACKEND,
    },
    {
        "id": "openai/whisper-small",
        "name": "Whisper Small",
        "repo_id": "openai/whisper-small",
        "runtime_model_id": "small",
        "description": "OpenAI Whisper Small served through the faster-whisper runtime.",
        "languages": "99+ languages",
        "backend": SERVER_BACKEND,
    },
    {
        "id": "openai/whisper-medium",
        "name": "Whisper Medium",
        "repo_id": "openai/whisper-medium",
        "runtime_model_id": "medium",
        "description": "OpenAI Whisper Medium served through the faster-whisper runtime.",
        "languages": "99+ languages",
        "backend": SERVER_BACKEND,
    },
    {
        "id": "openai/whisper-large-v3",
        "name": "Whisper Large v3",
        "repo_id": "openai/whisper-large-v3",
        "runtime_model_id": "large-v3",
        "description": "OpenAI Whisper Large v3 served through the faster-whisper runtime.",
        "languages": "99+ languages",
        "backend": SERVER_BACKEND,
    },
    {
        "id": "openai/whisper-large-v3-turbo",
        "name": "Whisper Large v3 Turbo",
        "repo_id": "openai/whisper-large-v3-turbo",
        "runtime_model_id": "turbo",
        "description": "OpenAI Whisper Large v3 Turbo served through the faster-whisper runtime.",
        "languages": "99+ languages",
        "backend": SERVER_BACKEND,
    },
)

MLX_AUDIO_STT_MODELS: tuple[dict[str, str], ...] = (
    {
        "id": "mlx-community/whisper-large-v3-turbo-asr-fp16",
        "name": "Whisper",
        "repo_id": "mlx-community/whisper-large-v3-turbo-asr-fp16",
        "description": "OpenAI's robust speech-to-text model for multilingual transcription.",
        "languages": "99+ languages",
        "backend": MLX_AUDIO_BACKEND,
    },
    {
        "id": "distil-whisper/distil-large-v3",
        "name": "Distil-Whisper",
        "repo_id": "distil-whisper/distil-large-v3",
        "description": "Distilled Whisper variant optimized for faster English transcription.",
        "languages": "English",
        "backend": MLX_AUDIO_BACKEND,
    },
    {
        "id": "mlx-community/Qwen3-ASR-1.7B-8bit",
        "name": "Qwen3-ASR",
        "repo_id": "mlx-community/Qwen3-ASR-1.7B-8bit",
        "description": "Alibaba's multilingual ASR model for speech recognition across major languages.",
        "languages": "ZH, EN, JA, KO, and more",
        "backend": MLX_AUDIO_BACKEND,
    },
    {
        "id": "mlx-community/Qwen3-ForcedAligner-0.6B-8bit",
        "name": "Qwen3-ForcedAligner",
        "repo_id": "mlx-community/Qwen3-ForcedAligner-0.6B-8bit",
        "description": "Word-level audio alignment model for timestamp refinement and transcript sync.",
        "languages": "ZH, EN, JA, KO, and more",
        "backend": MLX_AUDIO_BACKEND,
    },
    {
        "id": "mlx-community/parakeet-tdt-0.6b-v3",
        "name": "Parakeet",
        "repo_id": "mlx-community/parakeet-tdt-0.6b-v3",
        "description": "NVIDIA's accurate speech recognizer with strong multilingual coverage.",
        "languages": "25 European languages",
        "backend": MLX_AUDIO_BACKEND,
    },
    {
        "id": "mlx-community/Voxtral-Mini-3B-2507-bf16",
        "name": "Voxtral",
        "repo_id": "mlx-community/Voxtral-Mini-3B-2507-bf16",
        "description": "Mistral's compact speech model for general-purpose transcription.",
        "languages": "Multiple languages",
        "backend": MLX_AUDIO_BACKEND,
    },
    {
        "id": "mlx-community/Voxtral-Mini-4B-Realtime-2602-4bit",
        "name": "Voxtral Realtime 4bit",
        "repo_id": "mlx-community/Voxtral-Mini-4B-Realtime-2602-4bit",
        "description": "Streaming-friendly Voxtral realtime model quantized for lighter local use.",
        "languages": "Multiple languages",
        "backend": MLX_AUDIO_BACKEND,
    },
    {
        "id": "mlx-community/Voxtral-Mini-4B-Realtime-2602-fp16",
        "name": "Voxtral Realtime fp16",
        "repo_id": "mlx-community/Voxtral-Mini-4B-Realtime-2602-fp16",
        "description": "Higher precision realtime Voxtral transcription model for local speech capture.",
        "languages": "Multiple languages",
        "backend": MLX_AUDIO_BACKEND,
    },
    {
        "id": "mlx-community/VibeVoice-ASR-bf16",
        "name": "VibeVoice-ASR",
        "repo_id": "mlx-community/VibeVoice-ASR-bf16",
        "description": "Microsoft's ASR model with diarization and timestamp support.",
        "languages": "Multiple languages",
        "backend": MLX_AUDIO_BACKEND,
    },
)


def get_models_root() -> Path:
    storage_dir = Path(settings.storage_dir).expanduser()
    return storage_dir.parent / "models" / "hf"


def _sanitize_repo_id(repo_id: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "-", repo_id).strip("-")


def _model_dir(repo_id: str) -> Path:
    return get_models_root() / _sanitize_repo_id(repo_id)


def _download_marker_path(repo_id: str) -> Path:
    return _model_dir(repo_id) / DOWNLOAD_MARKER


def _is_model_downloaded(repo_id: str) -> bool:
    model_dir = _model_dir(repo_id)
    return model_dir.exists() and _download_marker_path(repo_id).exists()


def _build_model_status(model: dict[str, str]) -> dict[str, Any]:
    local_path = str(_model_dir(model["repo_id"])) if _is_model_downloaded(model["repo_id"]) else None
    return {
        "id": model["id"],
        "name": model["name"],
        "repo_id": model["repo_id"],
        "description": model["description"],
        "languages": model["languages"],
        "available": local_path is not None,
        "local_path": local_path,
    }


def _prepare_model_dir(repo_id: str) -> Path:
    target_dir = _model_dir(repo_id)
    target_dir.parent.mkdir(parents=True, exist_ok=True)
    if target_dir.exists() and not _download_marker_path(repo_id).exists():
        shutil.rmtree(target_dir, ignore_errors=True)
    return target_dir


def _finalize_download(repo_id: str) -> None:
    _download_marker_path(repo_id).write_text(
        json.dumps({"repo_id": repo_id}, indent=2),
        encoding="utf-8",
    )


def _download_with_marker(model: dict[str, Any], downloader: Callable[[Path], None]) -> dict[str, Any]:
    if _is_model_downloaded(model["repo_id"]):
        return _build_model_status(model)

    target_dir = _prepare_model_dir(model["repo_id"])

    try:
        downloader(target_dir)
    except Exception as exc:  # pragma: no cover - defensive wrapper around third-party download errors
        if target_dir.exists() and not _download_marker_path(model["repo_id"]).exists():
            shutil.rmtree(target_dir, ignore_errors=True)
        raise RuntimeError(f"Failed to download model '{model['repo_id']}': {exc}") from exc

    _finalize_download(model["repo_id"])
    return _build_model_status(model)


def get_server_model_ids() -> tuple[str, ...]:
    return tuple(model["id"] for model in SERVER_WHISPER_MODELS)


def get_server_model_keys() -> set[str]:
    keys: set[str] = set()
    for model in SERVER_WHISPER_MODELS:
        keys.add(model["id"])
        keys.add(model["repo_id"])
        keys.add(model["runtime_model_id"])
    return keys


def get_server_model_catalog() -> list[dict[str, Any]]:
    return [_build_model_status(model) for model in SERVER_WHISPER_MODELS]


def resolve_server_model_entry(model_name: str | None = None) -> dict[str, Any]:
    selected_model = model_name or settings.whisper_model
    for model in SERVER_WHISPER_MODELS:
        if selected_model in {model["id"], model["repo_id"], model["runtime_model_id"]}:
            return {**_build_model_status(model), "runtime_model_id": model["runtime_model_id"]}
    raise ValueError(
        f"Unsupported server transcription model '{selected_model}'. "
        f"Choose one of: {', '.join(get_server_model_ids())}"
    )


def download_server_model(model_name: str) -> dict[str, Any]:
    model = resolve_server_model_entry(model_name)

    try:
        import faster_whisper
        from faster_whisper import utils as faster_whisper_utils
        from faster_whisper.utils import download_model
    except ImportError as exc:
        raise RuntimeError(
            "faster-whisper is not installed in this runtime. "
            "Install it before downloading Whisper models."
        ) from exc

    supported_models = getattr(faster_whisper_utils, "_MODELS", {})
    if isinstance(supported_models, dict) and model["runtime_model_id"] not in supported_models:
        runtime_version = getattr(faster_whisper, "__version__", "installed")
        raise ValueError(
            f"Whisper model '{model['name']}' is not supported by faster-whisper {runtime_version}. "
            f"Upgrade faster-whisper to a version that supports '{model['runtime_model_id']}' "
            "before downloading this model."
        )

    parameters = inspect.signature(download_model).parameters

    def _download(target_dir: Path) -> None:
        if "output_dir" in parameters:
            download_model(model["runtime_model_id"], output_dir=str(target_dir))
            return
        download_model(model["runtime_model_id"], str(target_dir))

    return _download_with_marker(model, _download)


def get_mlx_audio_model_ids() -> tuple[str, ...]:
    return tuple(model["id"] for model in MLX_AUDIO_STT_MODELS)


def get_mlx_audio_model_keys() -> set[str]:
    keys: set[str] = set()
    for model in MLX_AUDIO_STT_MODELS:
        keys.add(model["id"])
        keys.add(model["repo_id"])
    return keys


def get_mlx_audio_model_catalog() -> list[dict[str, Any]]:
    return [_build_model_status(model) for model in MLX_AUDIO_STT_MODELS]


def resolve_mlx_audio_model_entry(model_name: str | None = None) -> dict[str, Any]:
    selected_model = model_name or settings.mlx_audio_model
    for model in MLX_AUDIO_STT_MODELS:
        if selected_model in {model["id"], model["repo_id"]}:
            return _build_model_status(model)
    raise ValueError(
        f"Unsupported MLX Audio model '{selected_model}'. "
        f"Choose one of: {', '.join(get_mlx_audio_model_ids())}"
    )


def download_mlx_audio_model(model_name: str) -> dict[str, Any]:
    model = resolve_mlx_audio_model_entry(model_name)

    try:
        from huggingface_hub import snapshot_download
    except ImportError as exc:
        raise RuntimeError(
            "huggingface_hub is not installed in this desktop runtime. "
            "Install it in the desktop environment to download MLX models."
        ) from exc

    def _download(target_dir: Path) -> None:
        snapshot_download(repo_id=model["repo_id"], local_dir=str(target_dir))

    return _download_with_marker(model, _download)
