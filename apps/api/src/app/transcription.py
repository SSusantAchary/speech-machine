from collections.abc import Iterable
import os
import platform
import subprocess
import tempfile
from functools import lru_cache
from typing import Any, List

from faster_whisper import WhisperModel

from app import hf_models
from app.config import settings

SERVER_BACKEND = "server"
MLX_AUDIO_BACKEND = "mlx_audio"
TRANSCRIPTION_BACKENDS = (SERVER_BACKEND, MLX_AUDIO_BACKEND)


def extract_audio(video_path: str) -> str:
    tmp_dir = tempfile.mkdtemp()
    audio_path = os.path.join(tmp_dir, "audio.wav")
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        video_path,
        "-vn",
        "-acodec",
        "pcm_s16le",
        "-ar",
        "16000",
        "-ac",
        "1",
        audio_path,
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return audio_path


def _normalize_segment(start_seconds: float, end_seconds: float, text: str) -> dict:
    return {
        "start_ms": int(max(start_seconds, 0) * 1000),
        "end_ms": int(max(end_seconds, 0) * 1000),
        "text": text.strip(),
    }


def _get_item_value(item: Any, *keys: str) -> Any:
    if isinstance(item, dict):
        for key in keys:
            value = item.get(key)
            if value is not None:
                return value
        return None

    for key in keys:
        value = getattr(item, key, None)
        if value is not None:
            return value
    return None


