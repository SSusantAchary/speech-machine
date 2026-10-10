# Test Steps

## 1) Prereqs
- Docker Desktop running
- Node 20+ and `~/venvs/mlx` with API dependencies installed if running tests outside Docker

## 2) Start the stack
```bash
cd /Users/susant-achary/dev_work/git_codes/c_base/Speech-Machine
make local-up
```

## 3) Open the app
- Web: http://localhost:3000
- API: http://localhost:8000
- API docs: http://localhost:8000/docs

## 4) First-run setup
On a fresh local database, create the local admin account:

```bash
curl -X POST http://localhost:8000/setup \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"change-me-strong"}'
```

Then sign in with:

- Email: `admin@example.com`
- Password: `change-me-strong`

You can also run the scripted local smoke check:

```bash
make local-smoke
```

## 5) Smoke test (manual)
1. Sign in with the local admin account.
2. Go to /record and allow camera/mic permissions.
3. Click the record button, speak for 10+ seconds, then stop.
4. Click "Save session" and wait for redirect to /session/:id.
5. Confirm playback, transcript, score, and timeline markers render.
6. Click transcription and confirm the job queues, then poll until the session status updates.

## 6) Frontend unit tests
```bash
cd /Users/susant-achary/dev_work/git_codes/c_base/Speech-Machine
make test-web
```

## 7) Frontend e2e tests (Playwright)
```bash
cd /Users/susant-achary/dev_work/git_codes/c_base/Speech-Machine/apps/web
npm run test:e2e
```

## 8) Backend tests
```bash
cd /Users/susant-achary/dev_work/git_codes/c_base/Speech-Machine
make test-api
```

## 9) Local reset
This deletes the local Docker database, Redis data, uploaded files, and downloaded models:

```bash
make reset-local
```

## 10) Troubleshooting
- If camera/mic fails, check browser permissions and reload /record.
- If transcription fails, verify ffmpeg is available in the API container and the Whisper model downloads.
- If the API is unreachable, confirm docker compose logs for the api service.
- If login fails and setup already ran, reset local volumes or use the account created during setup.
