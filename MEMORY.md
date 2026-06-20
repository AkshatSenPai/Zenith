# Zenith — MEMORY / State Log

Living handoff doc: where the project is *right now*, what shipped recently, and what's open.
For the full spec read **`CLAUDE.md`** (project context), **`JARVIS_PRD.md`** (PRD), and
**`TODO.md`** (task list). This file is the quick "catch me up" — update it at the end of a session.

_Last updated: 2026-06-20_

---

## What Zenith is
Full-stack personal AI desktop assistant (wake word "Zenith", internal codename JARVIS).
Stack: Next.js 14 + Tailwind · Python FastAPI · Claude (tool use) · faster-whisper STT (local) ·
edge-tts TTS · react-three-fiber orb. Phase 1 = personal daily driver. See `CLAUDE.md`.

## How to run (local)
- **Frontend:** `cd frontend && npm run dev` (Next.js). Expects the backend at `http://localhost:8000`.
  Don't `npm run build` while `dev` is live (desyncs `.next`).
- **Backend:** FastAPI app in `backend/main.py`, served on `:8000`. Routes: `/chat`, `/chat/confirm`,
  `/transcribe`, `/speak`, `/usage`, `/health` (whisper device/fallback diagnostics).
- Voice loop: mic → `/transcribe` (whisper, English default) → `/chat` (Claude + tools + confirm gate)
  → `/speak` (edge-tts MP3) → browser plays it.

## Current state (milestones)
- **M0 Vertical slice** ✅ · **M1 The Brain** ✅ (Claude tool-use, last-20 history, rate limit, confirm gate)
- **M2 HUD UI + voice** ✅ — app-style HUD, voice in/out, and the **v1.5 pass**:
  - Voice: STT defaults to **English** (Hinglish path dormant behind `WHISPER_LANGUAGE`); loud
    CUDA→CPU fallback + `GET /health`.
  - Orb: **WebGL particle sphere** (r3f) — see-through cyan cloud, glowing core, 4 connection nodes,
    audio-reactive; owner-approved.
  - **Command Center minimize/restore** (§3): ▾ collapses to a pill, orb grows; auto-restores on a
    new answer.
  - Panels still read mock data (`frontend/lib/mock.ts`) — not yet wired to live APIs. Tauri shell
    (`src-tauri/`) not scaffolded yet.
- **M3 Google** ⬜ NEXT — OAuth → Calendar + Gmail as tools → morning briefing (+ weather).
- M4 Messaging · M5 Hardening · M6 Memory vault + Copy Factory · M7 Proactivity — see `CLAUDE.md`.

## Open items / gotchas
- ⚠️ **Backend voice tests never run anywhere** — `backend/test_stt.py`, `backend/test_health_route.py`
  were written but never executed (dev shell lacks `faster_whisper`). Run `pytest backend/` on the
  **GPU desktop** before trusting the voice path.
- ⚠️ Confirm `npm install` pulled the r3f deps (`three`, `@react-three/fiber`, `drei`,
  `postprocessing`) before `npm run dev`.
- **GPU STT target:** `WHISPER_DEVICE=cuda WHISPER_MODEL=large-v3 WHISPER_COMPUTE=float16
  WHISPER_LANGUAGE=en`. Needs CUDA 12 + cuDNN (`nvidia-cublas-cu12` / `nvidia-cudnn-cu12`). Verify on
  `http://localhost:8000/health` (`device==cuda`, `fallback==false`).
- **Audio hardware note (2026-06-20):** mic/speaker weirdness was the **front-panel jacks** (flaky
  detection + crackle); the **rear motherboard jacks** fixed mic, output, and the crackle. Single-plug
  (TRRS) earphone on separate jacks needs a combo dongle or a CTIA splitter to do mic+audio at once.

## Recent sessions
- **2026-06-20** — Shipped v1.5 (voice English-default `f7c6d30`, particle orb `6e7b285`, docs
  `1e6bd5f`), tuned the orb to taste + fixed the square-border/node-clipping, built CC minimize/restore
  `12069af`. Resolved the front-panel-jack audio issue. Only TODO §4 (TTS backlog) remains.

## Next up
- **TODO §4 (backlog, not urgent):** TTS pre-fetch/stream to cut reply lag; evaluate Kokoro for
  offline TTS.
- **M3 Google integration** — the next real milestone (OAuth + Calendar/Gmail tools + morning briefing).
