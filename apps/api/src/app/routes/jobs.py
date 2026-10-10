from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.worker.enqueue import get_job_status

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.get("/{job_id}")
async def job_status(job_id: str, _user=Depends(get_current_user)):
    try:
        return await get_job_status(job_id)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Job backend unavailable") from exc
