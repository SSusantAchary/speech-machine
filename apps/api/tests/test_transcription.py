import os
from pathlib import Path
import sys
import types
from uuid import uuid4

test_id = uuid4().hex
os.environ["DATABASE_URL"] = f"sqlite:///./test_{test_id}.db"
os.environ["LOCAL_ONLY_MODE"] = "true"
os.environ["STORAGE_DIR"] = f"/private/tmp/speech_machine_test_{test_id}"

from fastapi.testclient import TestClient

from app.main import app
from app.db import Base, SessionLocal, engine
from app import models
from app import transcription
from app import hf_models
from app.routes import sessions as session_routes
from app.storage import storage_client

client = TestClient(app)
Base.metadata.create_all(bind=engine)
_admin_headers: dict[str, str] | None = None


def get_admin_headers() -> dict[str, str]:
    global _admin_headers
    if _admin_headers is not None:
        return _admin_headers
    status_response = client.get("/setup/status")
    if status_response.json()["setup_required"]:
        setup_response = client.post(
            "/setup",
            json={"email": "admin@example.com", "password": "secret123"},
        )
        assert setup_response.status_code == 201
    response = client.post("/auth/login", json={"email": "admin@example.com", "password": "secret123"})
    assert response.status_code == 200
    _admin_headers = {"Authorization": f"Bearer {response.json()['access_token']}"}
    return _admin_headers


def create_transcription_model(model_id: str, name: str, available: bool = True, local_path: str | None = None):
    return {
        "id": model_id,
        "name": name,
        "repo_id": model_id,
        "description": f"{name} model",
        "languages": "Multiple languages",
        "available": available,
        "local_path": local_path,
    }


