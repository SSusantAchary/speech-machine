from fastapi import APIRouter, Depends
from fastapi import HTTPException

from app import models, schemas, transcription
from app.auth import get_current_user
from app.local_inference import check_engine, get_all_engine_statuses

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("/transcription", response_model=schemas.TranscriptionSettingsOut)
def get_transcription_settings(current_user: models.User = Depends(get_current_user)):
    return {
        "default_backend": transcription.get_default_transcription_backend(),
        "backends": transcription.get_transcription_backends(),
        "text_inference_engines": get_all_engine_statuses(),
    }


@router.post("/transcription/models/download", response_model=schemas.TranscriptionModelOut)
def download_transcription_model(
    payload: schemas.TranscriptionModelDownloadRequest,
    current_user: models.User = Depends(get_current_user),
):
    try:
        return transcription.download_transcription_model(payload.backend, payload.model)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/local-inference/check", response_model=schemas.InferenceEngineStatusOut)
def check_local_inference(
    payload: schemas.InferenceEngineCheckRequest,
    current_user: models.User = Depends(get_current_user),
):
    try:
        return check_engine(payload.engine_id, payload.base_url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
