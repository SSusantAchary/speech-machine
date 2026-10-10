from __future__ import annotations

from typing import Callable

import requests

from app.config import settings

RECOMMENDED_LOCAL_MODELS = (
    "nvidia/parakeet-tdt-0.6b-v3",
    "nvidia/parakeet-ctc-1.1b",
    "mistralai/Voxtral-Mini-4B-Realtime-2602",
    "Qwen/Qwen3-ASR-1.7B",
)

ENGINE_LABELS = {
    "ollama": "Ollama",
    "lmstudio": "LM Studio",
    "llamacpp": "llama.cpp",
}


def _default_engine_url(engine_id: str) -> str:
    if engine_id == "ollama":
        return settings.ollama_base_url
    if engine_id == "lmstudio":
        return settings.lmstudio_base_url
    if engine_id == "llamacpp":
        return settings.llama_cpp_base_url
    raise ValueError(f"Unsupported local inference engine '{engine_id}'")


def _join_url(base_url: str, suffix: str) -> str:
    return f"{base_url.rstrip('/')}/{suffix.lstrip('/')}"


def _normalize_engine_url(engine_id: str, base_url: str | None = None) -> str:
    selected = (base_url or _default_engine_url(engine_id)).strip()
    return selected.rstrip("/")


def _request_json(url: str) -> dict:
    response = requests.get(url, timeout=settings.local_engine_timeout_seconds)
    response.raise_for_status()
    return response.json()


def _request_ok(url: str) -> bool:
    response = requests.get(url, timeout=settings.local_engine_timeout_seconds)
    response.raise_for_status()
    return True


def _check_with_candidates(
    engine_id: str,
    base_url: str,
    candidates: list[tuple[str, Callable[[dict], list[str]]]],
    probe: Callable[[str], dict],
) -> dict:
    last_error = "Connection failed"
    for suffix, parser in candidates:
        url = _join_url(base_url, suffix)
        try:
            payload = probe(url)
            return {
                "id": engine_id,
                "label": ENGINE_LABELS[engine_id],
                "base_url": base_url,
                "live": True,
                "detail": "Connected",
                "available_models": parser(payload),
            }
        except requests.RequestException as exc:
            last_error = str(exc)
    return {
        "id": engine_id,
        "label": ENGINE_LABELS[engine_id],
        "base_url": base_url,
        "live": False,
        "detail": last_error,
        "available_models": [],
    }


def _parse_ollama_models(payload: dict) -> list[str]:
    return [item["name"] for item in payload.get("models", []) if item.get("name")]


def _parse_openai_models(payload: dict) -> list[str]:
    return [item["id"] for item in payload.get("data", []) if item.get("id")]


def _parse_empty(_payload: dict) -> list[str]:
    return []


def check_engine(engine_id: str, base_url: str | None = None) -> dict:
    normalized_url = _normalize_engine_url(engine_id, base_url)

    if engine_id == "ollama":
        return _check_with_candidates(
            engine_id,
            normalized_url,
            [
                ("api/tags", _parse_ollama_models),
                ("v1/models", _parse_openai_models),
            ],
            _request_json,
        )

    if engine_id == "lmstudio":
        return _check_with_candidates(
            engine_id,
            normalized_url,
            [("models", _parse_openai_models), ("v1/models", _parse_openai_models)],
            _request_json,
        )

    if engine_id == "llamacpp":
        status = _check_with_candidates(
            engine_id,
            normalized_url,
            [("v1/models", _parse_openai_models)],
            _request_json,
        )
        if status["live"]:
            return status

        try:
            _request_ok(_join_url(normalized_url, "health"))
            return {
                "id": engine_id,
                "label": ENGINE_LABELS[engine_id],
                "base_url": normalized_url,
                "live": True,
                "detail": "Connected",
                "available_models": [],
            }
        except requests.RequestException as exc:
            status["detail"] = str(exc)
            return status

    raise ValueError(f"Unsupported local inference engine '{engine_id}'")


def get_all_engine_statuses() -> list[dict]:
    return [check_engine(engine_id) for engine_id in ("ollama", "lmstudio", "llamacpp")]
