# Desktop Packaging Path

This repo still supports a desktop-oriented runtime foundation, but Docker is the default and recommended path. The packaging target for the desktop foundation remains a future macOS `.app`, which can then be wrapped in a `.dmg`.

## Runtime split

Desktop mode runs the same product in three layers:

1. A local FastAPI process using SQLite and local file storage
2. A local Next.js standalone server
3. A native desktop shell, ideally Tauri, which opens the local web UI

The shell is not the product logic. It is only the native wrapper around the local web and API processes.

## MLX Audio runtime

Desktop ASR can use `mlx-audio` directly inside the local API process, but it is no longer the default path.

- Supported target: macOS on Apple Silicon
- Default desktop backend: `TRANSCRIPTION_BACKEND=server`
- Default MLX model: `mlx-community/parakeet-tdt-0.6b-v3`
- MLX models are downloaded manually from the app UI into the desktop app data directory through `huggingface_hub` if you explicitly switch to the `MLX Audio` backend

Docker and the Linux API container remain the primary supported runtime and use the server transcription backend.

## What is in the repo now

- `infra/scripts/desktop_api.py`
  Starts the API in desktop mode with:
  - SQLite in the user's application data directory
  - local recording storage in the same application data root
  - local-only auth enabled by default

- `infra/scripts/prepare_desktop_web.mjs`
  Prepares the Next standalone output for local desktop serving by copying static and public assets into the standalone bundle.

- `infra/scripts/desktop_web.mjs`
  Runs the prepared standalone Next server against the local desktop API.

- `infra/scripts/desktop_runtime.mjs`
  Orchestrates both desktop processes together.

- `apps/api/requirements-desktop.txt`
  Desktop runtime dependencies without the Postgres-specific dependency chain.

## Local desktop runtime

Docker remains the recommended way to run the app:

```bash
cd video_record
docker compose up --build
```

Use the desktop runtime only if you specifically need the local standalone workflow.

Build the desktop-ready web bundle:

```bash
cd video_record
npm run desktop:build:web
```

Start the desktop API only:

```bash
cd video_record
python3 -m venv .venv-desktop
source .venv-desktop/bin/activate
pip install -r apps/api/requirements-desktop.txt
npm run desktop:start:api
```

Start the prepared standalone web bundle:

```bash
cd video_record
npm run desktop:start:web
```

Or run both together after the API environment is installed:

```bash
cd video_record
npm run desktop:start
```

## Desktop data location

Desktop mode writes to the per-user application data directory:

- macOS: `~/Library/Application Support/Speech-Machine`
- Windows: `%APPDATA%\\Speech-Machine`
- Linux: `$XDG_DATA_HOME/sparks-coach` or `~/.local/share/sparks-coach`

Inside that directory:

- `data/video_coach.db`
- `storage/`
- `models/hf/<sanitized-repo-id>/`

Downloaded MLX Audio models are not stored in the global Hugging Face cache for the app flow. The app keeps its own local model snapshots under `models/hf/`, and the MLX backend only treats a model as available after a successful app-managed download.

## Environment overrides

You can seed desktop settings from `.env.desktop.example`.

Useful variables:

- `TRANSCRIPTION_BACKEND`
- `DESKTOP_API_PORT`
- `DESKTOP_WEB_PORT`
- `NEXT_PUBLIC_API_URL`
- `LOCAL_ADMIN_EMAIL`
- `LOCAL_ADMIN_PASSWORD`
- `WHISPER_MODEL`
- `WHISPER_DEVICE`
- `MLX_AUDIO_MODEL`

## Next packaging step

The remaining step to reach a real `.dmg` is a native shell that launches these two local runtimes and packages them as a Mac app bundle.

Recommended implementation:

1. Freeze the desktop API launcher into a bundled sidecar binary
2. Bundle the standalone web server with its Node runtime
3. Add a Tauri shell that starts both sidecars on launch
4. Sign and notarize the generated `.app`
5. Wrap the `.app` in a `.dmg`

This keeps the existing product code mostly intact while moving the installer experience to a proper desktop model.
