import json
import os
import zipfile
import asyncio
from io import BytesIO
from uuid import uuid4

test_id = uuid4().hex
os.environ["DATABASE_URL"] = f"sqlite:///./test_{test_id}.db"
os.environ["LOCAL_ONLY_MODE"] = "true"
os.environ["STORAGE_DIR"] = f"/private/tmp/speech_machine_test_{test_id}"

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect

from app import models, schema_upgrades
from app.db import Base, SessionLocal, engine
from app.main import app
from app.routes import settings as settings_routes
from app.routes import coaching as coaching_routes
from app.services.coaching import build_coaching_prompt, parse_coaching_response
from app.worker import jobs as worker_jobs

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


def test_auth_flow():
    response = client.get("/setup/status")
    if response.json()["setup_required"]:
        response = client.post("/setup", json={"email": "admin@example.com", "password": "secret123"})
        assert response.status_code == 201

    response = client.post("/auth/signup", json={"email": "test@example.com", "password": "secret123"})
    assert response.status_code == 200
    token = response.json()["access_token"]
    assert token

    response = client.post("/auth/login", json={"email": "test@example.com", "password": "secret123"})
    assert response.status_code == 200


def test_refresh_rotation_and_logout():
    status_response = client.get("/setup/status")
    if status_response.json()["setup_required"]:
        client.post("/setup", json={"email": "admin@example.com", "password": "secret123"})

    login_response = client.post(
        "/auth/login",
        json={"email": "admin@example.com", "password": "secret123"},
    )
    assert login_response.status_code == 200

    first_refresh_cookie = login_response.cookies.get("refresh_token")
    refresh_response = client.post("/auth/refresh", cookies={"refresh_token": first_refresh_cookie})
    assert refresh_response.status_code == 200
    assert refresh_response.cookies.get("refresh_token")
    assert refresh_response.cookies.get("refresh_token") != first_refresh_cookie

    reused_response = client.post("/auth/refresh", cookies={"refresh_token": first_refresh_cookie})
    assert reused_response.status_code == 401

    logout_response = client.post("/auth/logout", cookies={"refresh_token": refresh_response.cookies.get("refresh_token")})
    assert logout_response.status_code == 200
    after_logout = client.post("/auth/refresh", cookies={"refresh_token": refresh_response.cookies.get("refresh_token")})
    assert after_logout.status_code == 401


def test_health_endpoints():
    assert client.get("/health").status_code == 200
    response = client.get("/health/ready")
    assert response.status_code == 200
    assert "database" in response.json()["checks"]


def test_transcription_settings_endpoint(monkeypatch):
    monkeypatch.setattr(settings_routes.transcription, "get_default_transcription_backend", lambda: "mlx_audio")
    monkeypatch.setattr(
        settings_routes.transcription,
        "get_transcription_backends",
        lambda: [
            {
                "id": "server",
                "label": "Built-in Server",
                "supported": True,
                "live": True,
                "detail": "Server path",
                "models": [
                    create_transcription_model("openai/whisper-small", "Whisper Small", available=False),
                    create_transcription_model("openai/whisper-medium", "Whisper Medium", available=True),
                ],
                "default_model": "openai/whisper-small",
            },
            {
                "id": "mlx_audio",
                "label": "MLX Audio",
                "supported": True,
                "live": True,
                "detail": "Apple Silicon local ASR.",
                "models": [
                    create_transcription_model(
                        "mlx-community/parakeet-tdt-0.6b-v3",
                        "Parakeet",
                        local_path="/tmp/models/parakeet",
                    )
                ],
                "default_model": "mlx-community/parakeet-tdt-0.6b-v3",
            },
        ],
    )
    monkeypatch.setattr(
        settings_routes,
        "get_all_engine_statuses",
        lambda: [
            {
                "id": "ollama",
                "label": "Ollama",
                "base_url": "http://127.0.0.1:11434",
                "live": True,
                "detail": "Connected",
                "available_models": ["qwen3-asr"],
            }
        ],
    )
    headers = get_admin_headers()

    response = client.get("/settings/transcription", headers=headers)
    assert response.status_code == 200
    assert response.json()["default_backend"] == "mlx_audio"
    assert response.json()["backends"][1]["id"] == "mlx_audio"
    assert response.json()["backends"][1]["models"][0]["id"] == "mlx-community/parakeet-tdt-0.6b-v3"
    assert response.json()["backends"][1]["models"][0]["available"] is True
    assert response.json()["text_inference_engines"][0]["id"] == "ollama"