def _coerce_seconds(value: Any, fallback: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _is_apple_silicon_mac() -> bool:
    return platform.system() == "Darwin" and platform.machine() in {"arm64", "aarch64"}


@lru_cache(maxsize=1)
def _mlx_audio_import_ready() -> tuple[bool, str]:
    if not _is_apple_silicon_mac():
        return False, "MLX Audio requires macOS on Apple Silicon."

    try:
        import mlx_audio  # noqa: F401
    except ImportError:
        return False, "MLX Audio is not installed in this desktop runtime."

    return True, "MLX Audio is available locally. Download supported models into app storage before transcribing."


def get_default_transcription_backend() -> str:
    preferred = (settings.transcription_backend or SERVER_BACKEND).strip().lower()
    if preferred == MLX_AUDIO_BACKEND:
        if get_transcription_backend(MLX_AUDIO_BACKEND)["supported"]:
            return MLX_AUDIO_BACKEND
        return SERVER_BACKEND
    if preferred in TRANSCRIPTION_BACKENDS:
        return preferred
    return SERVER_BACKEND


def get_default_model_for_backend(backend_id: str) -> str:
    if backend_id == MLX_AUDIO_BACKEND:
        try:
            return hf_models.resolve_mlx_audio_model_entry(settings.mlx_audio_model)["id"]
        except ValueError:
            return hf_models.get_mlx_audio_model_ids()[0]

    try:
        return hf_models.resolve_server_model_entry(settings.whisper_model)["id"]
    except ValueError:
        return hf_models.get_server_model_ids()[0]


def get_transcription_backend(backend_id: str) -> dict:
    if backend_id == SERVER_BACKEND:
        return {
            "id": SERVER_BACKEND,
            "label": "Built-in Server",
            "supported": True,
            "live": True,
            "detail": "Runs inside the API process using faster-whisper after you download a supported Whisper model.",
            "models": hf_models.get_server_model_catalog(),
            "default_model": get_default_model_for_backend(SERVER_BACKEND),
        }

    if backend_id == MLX_AUDIO_BACKEND:
        ready, detail = _mlx_audio_import_ready()
        return {
            "id": MLX_AUDIO_BACKEND,
            "label": "MLX Audio",
            "supported": ready,
            "live": ready,
            "detail": detail,
            "models": hf_models.get_mlx_audio_model_catalog(),
            "default_model": get_default_model_for_backend(MLX_AUDIO_BACKEND),
        }

    raise ValueError(f"Unsupported transcription backend '{backend_id}'.")


def get_transcription_backends() -> list[dict]:
    return [
        get_transcription_backend(SERVER_BACKEND),
        get_transcription_backend(MLX_AUDIO_BACKEND),
    ]


def infer_backend_from_model(model_name: str | None) -> str | None:
    if not model_name:
        return None
    if model_name in hf_models.get_mlx_audio_model_keys():
        return MLX_AUDIO_BACKEND
    if model_name in hf_models.get_server_model_keys():
        return SERVER_BACKEND
    return None


def resolve_transcription_backend(
    backend_id: str | None = None,
    model_name: str | None = None,
) -> str:
    selected_backend = (backend_id or infer_backend_from_model(model_name) or get_default_transcription_backend()).strip().lower()
    if selected_backend not in TRANSCRIPTION_BACKENDS:
        raise ValueError(
            f"Unsupported transcription backend '{selected_backend}'. "
            f"Choose one of: {', '.join(TRANSCRIPTION_BACKENDS)}"
        )

    status = get_transcription_backend(selected_backend)
    if not status["supported"]:
        raise ValueError(status["detail"])
    return selected_backend


def resolve_server_model(model_name: str | None = None) -> str:
    return hf_models.resolve_server_model_entry(model_name or get_default_model_for_backend(SERVER_BACKEND))["id"]


def resolve_whisper_runtime_model(model_name: str | None = None) -> str:
    return hf_models.resolve_server_model_entry(model_name or get_default_model_for_backend(SERVER_BACKEND))[
        "runtime_model_id"
    ]


def resolve_mlx_audio_model(model_name: str | None = None) -> str:
    return hf_models.resolve_mlx_audio_model_entry(model_name or get_default_model_for_backend(MLX_AUDIO_BACKEND))["id"]


def resolve_transcription_model(model_name: str | None = None, backend_id: str | None = None) -> str:
    selected_backend = resolve_transcription_backend(backend_id, model_name)
    if selected_backend == MLX_AUDIO_BACKEND:
        return resolve_mlx_audio_model(model_name)
    return resolve_server_model(model_name)


@lru_cache(maxsize=8)
def _load_whisper_model(model_ref: str, device: str) -> WhisperModel:
    return WhisperModel(model_ref, device=device, compute_type="int8")


@lru_cache(maxsize=4)
def _load_mlx_audio_model(model_ref: str):
    try:
        from mlx_audio.stt.utils import load as load_mlx_audio_model
    except ImportError as exc:
        raise RuntimeError(
            "MLX Audio is not installed. Install mlx-audio in the desktop runtime to use MLX ASR models."
        ) from exc

    return load_mlx_audio_model(model_ref)


def ensure_server_model_downloaded(model_name: str) -> dict:
    model = hf_models.resolve_server_model_entry(model_name)
    if not model["available"] or not model["local_path"]:
        raise ValueError(
            f"Whisper model '{model['name']}' is not downloaded yet. "
            "Download it from Settings before transcribing."
        )
    return model


def ensure_mlx_audio_model_downloaded(model_name: str) -> dict:
    model = hf_models.resolve_mlx_audio_model_entry(model_name)
    if not model["available"] or not model["local_path"]:
        raise ValueError(
            f"MLX Audio model '{model['name']}' is not downloaded yet. "
            "Download it from Settings before transcribing."
        )
    return model


def ensure_transcription_model_ready(backend_id: str, model_name: str) -> None:
    if backend_id == SERVER_BACKEND:
        ensure_server_model_downloaded(model_name)
        return
    if backend_id == MLX_AUDIO_BACKEND:
        ensure_mlx_audio_model_downloaded(model_name)


def download_transcription_model(backend_id: str, model_name: str) -> dict:
    selected_backend = resolve_transcription_backend(backend_id, model_name)
    if selected_backend == SERVER_BACKEND:
        return hf_models.download_server_model(model_name)
    if selected_backend == MLX_AUDIO_BACKEND:
        return hf_models.download_mlx_audio_model(model_name)
    raise ValueError(f"Unsupported transcription backend '{selected_backend}'.")


def _transcribe_with_whisper(audio_path: str, model_name: str) -> List[dict]:
    model_info = ensure_server_model_downloaded(model_name)
    model = _load_whisper_model(model_info["local_path"], settings.whisper_device)
    segments, _info = model.transcribe(audio_path)
    return [
        {
            "start_ms": int(segment.start * 1000),
            "end_ms": int(segment.end * 1000),
            "text": segment.text.strip(),
        }
        for segment in segments
    ]


def _normalize_segments_from_items(items: Iterable[Any]) -> List[dict]:
    results = []
    for item in items:
        text = _get_item_value(item, "text", "sentence", "segment", "content")
        if not isinstance(text, str) or not text.strip():
            continue

        start_seconds = _coerce_seconds(
            _get_item_value(item, "start", "start_time", "start_seconds", "begin"),
            0.0,
        )
        end_seconds = _coerce_seconds(
            _get_item_value(item, "end", "end_time", "end_seconds", "stop"),
            start_seconds,
        )
        results.append(_normalize_segment(start_seconds, end_seconds, text))
    return results


def _extract_mlx_audio_segments(result: Any) -> List[dict]:
    for field_name in ("sentences", "segments"):
        values = _get_item_value(result, field_name)
        if isinstance(values, Iterable) and not isinstance(values, (str, bytes, dict)):
            segments = _normalize_segments_from_items(values)
            if segments:
                return segments

    if isinstance(result, Iterable) and not isinstance(result, (str, bytes, dict)):
        segments = _normalize_segments_from_items(result)
        if segments:
            return segments

    text = _get_item_value(result, "text", "transcript", "content")
    if isinstance(text, str) and text.strip():
        return [_normalize_segment(0, 0, text)]

    if isinstance(result, str) and result.strip():
        return [_normalize_segment(0, 0, result)]

    return []


def _transcribe_with_mlx_audio(audio_path: str, model_name: str) -> List[dict]:
    model_info = ensure_mlx_audio_model_downloaded(model_name)
    model = _load_mlx_audio_model(model_info["local_path"])
    if not hasattr(model, "generate"):
        raise RuntimeError("Loaded MLX Audio model does not expose a generate() method.")
    result = model.generate(audio_path)
    return _extract_mlx_audio_segments(result)


def transcribe_audio(
    audio_path: str,
    model_name: str | None = None,
    backend_id: str | None = None,
) -> List[dict]:
    selected_backend = resolve_transcription_backend(backend_id, model_name)
    selected_model = resolve_transcription_model(model_name, selected_backend)

    if selected_backend == MLX_AUDIO_BACKEND:
        return _transcribe_with_mlx_audio(audio_path, selected_model)
    return _transcribe_with_whisper(audio_path, selected_model)
