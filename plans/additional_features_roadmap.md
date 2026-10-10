# Speech-Machine Additional Features Roadmap

## Objective

Evolve the existing local-first recording, transcription, analytics, and coaching workflow into a guided practice product while preserving private-by-default storage and offline-capable inference.

## Delivery order

### Phase 1 — Goals and adaptive practice

Status: implemented in the initial goals feature slice; deeper drill scheduling remains part of later iteration.

- Persist per-user goals for pace, fillers, score, practice frequency, duration, eye contact, and delivery.
- Expose authenticated goal CRUD APIs with computed current values and completion state.
- Add a dashboard goal manager and feed active goals into AI coaching prompts.
- Validate user scoping, goal ranges, comparison rules, empty states, and coaching prompt context.

### Phase 2 — Review and comparison

- Add a two-session comparison UI using the existing comparison API.
- Attach filler, pause, pace, and delivery observations to timestamps and allow playback seeking.
- Add user bookmarks, notes, and repeat-from-timestamp actions.

### Phase 3 — Guided practice modes

- Add persisted templates for interviews, presentations, sales pitches, debates, reading, and custom scenarios.
- Store mode-specific prompts, duration, scoring weights, and coaching instructions.
- Allow duplication of a prior session into a new targeted practice attempt.

### Phase 4 — Realtime and multilingual intelligence

- Add optional live pace, filler, silence, loudness, posture, and eye-contact cues.
- Add explicit language selection/detection and language-specific filler/scoring rules.
- Add editable transcripts, vocabulary hints, and re-analysis after edits.

### Phase 5 — Conversation intelligence

- Add speaker diarization, talk-time balance, interruptions, question/answer analysis, and turn-taking metrics.
- Keep multi-speaker processing optional because it increases model size and runtime requirements.

### Phase 6 — Product and platform expansion

- Add a prompt/document library, tags, folders, favorites, and controlled report sharing.
- Complete macOS application packaging and local data/model management.
- Add optional reminders and team workspaces only after defining explicit privacy and sharing controls.

## Cross-cutting engineering upgrades

- Validate coaching responses with typed schemas, retry malformed output, and provide deterministic fallback feedback.
- Add transcription/coaching progress, cancellation, idempotent retries, and failed-job visibility.
- Expand API and browser tests around authorization, analytics, coaching, migrations, exports, and deletion.
- Add production secret validation, TLS/reverse-proxy guidance, backups, retention controls, metrics, and alerting.
- Add accessibility, responsive recording, and Chrome/Edge/Safari compatibility checks.

## Phase 1 acceptance criteria

- Users can create, edit, activate/deactivate, and delete only their own goals.
- Invalid metric/comparison combinations return validation errors.
- Each goal reports a current value and whether it is currently achieved.
- The dashboard refreshes goal progress with the other analytics data.
- AI coaching receives active goal targets and asks for a measurable next-session action aligned to them.
- API and frontend tests cover the new contracts and user isolation.
