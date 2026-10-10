# Local Machine Workflow

This is the recommended path for developing Speech-Machine on one machine with Docker Desktop.

## Prerequisites

- Docker Desktop running
- Node 20+ for local web checks
- Python environment at `~/venvs/mlx` for local API checks

Install dependencies:

```bash
cd /Users/susant-achary/dev_work/git_codes/c_base/Speech-Machine
make install
```

## Start The Stack

```bash
make local-up
```

This starts:

- Web: http://localhost:3000
- API: http://localhost:8000
- API docs: http://localhost:8000/docs
- Postgres: localhost:5432
- Redis: localhost:6379

On first launch, create the local admin account in the setup screen or run:

```bash
curl -X POST http://localhost:8000/setup \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"change-me-strong"}'
```

## Smoke Check

After the stack is running:

```bash
make local-smoke
```

## Local AI Coaching

The local feature build defaults to Ollama for AI coaching.

Start Ollama on the host machine:

```bash
ollama pull llama3.2:3b
ollama serve
```

The Docker stack reaches Ollama through:

```bash
OLLAMA_BASE_URL=http://host.docker.internal:11434
```

After a session transcription completes, the worker computes analytics and queues coaching feedback. If Ollama is not running, transcription still completes and the session coaching panel shows a retryable failure.

Override the setup/login account if needed:

```bash
make local-smoke ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='your-local-password'
```

## Common Commands

```bash
make local-build
make local-up
make logs
make down
make reset-local
```

`make reset-local` deletes local Docker volumes, including the database, Redis data, uploaded files, and downloaded models.

## Verification

```bash
make check
```

This runs the local web tests, shared TypeScript check, web lint/typecheck, API tests, API Ruff, API mypy, and Docker Compose config validation.

## Local Defaults

- `LOCAL_ONLY_MODE=true`
- `STORAGE_BACKEND=local`
- `WHISPER_MODEL=small`
- `WHISPER_DEVICE=cpu`
- `CORS_ORIGINS=http://localhost:3000`

The old fixed `admin/admin` login is not used. First-run setup creates the local admin account.