def test_transcription_endpoint(monkeypatch, tmp_path: Path):
    headers = get_admin_headers()

    payload = {
        "title": "Transcript",
        "mode": "Interview",
        "duration_ms": 1000,
        "transcript_segments": [],
        "metrics": [],
    }
    response = client.post("/sessions", json=payload, headers=headers)
    session_id = response.json()["id"]

    db = SessionLocal()
    session = db.query(models.Session).filter(models.Session.id == session_id).first()
    video_path = tmp_path / "recording.webm"
    video_path.write_bytes(b"test")
    session.video_path = str(video_path)
    db.commit()
    db.close()

    def fake_extract_audio(path: str) -> str:
        audio_path = tmp_path / "audio.wav"
        audio_path.write_bytes(b"audio")
        return str(audio_path)

    selected = {}

    original_get_backend = transcription.get_transcription_backend

    def fake_get_backend(backend_id: str):
        if backend_id == transcription.MLX_AUDIO_BACKEND:
            return {
                "id": transcription.MLX_AUDIO_BACKEND,
                "label": "MLX Audio",
                "supported": True,
                "live": True,
                "detail": "Available",
                "models": [create_transcription_model("mlx-community/parakeet-tdt-0.6b-v3", "Parakeet")],
                "default_model": "mlx-community/parakeet-tdt-0.6b-v3",
            }
        return original_get_backend(backend_id)

    def fake_transcribe_audio(
        path: str,
        model_name: str | None = None,
        backend_id: str | None = None,
    ):
        selected["model"] = model_name
        selected["backend"] = backend_id
        return [{"start_ms": 0, "end_ms": 500, "text": "hello"}]

    monkeypatch.setattr(transcription, "get_transcription_backend", fake_get_backend)
    monkeypatch.setattr(transcription, "ensure_transcription_model_ready", lambda backend_id, model_name: None)
    monkeypatch.setattr(transcription, "extract_audio", fake_extract_audio)
    monkeypatch.setattr(transcription, "transcribe_audio", fake_transcribe_audio)
    monkeypatch.setattr(storage_client, "get_local_path", lambda path: str(video_path))

    async def fake_enqueue(session_id_arg, user_id_arg, model_name, backend_id):
        assert session_id_arg == session_id
        assert model_name == "mlx-community/parakeet-tdt-0.6b-v3"
        assert backend_id == "mlx_audio"
        return "job-test"

    monkeypatch.setattr(session_routes, "enqueue_transcription", fake_enqueue)

    response = client.post(
        f"/sessions/{session_id}/transcribe",
        json={
            "backend": "mlx_audio",
            "model": "mlx-community/parakeet-tdt-0.6b-v3",
        },
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["job_id"] == "job-test"

    # Run background task synchronously
    db = SessionLocal()
    user = db.query(models.User).filter(models.User.email == "admin@example.com").first()
    user_id = user.id if user else 1
    db.close()
    session_routes._run_transcription(
        session_id,
        user_id,
        "mlx-community/parakeet-tdt-0.6b-v3",
        "mlx_audio",
    )

    db = SessionLocal()
    session = db.query(models.Session).filter(models.Session.id == session_id).first()
    assert session.transcription_status == "complete"
    assert len(session.transcript_segments) == 1
    db.close()
    assert selected["model"] == "mlx-community/parakeet-tdt-0.6b-v3"
    assert selected["backend"] == "mlx_audio"


def test_transcription_endpoint_rejects_unsupported_mlx_audio(monkeypatch, tmp_path: Path):
    headers = get_admin_headers()

    payload = {
        "title": "Transcript Failure",
        "mode": "Interview",
        "duration_ms": 1000,
        "transcript_segments": [],
        "metrics": [],
    }
    response = client.post("/sessions", json=payload, headers=headers)
    session_id = response.json()["id"]

    db = SessionLocal()
    session = db.query(models.Session).filter(models.Session.id == session_id).first()
    video_path = tmp_path / "recording.webm"
    video_path.write_bytes(b"test")
    session.video_path = str(video_path)
    db.commit()
    db.close()

    original_get_backend = transcription.get_transcription_backend

    def fake_get_backend(backend_id: str):
        if backend_id == transcription.MLX_AUDIO_BACKEND:
            return {
                "id": transcription.MLX_AUDIO_BACKEND,
                "label": "MLX Audio",
                "supported": False,
                "live": False,
                "detail": "MLX Audio requires macOS on Apple Silicon.",
                "models": [],
                "default_model": None,
            }
        return original_get_backend(backend_id)

    monkeypatch.setattr(transcription, "get_transcription_backend", fake_get_backend)

    response = client.post(
        f"/sessions/{session_id}/transcribe",
        json={
            "backend": "mlx_audio",
            "model": "mlx-community/parakeet-tdt-0.6b-v3",
        },
        headers=headers,
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "MLX Audio requires macOS on Apple Silicon."


def test_transcribe_audio_uses_downloaded_whisper_model(monkeypatch, tmp_path: Path):
    audio_path = tmp_path / "audio.wav"
    audio_path.write_bytes(b"audio")

    class Segment:
        def __init__(self, start: float, end: float, text: str):
            self.start = start
            self.end = end
            self.text = text

    class FakeWhisperModel:
        def transcribe(self, path: str):
            assert path == str(audio_path)
            return iter([Segment(0.0, 0.8, "hello"), Segment(0.8, 1.4, "world")]), None

    monkeypatch.setattr(
        transcription,
        "ensure_server_model_downloaded",
        lambda model_name: {
            "id": model_name,
            "name": "Whisper Small",
            "repo_id": model_name,
            "description": "Whisper Small",
            "languages": "99+ languages",
            "available": True,
            "local_path": "/tmp/models/whisper-small",
        },
    )

    def fake_load_whisper_model(model_ref: str, device: str):
        assert model_ref == "/tmp/models/whisper-small"
        assert device == transcription.settings.whisper_device
        return FakeWhisperModel()

    monkeypatch.setattr(transcription, "_load_whisper_model", fake_load_whisper_model)

    result = transcription.transcribe_audio(str(audio_path), "openai/whisper-small")

    assert result == [
        {"start_ms": 0, "end_ms": 800, "text": "hello"},
        {"start_ms": 800, "end_ms": 1400, "text": "world"},
    ]


def test_transcribe_audio_uses_mlx_audio_model(monkeypatch, tmp_path: Path):
    audio_path = tmp_path / "audio.wav"
    audio_path.write_bytes(b"audio")

    original_get_backend = transcription.get_transcription_backend

    class Sentence:
        def __init__(self, start: float, end: float, text: str):
            self.start = start
            self.end = end
            self.text = text

    class Result:
        sentences = [
            Sentence(0.0, 0.5, "hello"),
            Sentence(0.5, 1.0, "mlx"),
        ]

    class FakeMlxAudioModel:
        def generate(self, path: str):
            assert path == str(audio_path)
            return Result()

    def fake_get_backend(backend_id: str):
        if backend_id == transcription.MLX_AUDIO_BACKEND:
            return {
                "id": transcription.MLX_AUDIO_BACKEND,
                "label": "MLX Audio",
                "supported": True,
                "live": True,
                "detail": "Available",
                "models": [create_transcription_model("mlx-community/parakeet-tdt-0.6b-v3", "Parakeet")],
                "default_model": "mlx-community/parakeet-tdt-0.6b-v3",
            }
        return original_get_backend(backend_id)

    monkeypatch.setattr(transcription, "get_transcription_backend", fake_get_backend)
    monkeypatch.setattr(
        transcription,
        "ensure_mlx_audio_model_downloaded",
        lambda model_name: {
            "id": model_name,
            "name": "Parakeet",
            "repo_id": model_name,
            "description": "Parakeet model",
            "languages": "Multiple languages",
            "available": True,
            "local_path": "/tmp/models/parakeet",
        },
    )

    def fake_load_mlx_audio_model(model_ref: str):
        assert model_ref == "/tmp/models/parakeet"
        return FakeMlxAudioModel()

    monkeypatch.setattr(transcription, "_load_mlx_audio_model", fake_load_mlx_audio_model)

    result = transcription.transcribe_audio(
        str(audio_path),
        "mlx-community/parakeet-tdt-0.6b-v3",
        "mlx_audio",
    )

    assert result == [
        {"start_ms": 0, "end_ms": 500, "text": "hello"},
        {"start_ms": 500, "end_ms": 1000, "text": "mlx"},
    ]


def test_transcribe_audio_rejects_missing_mlx_audio_download(monkeypatch, tmp_path: Path):
    audio_path = tmp_path / "audio.wav"
    audio_path.write_bytes(b"audio")

    original_get_backend = transcription.get_transcription_backend

    def fake_get_backend(backend_id: str):
        if backend_id == transcription.MLX_AUDIO_BACKEND:
            return {
                "id": transcription.MLX_AUDIO_BACKEND,
                "label": "MLX Audio",
                "supported": True,
                "live": True,
                "detail": "Available",
                "models": [create_transcription_model("mlx-community/parakeet-tdt-0.6b-v3", "Parakeet", available=False)],
                "default_model": "mlx-community/parakeet-tdt-0.6b-v3",
            }
        return original_get_backend(backend_id)

    monkeypatch.setattr(transcription, "get_transcription_backend", fake_get_backend)

    try:
        transcription.transcribe_audio(
            str(audio_path),
            "mlx-community/parakeet-tdt-0.6b-v3",
            "mlx_audio",
        )
    except ValueError as exc:
        assert "not downloaded yet" in str(exc)
    else:  # pragma: no cover - assertion guard
        raise AssertionError("Expected MLX Audio transcription to require a downloaded local model.")


def test_download_mlx_audio_model_uses_app_managed_storage(monkeypatch, tmp_path: Path):
    models_root = tmp_path / "models" / "hf"
    download_call: dict[str, str] = {}

    def fake_snapshot_download(repo_id: str, local_dir: str):
        target_dir = Path(local_dir)
        target_dir.mkdir(parents=True, exist_ok=True)
        (target_dir / "config.json").write_text("{}", encoding="utf-8")
        download_call["repo_id"] = repo_id
        download_call["local_dir"] = local_dir

    monkeypatch.setattr(hf_models, "get_models_root", lambda: models_root)
    monkeypatch.setitem(sys.modules, "huggingface_hub", types.SimpleNamespace(snapshot_download=fake_snapshot_download))

    model = hf_models.download_mlx_audio_model("mlx-community/parakeet-tdt-0.6b-v3")

    expected_dir = models_root / "mlx-community-parakeet-tdt-0.6b-v3"
    assert download_call["repo_id"] == "mlx-community/parakeet-tdt-0.6b-v3"
    assert download_call["local_dir"] == str(expected_dir)
    assert model["available"] is True
    assert model["local_path"] == str(expected_dir)
    assert (expected_dir / hf_models.DOWNLOAD_MARKER).exists()


def test_download_server_model_uses_app_managed_storage(monkeypatch, tmp_path: Path):
    models_root = tmp_path / "models" / "hf"
    download_call: dict[str, str] = {}

    def fake_download_model(model_size_or_path: str, output_dir: str):
        target_dir = Path(output_dir)
        target_dir.mkdir(parents=True, exist_ok=True)
        (target_dir / "model.bin").write_text("ok", encoding="utf-8")
        download_call["model_size_or_path"] = model_size_or_path
        download_call["output_dir"] = output_dir

    monkeypatch.setattr(hf_models, "get_models_root", lambda: models_root)
    fake_utils_module = types.SimpleNamespace(download_model=fake_download_model, _MODELS={"small": object()})
    monkeypatch.setitem(
        sys.modules,
        "faster_whisper",
        types.SimpleNamespace(utils=fake_utils_module, __version__="1.1.0"),
    )
    monkeypatch.setitem(
        sys.modules,
        "faster_whisper.utils",
        types.SimpleNamespace(download_model=fake_download_model, _MODELS={"small": object()}),
    )

    model = hf_models.download_server_model("openai/whisper-small")

    expected_dir = models_root / "openai-whisper-small"
    assert download_call["model_size_or_path"] == "small"
    assert download_call["output_dir"] == str(expected_dir)
    assert model["available"] is True
    assert model["local_path"] == str(expected_dir)
    assert (expected_dir / hf_models.DOWNLOAD_MARKER).exists()


def test_download_server_model_rejects_unsupported_runtime_model(monkeypatch, tmp_path: Path):
    models_root = tmp_path / "models" / "hf"

    def fake_download_model(_model_size_or_path: str, output_dir: str):
        raise AssertionError("download_model should not be called for unsupported runtime ids")

    monkeypatch.setattr(hf_models, "get_models_root", lambda: models_root)
    fake_utils_module = types.SimpleNamespace(download_model=fake_download_model, _MODELS={"large-v3": object()})
    monkeypatch.setitem(
        sys.modules,
        "faster_whisper",
        types.SimpleNamespace(utils=fake_utils_module, __version__="1.0.2"),
    )
    monkeypatch.setitem(
        sys.modules,
        "faster_whisper.utils",
        fake_utils_module,
    )

    try:
        hf_models.download_server_model("openai/whisper-large-v3-turbo")
    except ValueError as exc:
        assert "Whisper Large v3 Turbo" in str(exc)
        assert "faster-whisper 1.0.2" in str(exc)
        assert "turbo" in str(exc)
    else:  # pragma: no cover - assertion guard
        raise AssertionError("Expected unsupported runtime model ids to raise a ValueError.")
