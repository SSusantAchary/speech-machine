from arq.connections import RedisSettings

from app.config import settings
from app.worker.jobs import generate_session_coaching, transcribe_recording


class WorkerSettings:
    functions = [transcribe_recording, generate_session_coaching]
    redis_settings = RedisSettings(host=settings.redis_host, port=settings.redis_port)
    max_jobs = 2
    job_timeout = 1800
    keep_result = 3600
    retry_jobs = True
    max_tries = 3
    health_check_interval = 30
