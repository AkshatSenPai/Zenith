# Zenith — MEMORY / State Log

Living handoff doc: where the project is *right now*, what shipped recently, and what's open.
For the full spec read **`CLAUDE.md`** (project context), **`JARVIS_PRD.md`** (PRD), and
**`TODO.md`** (task list). This file is the quick "catch me up" — update it at the end of a session.

_Last updated: 2026-06-21_

---

## What Zenith is
Full-stack personal AI desktop assistant (wake word "Zenith", internal codename JARVIS).
Stack: Next.js 14 + Tailwind · Python FastAPI · Claude (tool use) · faster-whisper STT (local) ·
local Kokoro TTS (edge-tts fallback) · react-three-fiber orb · GSAP HUD motion. Phase 1 = personal
daily driver. See `CLAUDE.md`.

## How to run (local)
- **Frontend:** `cd frontend && npm run dev` (Next.js). Expects the backend at `http://localhost:8000`.
  Don't `npm run build` while `dev` is live (desyncs `.next`).
- **Backend:** FastAPI app in `backend/main.py`, served on `:8000`. Runs on the **Python 3.11**
  venv (`backend/.venv` — rebuilt for Kokoro; old 3.14 venv parked as `.venv314-bak`). Start:
  `backend/.venv/Scripts/python.exe -m uvicorn main:app --reload --port 8000`. Routes: `/chat`,
  `/chat/confirm`, `/transcribe`, `/speak`, `/usage`, `/health` (whisper + TTS engine diagnostics).
- Voice loop: mic → `/transcribe` (whisper, English default) → `/chat` (Claude + tools + confirm gate)
  → `/speak` (Kokoro WAV, local default / edge-tts MP3 fallback) → browser plays it.

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
  - **v1.6 — local voice (TTS):** **Kokoro** (hexgrad/Kokoro-82M) is now the default TTS engine
    (`ZENITH_TTS_ENGINE=kokoro`, voice `af_heart`, English; edge-tts kept as a one-flag fallback).
    Offline, CPU ~0.5× realtime (~1.4s short reply). `synthesize()` dispatches by engine →
    `(bytes, media_type)` (edge MP3 / Kokoro WAV); `/health` shows the active engine/voice.
    Backend venv **rebuilt on Python 3.11** (Kokoro's spacy/blis ship no 3.14 wheels). Verified
    end-to-end (direct synth + live `/speak`); 8/8 tts/speak/health tests pass.
  - **v1.7 — HUD motion (GSAP):** cinematic **boot screen** (`BootScreen.tsx`) on load — orb glyph
    fades in, boot log types out (honest: real `/health` ping + connection state), then dissolves to
    reveal the HUD mounted underneath. **State-word crossfade** (`StatusLabel.tsx`) for
    listening→thinking→speaking (was a hard swap); confirm card rises in. Skippable (click/key),
    reduced-motion aware; shared eases in `lib/anim.ts`. Deps `gsap` + `@gsap/react`. Shipped
    `fba67fc`, type-checks clean — **pending owner visual review + tweaks** (see Next up).
- **M3 Google** ⬜ NEXT — OAuth → Calendar + Gmail as tools → morning briefing (+ weather).
- M4 Messaging · M5 Hardening · M6 Memory vault + Copy Factory · M7 Proactivity — see `CLAUDE.md`.

## Open items / gotchas
- ⚠️ **STT tests still unrun** — `backend/test_stt.py`, `backend/test_transcribe_route.py` load the
  whisper model and haven't been executed. Run `pytest backend/` (the rebuilt 3.11 venv now has the
  deps). The TTS/speak/health tests (8) pass as of 2026-06-21.
- ⚠️ **STT not on the GPU** — `/health` shows whisper on `small`/`cpu` (the user's `.env` has no
  `WHISPER_DEVICE=cuda`). The voice TTS now runs locally; STT is still the slow CPU path. See the
  GPU STT target below to move whisper onto the RTX 5060.
- ⚠️ Confirm `npm install` pulled the r3f deps (`three`, `@react-three/fiber`, `drei`,
  `postprocessing`) before `npm run dev`.
- **GPU STT target:** `WHISPER_DEVICE=cuda WHISPER_MODEL=large-v3 WHISPER_COMPUTE=float16
  WHISPER_LANGUAGE=en`. Needs CUDA 12 + cuDNN (`nvidia-cublas-cu12` / `nvidia-cudnn-cu12`). Verify on
  `http://localhost:8000/health` (`device==cuda`, `fallback==false`).
- **Audio hardware note (2026-06-20):** mic/speaker weirdness was the **front-panel jacks** (flaky
  detection + crackle); the **rear motherboard jacks** fixed mic, output, and the crackle. Single-plug
  (TRRS) earphone on separate jacks needs a combo dongle or a CTIA splitter to do mic+audio at once.

## Recent sessions
- **2026-06-21** — v1.6 local voice: built the Kokoro TTS engine + switched the default to it
  (`d8926bf`, gitignore `5ae0ea0`). Rebuilt the backend venv on Python 3.11, picked `af_heart`,
  verified live `/speak`. Owner still to A/B the 3 voice samples in `backend/tts_samples/`. Then
  v1.7 HUD motion: GSAP cinematic boot screen + state-word crossfade (`fba67fc`) — built & committed
  but **owner hasn't seen it yet** (dev server needs a restart to pick up gsap); tweaks due tomorrow.
- **2026-06-20** — Shipped v1.5 (voice English-default `f7c6d30`, particle orb `6e7b285`, docs
  `1e6bd5f`), tuned the orb to taste + fixed the square-border/node-clipping, built CC minimize/restore
  `12069af`. Resolved the front-panel-jack audio issue. Only TODO §4 (TTS backlog) remains.

## Next up
- **▶ RESUME HERE — animations review (tomorrow):** the GSAP boot screen + label crossfade shipped
  (`fba67fc`) but the owner hasn't watched it yet. **First: restart `npm run dev`** (gsap was added
  while it was running, so the live server can't resolve it) then hard-refresh. Tweaks the owner
  flagged: boot length (~2.5s right?), once-per-session vs every-load, boot-log wording, label-
  crossfade intensity. View-to-view transitions not built yet (optional add).
- **Voice polish:** owner to pick a default voice from `backend/tts_samples/` (currently `af_heart`).
- **TODO §4 (backlog):** Kokoro offline TTS now **done**; remaining bit is TTS pre-fetch/stream to
  cut reply lag (Kokoro at ~0.5× realtime makes streaming-first-chunk a clean win).
- **STT on GPU:** move whisper to `cuda`/`large-v3` (RTX 5060) — set `WHISPER_*` in `.env`, verify on
  `/health`.
- **M3 Google integration** — the next real milestone (OAuth + Calendar/Gmail tools + morning briefing).
