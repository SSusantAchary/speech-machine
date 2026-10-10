from app.config import settings

_pool = None


async def get_arq_pool():
    global _pool
    if _pool is None:
        from arq.connections import RedisSettings, create_pool

        _pool = await create_pool(
            RedisSettings(host=settings.redis_host, port=settings.redis_port)
        )
    return _pool


async def enqueue_transcription(
    session_id: int,
    user_id: int,
    model_name: str | None,
    backend_id: str | None,
) -> str:
    pool = await get_arq_pool()
    job = await pool.enqueue_job(
        "transcribe_recording",
        session_id,
        user_id,
        model_name,
        backend_id,
    )
    if job is None:
        raise RuntimeError("Failed to enqueue transcription job")
    return job.job_id


async def enqueue_coaching(session_id: int, user_id: int) -> str:
    pool = await get_arq_pool()
    job = await pool.enqueue_job("generate_session_coaching", session_id, user_id)
    if job is None:
        raise RuntimeError("Failed to enqueue coaching job")
    return job.job_id


async def get_job_status(job_id: str) -> dict:
    pool = await get_arq_pool()
    from arq.jobs import Job

    job = Job(job_id, pool)
    info = await job.info()
    if info is None:
        return {"status": "pending", "result": None, "error": None}
    status_value = info.status.value if info.status else "unknown"
    return {
        "status": status_value,
        "result": info.result if info.success else None,
        "error": str(info.result) if not info.success and info.result else None,
    }
