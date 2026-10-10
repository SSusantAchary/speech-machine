![Speech-Machine Banner](./Speech_Machine_Banner.png)

# Speech-Machine

Speech-Machine is an AI-assisted speech practice and review platform for recorded sessions, uploaded videos, transcripts, delivery analytics, and guided reading practice.

## Sample UI

Below is a sample Speech-Machine screen showing the product layout and session statistics view.

![Speech-Machine Sample UI](./Screenshot_Speech_Machine.png)

## What It Does

- Records practice videos in the browser with camera and microphone selection.
- Uploads existing videos for asynchronous transcription and review.
- Downloads transcript output as `.txt` and `.pdf`.
- Saves full practice sessions with score, transcript, metrics, and review data.
- Restores unsaved recording drafts from browser storage after refresh.
- Tracks realtime speaking cues such as words per minute, filler words, pauses, and rolling captions.
- Tracks delivery signals such as eye contact, smile, loudness, and head movement.
- Supports a scrollable reading document panel during recording for `.pdf` and `.txt` files.
- Highlights the current reading block during recording using live browser speech cues when supported.
- Exports complete session bundles and supports video-only delete or full session delete.
- Supports first-run local admin setup and email/password authentication.

## Core Capabilities

### Recording and review

- Browser-based recording with MediaRecorder
- Realtime preview and review playback
- Draft recovery for unsaved recordings
- Session comparison and score breakdown
- Timeline markers for speaking issues and improvement points

### Speech analysis

- Final server-side transcription
- Realtime browser speech cues where the Web Speech API is available
- Average and realtime WPM
- Filler-word detection
- Long-pause and silence detection
- Transcript search and filler highlighting

### Delivery analysis

- Eye-contact estimation using MediaPipe face landmarks
- Smile and head stability metrics
- Loudness tracking from the audio stream
- Composite scoring across delivery, speech, and content

### Guided reading

- Upload a reading document during recording
- Supported input: `.pdf`, `.txt`
- Vertical teleprompter-style reading panel below the recorder
- Live paragraph highlighting based on current spoken content when browser speech recognition is available

## Platform Compatibility

### Primary supported runtime

The primary supported runtime is the Docker stack.

| Platform | Status | Notes |
| --- | --- | --- |
| macOS | Supported | Best overall local development path with Docker Desktop |
| Linux | Supported | Good fit for local and server deployment |
| Windows | Supported | Use Docker Desktop; WSL2-backed setups are recommended |

### Browser compatibility

| Browser | Recording | Realtime speech cues | Notes |
| --- | --- | --- | --- |
| Chrome | Supported | Best support | Recommended browser |
| Edge | Supported | Good support | Recommended browser |
| Safari | Supported | Limited / browser-dependent | Recording path includes Safari-specific handling; Web Speech API support may be unavailable |
| Firefox | Partial | Limited | Core UI works, but speech-recognition behavior depends on browser capabilities |

### Desktop runtime note

The repo also contains a desktop-oriented runtime foundation, but the default and recommended deployment path is still Docker. Optional `MLX Audio` support is macOS Apple Silicon oriented.

## Minimum System Requirements

These are practical minimums for local Docker usage, not hard-enforced limits.

| Requirement | Minimum | Recommended |
| --- | --- | --- |
| CPU | 4 logical cores | 8 logical cores |
| Memory | 8 GB RAM | 16 GB RAM |
| Free disk | 10 GB | 20+ GB, especially when downloading transcription models |
| Browser | Modern Chromium / Safari | Latest Chrome or Edge |
| Camera / Mic | Required for recording mode | External mic recommended for better transcription quality |
| Docker | Docker Desktop or Docker Engine + Compose | Latest stable |

Notes:
- Larger Whisper models need more RAM, disk, and transcription time.
- GPU is optional. CPU-only operation is supported.
- If you plan to keep multiple downloaded models locally, reserve additional disk space.

## Supported Transcription Models

### Docker / server backend

The default backend is the built-in server backend using `faster-whisper==1.1.0`. Models are downloaded only when the user explicitly chooses `Download` in the UI.

- `openai/whisper-tiny`
- `openai/whisper-base`
- `openai/whisper-small`
- `openai/whisper-medium`
- `openai/whisper-large-v3`
- `openai/whisper-large-v3-turbo`

### Optional MLX Audio backend

Available only in the optional desktop-oriented path when `mlx-audio` is installed and the runtime is compatible.

