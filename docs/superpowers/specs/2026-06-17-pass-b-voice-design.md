# Zenith — Pass B: Voice (design spec)

> Date: 2026-06-17. Builds on Milestone 2 Pass A (HUD shell, mock panels, `/usage`, orb states, waveform). Extends the existing M1 `/chat` loop — rebuilds nothing.
>
> **Goal:** Hold-space → speak → faster-whisper transcribes → the *existing* `/chat` loop runs → reply is shown **and spoken**, with the orb and waveform reacting live.

## Decisions (resolved during brainstorming)

- **Test target:** build and verify end-to-end on the current 8GB Intel MacBook now.
- **STT model:** `faster-whisper`, default `WHISPER_MODEL=base`, `WHISPER_DEVICE=cpu`, `WHISPER_COMPUTE=int8`. Home rig (32GB + GPU) overrides to `small`/`cuda`/`float16` via `.env` only — no code change.
- **Audio decode:** faster-whisper bundles PyAV, which decodes the MediaRecorder webm/opus blob. **No system ffmpeg install required.**
- **TTS:** browser `SpeechSynthesis`, lang `hi-IN`. Accepted as the starting voice; swap to Piper/cloud later if Hinglish quality is poor. Degrades silently where unsupported.
- **Activation:** push-to-talk (hold SPACE) + a click mic button. No wake word, no always-listening (later milestone).

## Architecture

```
[mic] --getUserMedia--> MediaRecorder --webm/opus blob--> POST /transcribe (faster-whisper)
                              |                                   |
                          AnalyserNode                         { text }
                              |                                   |
                        WaveformBar(level)              sendMessage(text)  ── existing M1 path ──> /chat
                                                                                                     |
                                            speak(reply) <── reply text ────────────────────────────┘
```

Voice state machine drives both the orb and the waveform:
`idle → listening → thinking → speaking → idle`.

## Backend

### `backend/stt_service.py`
- Module-level singleton: load `WhisperModel(WHISPER_MODEL, device=WHISPER_DEVICE, compute_type=WHISPER_COMPUTE)` **once at import/startup** (same pattern as the Anthropic client). First run downloads the model (~140MB for `base`).
- `transcribe_audio(data: bytes) -> str`: feed the bytes to faster-whisper (via a temp file or in-memory stream), `language=None` (auto-detect, for Hinglish), join segment texts, strip. Return `""` on no speech.

### `POST /transcribe` (in `main.py`)
- Accept `UploadFile` (field name `audio`). Read bytes → `transcribe_audio` → return `{ "text": <str> }`.
- Errors → HTTP 500 with a short `detail`. Empty speech → `{ "text": "" }` (HTTP 200).
- **Not** rate-limited by the M1 limiter (transcription is local/free); the downstream `/chat` call it triggers is still limited as today.

### Config / deps
- `requirements.txt`: add `faster-whisper>=1.0`.
- `.env.example`: add `WHISPER_MODEL=base`, `WHISPER_DEVICE=cpu`, `WHISPER_COMPUTE=int8`.
- `README.md`: note first-run model download; no ffmpeg needed.

## Frontend

### `frontend/lib/voice.ts` (framework-agnostic helpers)
- `startRecording(): Promise<RecordingHandle>` — `getUserMedia({audio:true})` → `MediaRecorder` (prefer `audio/webm;codecs=opus`). Builds a Web Audio `AnalyserNode` on the same stream. Handle exposes:
  - `stop(): Promise<Blob>` — stops recorder + tracks, resolves the recorded blob.
  - `getLevel(): number` — current 0–1 RMS/peak from the analyser (called via rAF by the component).
- `transcribe(blob: Blob): Promise<string>` — POST multipart to `${API_URL}/transcribe`, return `text`.
- `speak(text: string, lang = "hi-IN"): Promise<void>` — `SpeechSynthesis`; resolves on `end`/`error`. No-op if `window.speechSynthesis` absent.
- `cancelSpeech(): void` — `speechSynthesis.cancel()`.

### `frontend/app/page.tsx` (extend; preserve all M1 logic)
- Refactor `sendMessage` → `sendMessage(textArg?: string): Promise<string | null>`: uses `textArg ?? input`, returns the assistant reply string (or null) so the voice flow can speak it. All existing behavior (429, error, warning, pending/StatusCard, `applyData`, `refreshUsage`) unchanged for the typed path.
- Add `voiceState: "idle" | "listening" | "thinking" | "speaking"` (replaces the Pass-A `devState` + dev cycler).
- `orbState` derivation: `voiceState !== "idle" ? voiceState : (loading ? "thinking" : "idle")`.
- **Push-to-talk handler** (window keydown/keyup):
  - Trigger only when `event.code === "Space"` **and** the text input is **not** focused (so typing a space still types). Ignore auto-repeat (`event.repeat`).
  - keydown → `voiceState=listening`, `startRecording()`, start rAF loop feeding `WaveformBar` level.
  - keyup → `stop()` → blob → `voiceState=thinking` → `transcribe(blob)`; if text non-empty → `sendMessage(text)` → on reply `voiceState=speaking` + `speak(reply)` → on end `voiceState=idle`. Empty text → straight back to `idle`.
- **Mic button** in the bottom bar mirrors PTT for click/touch (press-and-hold or toggle), with a "listening… release to send" hint while active.

### `frontend/components/WaveformBar.tsx`
- Add optional numeric `level` prop (0–1); keep existing `active` boolean working. While listening, amplitude follows live `level`; while speaking, a gentle synthetic pulse; idle = current subtle motion. Respects `prefers-reduced-motion`.

## Error handling

| Case | Behavior |
|---|---|
| Mic permission denied / no device | Inline status ("Mic blocked — check browser permissions"), `voiceState=idle`. |
| `/transcribe` HTTP error | Inline error, `voiceState=idle`, nothing sent to `/chat`. |
| Empty transcript | Silently return to `idle`, no message posted. |
| `/chat` 429 / server error | Flows through existing `sendMessage` handling unchanged; `voiceState=idle`. |
| TTS unsupported | Skip speaking, still show the reply text. |
| Action tool reply (pending) | M1 confirm card (StatusCard) fires exactly as today; not auto-spoken beyond the reply text. |

## Verification — Pass B done when
1. Hold SPACE (input unfocused) → speak → release.
2. Transcript posts as the user message; the orb goes `idle → listening → thinking → speaking → idle`.
3. Reply is shown in chat **and spoken** via TTS.
4. WaveformBar visibly reacts to mic input while listening.
5. Mic button works as a click alternative; typing + Enter still works; pressing space in the text field still types a space.
6. An action-tool prompt still raises the M1 confirm card and `/chat/confirm` still works.
7. Rate-limit (429) still handled gracefully via the voice path.
8. `tsc --noEmit` clean; dev compile renders.

## Out of scope (unchanged from milestone-2 plan)
Wake-word / always-listening; Tauri mic config; Piper / cloud TTS; streaming STT; real Gmail/Calendar/WhatsApp/Discord integrations; persistence; settings/auth.
