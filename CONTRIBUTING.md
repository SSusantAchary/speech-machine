# Contributing to Speech-Machine

## Development setup

1. Copy `.env.example` to `.env`.
2. Set `JWT_SECRET` to a generated secret.
3. Run `docker compose up --build`.
4. Open `http://localhost:3000` and complete first-run setup.

## Tests

```bash
npm --workspace apps/web test -- --run
npm --workspace packages/shared exec tsc -- --noEmit
cd apps/api && PYTHONPATH=src pytest -q
```

## Code style

- Frontend: `npm --workspace apps/web run lint`.
- Backend: `cd apps/api && ruff check .`.
- Keep API route prefixes stable unless a migration plan is included.

## Pull requests

Use a branch from `main`, include tests for behavior changes, and verify Docker still builds.