- `mlx-community/whisper-large-v3-turbo-asr-fp16`
- `distil-whisper/distil-large-v3`
- `mlx-community/Qwen3-ASR-1.7B-8bit`
- `mlx-community/Qwen3-ForcedAligner-0.6B-8bit`
- `mlx-community/parakeet-tdt-0.6b-v3`
- `mlx-community/Voxtral-Mini-3B-2507-bf16`
- `mlx-community/Voxtral-Mini-4B-Realtime-2602-4bit`
- `mlx-community/Voxtral-Mini-4B-Realtime-2602-fp16`
- `mlx-community/VibeVoice-ASR-bf16`

## Latency Characteristics

Speech-Machine does not ship a formal benchmark suite yet, so latency depends on browser, host CPU/GPU, selected model, and recording length.

| Workflow | Expected behavior |
| --- | --- |
| Live recorder metrics | Near realtime in the browser |
| Live face / delivery metrics | Near realtime on modern hardware |
| Save session | Usually seconds, depending on file size and storage |
| Final transcription | Seconds to minutes depending on video duration and model size |
| Model download | One-time per model; depends on model size and network speed |

Practical guidance:
- `Whisper Tiny` and `Whisper Base` are the fastest options.
- `Whisper Small` is a good default balance for local CPU usage.
- `Whisper Medium`, `Large v3`, and `Large v3 Turbo` need more memory and longer completion time.

## Tech Stack

### Frontend

- Next.js 14 App Router
- React 18
- TypeScript
- Tailwind CSS
- Zustand
- Recharts
- `idb` for IndexedDB draft persistence
- `pdfjs-dist` for PDF text extraction
- MediaPipe Tasks Vision
- Web Audio API
- Web Speech API

### Backend

- FastAPI
- SQLAlchemy
- PostgreSQL in Docker
- SQLite in desktop-oriented local runtime mode
- JWT authentication
- Local file storage with optional S3-compatible storage
- `ffmpeg` for audio extraction
- `faster-whisper==1.1.0`
- Optional `mlx-audio`
- `huggingface_hub` for on-demand local model downloads

### Tooling

- Docker Compose
- Vitest
- Playwright
- Pytest
- Make

## Repository Layout

- `apps/web`: Next.js frontend
- `apps/api`: FastAPI backend
- `packages/shared`: shared types and scoring logic
- `infra`: desktop runtime helpers
- `docs`: packaging and supporting documentation

## Quick Start

### Recommended: Docker

```bash
cp .env.example .env
make local-up
```

Open:

- App: `http://localhost:3000`
- API docs: `http://localhost:8000/docs`

On first launch, open the app and create the local admin account in the setup screen.

You can also create the first local admin from the terminal:

```bash
curl -X POST http://localhost:8000/setup \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"change-me-strong"}'
```

Then run a local smoke check:

```bash
make local-smoke
```

See [docs/local-machine.md](./docs/local-machine.md) for the full local workflow.

### Local development without Docker

#### API

```bash
cd apps/api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

#### Web

```bash
cd apps/web
npm install
npm run dev
```

## Build and Test

```bash
make local-build
```

```bash
make check
```

## Lines of Code

Source snapshot as of March 22, 2026, excluding `node_modules`, `.next`, caches, and lockfiles:

| Area | Files | Approx. LOC |
| --- | --- | --- |
| API | 17 | 2,370 |
| Web | 36 | 4,444 |
| Shared | 4 | 290 |
| Infra | 4 | 263 |
| Total app source | 61 | 7,367 |



## Current Feature Set

- Browser recording and uploaded-video transcription
- Transcript download in `.txt` and `.pdf`
- Session export bundle
- Session comparison
- Full session delete and video-only delete
- Reading-document upload and guided reading panel
- Draft recovery
- Model download-on-demand from the UI
- User-defined practice goals with live progress and goal-aware AI coaching
- Docker-first local deployment

## Planned / Upcoming Upgrades

- Better progress reporting for long model downloads
- Broader browser support around live speech cues
- Stronger progress reporting for queued transcription workloads
- More production deployment presets
- Native desktop shell packaging
- Stronger benchmarking and latency reporting
- Richer document guidance and reading analytics

## License

This project is licensed under the Apache License 2.0.

High-level summary:
- You may use, modify, and distribute the software.
- You must preserve copyright and license notices.
- Changes should be documented when redistributing modified versions.
- The software is provided on an “AS IS” basis without warranties.

See [LICENSE](./LICENSE) for the full license text.

## Developer

Developed by **Susant Achary**.
