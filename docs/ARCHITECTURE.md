# Architecture

## System overview

Speech-Machine runs as a Next.js web app, a FastAPI API, PostgreSQL, Redis, and an arq worker.

```text
Browser -> Next.js web -> FastAPI API -> PostgreSQL
                              |
                              v
                            Redis -> arq worker -> ffmpeg/faster-whisper
                              |
                              v
                         local or S3 storage
```

## Request lifecycle

1. The browser records or uploads a video and creates a session through the API.
2. The API validates file size and magic bytes, stores the video, and marks transcription as queued.
3. The API enqueues `transcribe_recording` in Redis and returns a `job_id`.
4. The worker extracts audio, transcribes it, stores transcript segments, recomputes score data, and marks the session complete or failed.
5. The frontend polls the session and can also poll `/jobs/{job_id}` for background job state.

## Security boundaries

- First-run setup creates the admin account; there are no default `admin/admin` credentials.
- Access tokens are short-lived and stored in memory. Refresh tokens are HttpOnly cookies and are rotated on use.
- CORS is allowlisted through `CORS_ORIGINS`.
- Uploads are bounded by `MAX_UPLOAD_MB` and validated by content signature.
- Docker runs Alembic migrations before the API starts.