def test_transcription_settings_endpoint_marks_unsupported_mlx_audio(monkeypatch):
    monkeypatch.setattr(settings_routes.transcription, "get_default_transcription_backend", lambda: "server")
    monkeypatch.setattr(
        settings_routes.transcription,
        "get_transcription_backends",
        lambda: [
            {
                "id": "server",
                "label": "Built-in Server",
                "supported": True,
                "live": True,
                "detail": "Server path",
                "models": [create_transcription_model("openai/whisper-small", "Whisper Small", available=False)],
                "default_model": "openai/whisper-small",
            },
            {
                "id": "mlx_audio",
                "label": "MLX Audio",
                "supported": False,
                "live": False,
                "detail": "MLX Audio requires macOS on Apple Silicon.",
                "models": [create_transcription_model("mlx-community/parakeet-tdt-0.6b-v3", "Parakeet", available=False)],
                "default_model": None,
            },
        ],
    )
    monkeypatch.setattr(settings_routes, "get_all_engine_statuses", lambda: [])
    headers = get_admin_headers()

    response = client.get("/settings/transcription", headers=headers)
    assert response.status_code == 200
    assert response.json()["default_backend"] == "server"
    assert response.json()["backends"][1]["supported"] is False
    assert response.json()["backends"][1]["models"][0]["available"] is False


def test_transcription_model_download_endpoint(monkeypatch):
    monkeypatch.setattr(
        settings_routes.transcription,
        "download_transcription_model",
        lambda backend_id, model_id: create_transcription_model(
            model_id,
            "Parakeet",
            available=True,
            local_path="/tmp/models/parakeet",
        ),
    )
    headers = get_admin_headers()

    response = client.post(
        "/settings/transcription/models/download",
        json={"backend": "mlx_audio", "model": "mlx-community/parakeet-tdt-0.6b-v3"},
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["id"] == "mlx-community/parakeet-tdt-0.6b-v3"
    assert response.json()["available"] is True
    assert response.json()["local_path"] == "/tmp/models/parakeet"


def test_local_inference_check_endpoint(monkeypatch):
    monkeypatch.setattr(
        settings_routes,
        "check_engine",
        lambda engine_id, base_url=None: {
            "id": engine_id,
            "label": "LM Studio",
            "base_url": base_url or "http://127.0.0.1:1234/v1",
            "live": True,
            "detail": "Connected",
            "available_models": ["mistralai/Voxtral-Mini-4B-Realtime-2602"],
        },
    )
    headers = get_admin_headers()

    response = client.post(
        "/settings/local-inference/check",
        json={"engine_id": "lmstudio", "base_url": "http://localhost:1234/v1"},
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["live"] is True
    assert response.json()["available_models"] == ["mistralai/Voxtral-Mini-4B-Realtime-2602"]


def test_session_create_and_upload():
    headers = get_admin_headers()

    payload = {
        "title": "Test",
        "mode": "Interview",
        "duration_ms": 1000,
        "wpm_avg": 120,
        "filler_count": 0,
        "eye_contact_pct": 0.8,
        "tags": ["demo"],
        "transcript_segments": [{"start_ms": 0, "end_ms": 1000, "text": "Hello"}],
        "metrics": [{"t": 0, "wpm": 120, "rms": 50, "eye_contact": 0.8, "smile": 0.3, "yaw": 0.1, "pitch": 0.2, "roll": 0.1, "filler_count": 0, "pause_ms": 800}],
    }
    response = client.post("/sessions", json=payload, headers=headers)
    assert response.status_code == 200
    session_id = response.json()["id"]

    video_data = BytesIO(b"\x1a\x45\xdf\xa3webm-data")
    files = {"file": ("test.webm", video_data, "video/webm")}
    response = client.post(f"/sessions/{session_id}/upload", files=files, headers=headers)
    assert response.status_code == 200
    assert response.json()["status"] == "complete"

    response = client.get("/sessions", headers=headers)
    assert response.status_code == 200
    assert len(response.json()) >= 1


def test_export_includes_recording_file():
    headers = get_admin_headers()

    payload = {
        "title": "Export",
        "mode": "Interview",
        "duration_ms": 1000,
        "transcript_segments": [{"start_ms": 0, "end_ms": 1000, "text": "Hello"}],
        "metrics": [],
    }
    response = client.post("/sessions", json=payload, headers=headers)
    session_id = response.json()["id"]

    files = {"file": ("test.webm", BytesIO(b"\x1a\x45\xdf\xa3webm-data"), "video/webm")}
    upload_response = client.post(f"/sessions/{session_id}/upload", files=files, headers=headers)
    assert upload_response.status_code == 200

    export_response = client.get(f"/sessions/{session_id}/export", headers=headers)
    assert export_response.status_code == 200
    with zipfile.ZipFile(BytesIO(export_response.content)) as archive:
        assert "recording.webm" in archive.namelist()
        assert "transcript.txt" in archive.namelist()
        assert "transcript.pdf" in archive.namelist()


def test_transcript_download_formats():
    headers = get_admin_headers()

    payload = {
        "title": "Transcript Download",
        "mode": "Upload",
        "duration_ms": 61000,
        "transcript_segments": [
            {"start_ms": 0, "end_ms": 1000, "text": "Hello world"},
            {"start_ms": 1000, "end_ms": 2000, "text": "This is a transcript"},
        ],
        "metrics": [],
    }
    response = client.post("/sessions", json=payload, headers=headers)
    session_id = response.json()["id"]

    db_response = client.get(f"/sessions/{session_id}", headers=headers)
    assert db_response.status_code == 200

    txt_response = client.get(f"/sessions/{session_id}/transcript.txt", headers=headers)
    assert txt_response.status_code == 200
    assert txt_response.headers["content-type"].startswith("text/plain")
    assert "Hello world" in txt_response.text

    pdf_response = client.get(f"/sessions/{session_id}/transcript.pdf", headers=headers)
    assert pdf_response.status_code == 200
    assert pdf_response.headers["content-type"] == "application/pdf"
    assert pdf_response.content.startswith(b"%PDF")


def test_delete_video_keeps_session_transcript():
    headers = get_admin_headers()

    payload = {
        "title": "Delete Video",
        "mode": "Upload",
        "duration_ms": 5000,
        "transcript_segments": [{"start_ms": 0, "end_ms": 1000, "text": "Keep transcript"}],
        "metrics": [],
    }
    response = client.post("/sessions", json=payload, headers=headers)
    session_id = response.json()["id"]

    files = {"file": ("test.webm", BytesIO(b"\x1a\x45\xdf\xa3webm-data"), "video/webm")}
    upload_response = client.post(f"/sessions/{session_id}/upload", files=files, headers=headers)
    assert upload_response.status_code == 200

    delete_response = client.delete(f"/sessions/{session_id}/video", headers=headers)
    assert delete_response.status_code == 200
    assert delete_response.json()["status"] == "deleted"
    assert delete_response.json()["transcription_status"] == "complete"

    session_response = client.get(f"/sessions/{session_id}", headers=headers)
    assert session_response.status_code == 200
    assert session_response.json()["video_path"] is None

    video_response = client.get(f"/sessions/{session_id}/video", headers=headers)
    assert video_response.status_code == 404

    txt_response = client.get(f"/sessions/{session_id}/transcript.txt", headers=headers)
    assert txt_response.status_code == 200
    assert "Keep transcript" in txt_response.text


def test_video_upload_rejects_invalid_magic_bytes():
    headers = get_admin_headers()

    payload = {
        "title": "Invalid Upload",
        "mode": "Upload",
        "duration_ms": 1000,
        "transcript_segments": [],
        "metrics": [],
    }
    response = client.post("/sessions", json=payload, headers=headers)
    session_id = response.json()["id"]

    upload_response = client.post(
        f"/sessions/{session_id}/upload",
        files={"file": ("bad.webm", BytesIO(b"not-a-webm"), "video/webm")},
        headers=headers,
    )
    assert upload_response.status_code == 415


def test_session_document_upload_round_trip_and_full_delete():
    headers = get_admin_headers()

    payload = {
        "title": "Document Session",
        "mode": "Interview",
        "duration_ms": 5000,
        "transcript_segments": [],
        "metrics": [],
    }
    response = client.post("/sessions", json=payload, headers=headers)
    session_id = response.json()["id"]

    document_blocks = [{"index": 0, "text": "Read this paragraph aloud."}]
    upload_response = client.post(
        f"/sessions/{session_id}/document",
        files={"file": ("script.txt", BytesIO(b"Read this paragraph aloud."), "text/plain")},
        data={"blocks_json": json.dumps(document_blocks)},
        headers=headers,
    )
    assert upload_response.status_code == 200
    assert upload_response.json()["name"] == "script.txt"
    assert upload_response.json()["mime_type"] == "text/plain"

    session_response = client.get(f"/sessions/{session_id}", headers=headers)
    assert session_response.status_code == 200
    assert session_response.json()["document"]["name"] == "script.txt"
    assert session_response.json()["document"]["blocks"][0]["text"] == "Read this paragraph aloud."

    with SessionLocal() as db:
        stored = db.query(models.Session).filter(models.Session.id == session_id).first()
        assert stored is not None
        assert stored.document_path is not None
        document_path = stored.document_path
        assert os.path.exists(document_path)

    delete_response = client.delete(f"/sessions/{session_id}", headers=headers)
    assert delete_response.status_code == 200
    assert delete_response.json()["status"] == "deleted"
    assert not os.path.exists(document_path)

    missing_response = client.get(f"/sessions/{session_id}", headers=headers)
    assert missing_response.status_code == 404


def test_document_upload_rejects_unsupported_types():
    headers = get_admin_headers()

    payload = {
        "title": "Unsupported Doc",
        "mode": "Interview",
        "duration_ms": 1000,
        "transcript_segments": [],
        "metrics": [],
    }
    response = client.post("/sessions", json=payload, headers=headers)
    session_id = response.json()["id"]

    upload_response = client.post(
        f"/sessions/{session_id}/document",
        files={
            "file": (
                "script.docx",
                BytesIO(b"fake-docx"),
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
        data={"blocks_json": json.dumps([{"index": 0, "text": "Unsupported"}])},
        headers=headers,
    )
    assert upload_response.status_code == 400
    assert "Unsupported document type" in upload_response.json()["detail"]


def test_dashboard_endpoints_populate_metrics_and_aggregates():
    headers = get_admin_headers()

    first = client.post(
        "/sessions",
        json={
            "title": "Analytics One",
            "mode": "Practice",
            "duration_ms": 60000,
            "wpm_avg": 120,
            "filler_count": 2,
            "eye_contact_pct": 0.75,
            "transcript_segments": [{"start_ms": 0, "end_ms": 60000, "text": "Um hello world like today"}],
            "metrics": [
                {"t": 0, "wpm": 120, "rms": 50, "eye_contact": 0.75, "smile": 0.4, "yaw": 0.1, "pitch": 0.2, "roll": 0.1, "filler_count": 1, "pause_ms": 900}
            ],
        },
        headers=headers,
    )
    assert first.status_code == 200
    second = client.post(
        "/sessions",
        json={
            "title": "Analytics Two",
            "mode": "Practice",
            "duration_ms": 60000,
            "wpm_avg": 140,
            "filler_count": 0,
            "eye_contact_pct": 0.8,
            "transcript_segments": [{"start_ms": 0, "end_ms": 60000, "text": "First we improve outcomes"}],
            "metrics": [
                {"t": 0, "wpm": 140, "rms": 60, "eye_contact": 0.8, "smile": 0.5, "yaw": 0.1, "pitch": 0.1, "roll": 0.1, "filler_count": 0, "pause_ms": 700}
            ],
        },
        headers=headers,
    )
    assert second.status_code == 200

    overview = client.get("/dashboard/overview", headers=headers)
    assert overview.status_code == 200
    assert overview.json()["total_sessions"] >= 2
    assert overview.json()["recent_30d"]["avg_overall_score"] >= 0

    trends = client.get("/dashboard/trends/avg_overall_score", headers=headers)
    assert trends.status_code == 200
    assert len(trends.json()) >= 1

    sessions_response = client.get("/dashboard/sessions", headers=headers)
    assert sessions_response.status_code == 200
    assert any(item["session_id"] == second.json()["id"] for item in sessions_response.json())

    heatmap = client.get("/dashboard/heatmap", headers=headers)
    assert heatmap.status_code == 200
    assert heatmap.json()[-1]["count"] >= 1

    fillers = client.get("/dashboard/fillers", headers=headers)
    assert fillers.status_code == 200
    assert fillers.json()["um"] >= 1

    compare = client.get(
        f"/dashboard/compare?session_a={first.json()['id']}&session_b={second.json()['id']}",
        headers=headers,
    )
    assert compare.status_code == 200
    assert "overall_score" in compare.json()["comparison"]


def test_dashboard_is_user_scoped():
    headers = get_admin_headers()
    signup = client.post("/auth/signup", json={"email": "scoped@example.com", "password": "secret123"})
    assert signup.status_code == 200
    other_headers = {"Authorization": f"Bearer {signup.json()['access_token']}"}

    response = client.post(
        "/sessions",
        json={
            "title": "Private",
            "mode": "Practice",
            "duration_ms": 1000,
            "transcript_segments": [{"start_ms": 0, "end_ms": 1000, "text": "Private session"}],
            "metrics": [],
        },
        headers=headers,
    )
    assert response.status_code == 200

    other_sessions = client.get("/dashboard/sessions", headers=other_headers)
    assert other_sessions.status_code == 200
    assert all(item["session_id"] != response.json()["id"] for item in other_sessions.json())


def test_goal_crud_progress_and_user_scoping():
    headers = get_admin_headers()
    session_response = client.post(
        "/sessions",
        json={
            "title": "Goal baseline",
            "mode": "Practice",
            "duration_ms": 60000,
            "wpm_avg": 130,
            "transcript_segments": [{"start_ms": 0, "end_ms": 60000, "text": "A focused baseline session"}],
            "metrics": [],
        },
        headers=headers,
    )
    assert session_response.status_code == 200
    assert client.get("/dashboard/overview", headers=headers).status_code == 200
    create_response = client.post(
        "/dashboard/goals",
        json={
            "metric_name": "wpm",
            "comparison": "between",
            "target_value": 100,
            "target_upper": 160,
            "is_active": True,
        },
        headers=headers,
    )
    assert create_response.status_code == 201
    goal = create_response.json()
    assert goal["metric_name"] == "wpm"
    assert goal["current_value"] is not None
    assert goal["achieved"] is True

    duplicate = client.post(
        "/dashboard/goals",
        json={"metric_name": "wpm", "comparison": "gte", "target_value": 120},
        headers=headers,
    )
    assert duplicate.status_code == 409

    invalid_range = client.post(
        "/dashboard/goals",
        json={
            "metric_name": "overall_score",
            "comparison": "between",
            "target_value": 80,
            "target_upper": 70,
        },
        headers=headers,
    )
    assert invalid_range.status_code == 422

    update_response = client.patch(
        f"/dashboard/goals/{goal['id']}",
        json={"comparison": "gte", "target_value": 200, "is_active": False},
        headers=headers,
    )
    assert update_response.status_code == 200
    assert update_response.json()["target_upper"] is None
    assert update_response.json()["achieved"] is False
    assert update_response.json()["is_active"] is False

    signup = client.post("/auth/signup", json={"email": "goal-scoped@example.com", "password": "secret123"})
    assert signup.status_code == 200
    other_headers = {"Authorization": f"Bearer {signup.json()['access_token']}"}
    assert client.patch(f"/dashboard/goals/{goal['id']}", json={"is_active": True}, headers=other_headers).status_code == 404
    assert client.delete(f"/dashboard/goals/{goal['id']}", headers=other_headers).status_code == 404
    assert client.get("/dashboard/goals", headers=other_headers).json() == []

    delete_response = client.delete(f"/dashboard/goals/{goal['id']}", headers=headers)
    assert delete_response.status_code == 200
    assert delete_response.json()["status"] == "deleted"


def test_coaching_prompt_truncation_and_json_parsing():
    long_transcript = "word " * 5000
    prompt = build_coaching_prompt(
        long_transcript,
        {"wpm": 120, "overall_score": 70, "filler_breakdown": {"um": 2}},
        [],
        active_goals=[
            {
                "metric_name": "filler_rate",
                "comparison": "lte",
                "target_value": 1,
                "current_value": 2,
                "achieved": False,
            }
        ],
    )
    assert "filler_rate: target lte 1" in prompt
    assert "[transcript truncated]" in prompt

    parsed = parse_coaching_response(
        json.dumps(
            {
                "summary": "Good session.",
                "strengths": [{"area": "pace", "detail": "Steady"}],
                "improvements": [{"area": "fillers", "detail": "Pause more", "priority": "medium"}],
                "drills": [{"name": "Pause drill", "description": "Pause", "duration_minutes": 5}],
                "practice_plan": {"focus_areas": ["fillers"], "next_session_goal": "Use fewer fillers"},
            }
        )
    )
    assert parsed["summary"] == "Good session."


def test_coaching_worker_success_and_failure(monkeypatch):
    headers = get_admin_headers()
    response = client.post(
        "/sessions",
        json={
            "title": "Coach Me",
            "mode": "Practice",
            "duration_ms": 60000,
            "transcript_segments": [{"start_ms": 0, "end_ms": 60000, "text": "Hello coach"}],
            "metrics": [],
        },
        headers=headers,
    )
    session_id = response.json()["id"]

    def fake_generate(transcript, metrics, history, previous_feedback=None, active_goals=None):
        return {
            "summary": "Local feedback ready.",
            "strengths": [{"area": "clarity", "detail": "Clear opening"}],
            "improvements": [{"area": "pace", "detail": "Keep it steady", "priority": "low"}],
            "drills": [{"name": "Pace drill", "description": "Read for one minute"}],
            "practice_plan": {"focus_areas": ["pace"], "next_session_goal": "Stay near 140 WPM"},
            "raw_response": "{}",
            "model_used": "llama3.2:3b",
            "generation_time_ms": 10,
        }

    monkeypatch.setattr(worker_jobs, "generate_coaching_feedback", fake_generate)
    result = asyncio.run(worker_jobs.generate_session_coaching({}, session_id, 1))
    assert result["status"] == "completed"

    coaching_response = client.get(f"/coaching/session/{session_id}", headers=headers)
    assert coaching_response.status_code == 200
    assert coaching_response.json()["summary"] == "Local feedback ready."

    def fake_failure(transcript, metrics, history, previous_feedback=None, active_goals=None):
        raise RuntimeError("Ollama unavailable")

    monkeypatch.setattr(worker_jobs, "generate_coaching_feedback", fake_failure)
    failed = asyncio.run(worker_jobs.generate_session_coaching({}, session_id, 1))
    assert failed["status"] == "failed"
    failed_response = client.get(f"/coaching/session/{session_id}", headers=headers)
    assert failed_response.json()["status"] == "failed"
    assert "Ollama unavailable" in failed_response.json()["error_message"]


def test_coaching_retry_endpoint_queues_job(monkeypatch):
    headers = get_admin_headers()
    response = client.post(
        "/sessions",
        json={
            "title": "Retry Coach",
            "mode": "Practice",
            "duration_ms": 1000,
            "transcript_segments": [{"start_ms": 0, "end_ms": 1000, "text": "Retry coaching"}],
            "metrics": [],
        },
        headers=headers,
    )
    session_id = response.json()["id"]

    async def fake_enqueue(session_id_arg, user_id_arg):
        assert session_id_arg == session_id
        assert user_id_arg == 1
        return "job-coaching-1"

    monkeypatch.setattr(coaching_routes, "enqueue_coaching", fake_enqueue)
    retry = client.post(f"/coaching/session/{session_id}/retry", headers=headers)
    assert retry.status_code == 200
    assert retry.json() == {"status": "queued", "job_id": "job-coaching-1"}


def test_schema_upgrade_adds_document_columns(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    with engine.begin() as connection:
        connection.exec_driver_sql(
            """
            CREATE TABLE sessions (
                id INTEGER PRIMARY KEY,
                user_id INTEGER NOT NULL,
                title VARCHAR(255),
                mode VARCHAR(80),
                prompt TEXT,
                goal VARCHAR(255),
                started_at DATETIME,
                ended_at DATETIME,
                duration_ms INTEGER,
                wpm_avg FLOAT,
                filler_count INTEGER,
                eye_contact_pct FLOAT,
                video_path VARCHAR(1024),
                transcription_status VARCHAR(32),
                created_at DATETIME
            )
            """
        )

    monkeypatch.setattr(schema_upgrades, "engine", engine)
    schema_upgrades.apply_startup_schema_upgrades()

    columns = {column["name"] for column in inspect(engine).get_columns("sessions")}
    assert {"document_path", "document_name", "document_mime_type", "document_blocks_json"}.issubset(columns)
