# Pass B — Voice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hold-space → faster-whisper transcribes → the existing `/chat` loop runs → reply is shown and spoken, with the orb and waveform reacting live.

**Architecture:** A new backend `stt_service.py` wraps faster-whisper (model loaded once at startup); `POST /transcribe` turns a recorded audio blob into `{text}`. The frontend adds `lib/voice.ts` (record / transcribe / speak helpers) and a voice state machine in `page.tsx` that drives the existing `ZenithOrb` and `WaveformBar` through idle→listening→thinking→speaking and feeds the transcript into the existing `sendMessage`/`/chat` path.

**Tech Stack:** FastAPI, faster-whisper (CPU/int8), Next.js 14 client component, MediaRecorder + Web Audio AnalyserNode, browser SpeechSynthesis.

## Global Constraints

- STT default config (override via `.env` only, no code change): `WHISPER_MODEL=base`, `WHISPER_DEVICE=cpu`, `WHISPER_COMPUTE=int8`.
- Model loaded **once at startup**, never per request (mirror the Anthropic client singleton).
- No system ffmpeg dependency — faster-whisper's bundled PyAV decodes the webm/opus blob.
- TTS: browser `SpeechSynthesis`, lang `hi-IN`; degrade silently if unsupported.
- All M1 behavior preserved verbatim: 429 handling, `warning`, pending action → `StatusCard` → `/chat/confirm`, `refreshUsage`.
- Keys/config only via `.env` (never hardcoded). In-memory only.
- Browser-API code is verified by `tsc --noEmit` + the manual E2E checklist (Task 6) — no unit tests for `MediaRecorder`/`SpeechSynthesis`, consistent with how Pass A was verified.

---

### Task 1: Backend — `stt_service.py` (faster-whisper wrapper)

**Files:**
- Create: `backend/stt_service.py`
- Create: `backend/test_stt.py`
- Modify: `backend/requirements.txt`

**Interfaces:**
- Produces: `get_model() -> WhisperModel` (lazy, cached singleton); `transcribe_audio(data: bytes) -> str` (returns joined transcript, `""` on no speech).

- [ ] **Step 1: Add the dependency**

Edit `backend/requirements.txt`, add one line:

```
faster-whisper>=1.0.0
```

- [ ] **Step 2: Install deps + pytest (dev)**

Run:
```bash
cd ~/dev/Zenith/backend && ./.venv/bin/pip install -r requirements.txt && ./.venv/bin/pip install pytest
```
Expected: faster-whisper (+ ctranslate2, av, tokenizers) and pytest install successfully.

- [ ] **Step 3: Write the failing test**

Create `backend/test_stt.py`:

```python
import stt_service


class _Seg:
    def __init__(self, text):
        self.text = text


class _FakeModel:
    def __init__(self, segments):
        self._segments = segments

    def transcribe(self, audio, language=None, beam_size=1):
        return self._segments, None


def test_transcribe_joins_and_strips(monkeypatch):
    monkeypatch.setattr(stt_service, "get_model", lambda: _FakeModel([_Seg(" namaste "), _Seg("boss")]))
    assert stt_service.transcribe_audio(b"fake-bytes") == "namaste boss"


def test_transcribe_empty_returns_blank(monkeypatch):
    monkeypatch.setattr(stt_service, "get_model", lambda: _FakeModel([]))
    assert stt_service.transcribe_audio(b"fake-bytes") == ""
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd ~/dev/Zenith/backend && ./.venv/bin/python -m pytest test_stt.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'stt_service'`.

- [ ] **Step 5: Write the implementation**

Create `backend/stt_service.py`:

```python
"""Zenith — local speech-to-text via faster-whisper (Milestone 2, Pass B)."""

import io
import os
from functools import lru_cache

from dotenv import load_dotenv
from faster_whisper import WhisperModel

load_dotenv()

WHISPER_MODEL = os.getenv("WHISPER_MODEL", "base")
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE = os.getenv("WHISPER_COMPUTE", "int8")


@lru_cache(maxsize=1)
def get_model() -> WhisperModel:
    """Load the model once and cache it (warmed at app startup)."""
    return WhisperModel(WHISPER_MODEL, device=WHISPER_DEVICE, compute_type=WHISPER_COMPUTE)


def transcribe_audio(data: bytes) -> str:
    """Transcribe a recorded audio blob (webm/opus, wav, …) to text.

    Language is auto-detected (Hinglish-friendly). Returns "" when no speech."""
    segments, _info = get_model().transcribe(io.BytesIO(data), language=None, beam_size=1)
    return "".join(segment.text for segment in segments).strip()
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd ~/dev/Zenith/backend && ./.venv/bin/python -m pytest test_stt.py -v`
Expected: PASS — 2 passed.

- [ ] **Step 7: Commit**

```bash
cd ~/dev/Zenith && git add backend/stt_service.py backend/test_stt.py backend/requirements.txt
git commit -m "feat(backend): faster-whisper STT wrapper (stt_service)"
```

---

### Task 2: Backend — `POST /transcribe` + config

**Files:**
- Modify: `backend/main.py`
- Create: `backend/test_transcribe_route.py`
- Modify: `backend/.env.example`
- Modify: `README.md`

**Interfaces:**
- Consumes: `transcribe_audio` from Task 1; `get_model` (startup warm).
- Produces: `POST /transcribe` (multipart field `audio`) → `{"text": str}`; HTTP 500 `{detail}` on failure.

- [ ] **Step 1: Write the failing test**

Create `backend/test_transcribe_route.py`:

```python
from fastapi.testclient import TestClient

import main


def test_transcribe_route_returns_text(monkeypatch):
    monkeypatch.setattr(main, "transcribe_audio", lambda data: "kal ka schedule batao")
    client = TestClient(main.app)  # plain instance: lifespan/startup warm not triggered
    res = client.post("/transcribe", files={"audio": ("clip.webm", b"xxxx", "audio/webm")})
    assert res.status_code == 200
    assert res.json() == {"text": "kal ka schedule batao"}


def test_transcribe_route_handles_failure(monkeypatch):
    def boom(data):
        raise RuntimeError("decode error")

    monkeypatch.setattr(main, "transcribe_audio", boom)
    client = TestClient(main.app)
    res = client.post("/transcribe", files={"audio": ("clip.webm", b"xxxx", "audio/webm")})
    assert res.status_code == 500
    assert "Transcription failed" in res.json()["detail"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/dev/Zenith/backend && ./.venv/bin/python -m pytest test_transcribe_route.py -v`
Expected: FAIL — `404` (route missing) / `AttributeError: ... transcribe_audio`.

- [ ] **Step 3: Add the import + UploadFile to `main.py`**

In `backend/main.py`, change the FastAPI import line (currently `from fastapi import FastAPI, HTTPException`) to:

```python
from fastapi import FastAPI, File, HTTPException, UploadFile
```

And add to the imports block (next to `from claude_service import ...`):

```python
from stt_service import get_model, transcribe_audio
```

- [ ] **Step 4: Add the startup warm-up + route**

In `backend/main.py`, immediately after the `app.add_middleware(...)` CORS block, add:

```python
@app.on_event("startup")
def _warm_stt() -> None:
    """Load the whisper model once at boot so the first /transcribe is fast."""
    get_model()
```

And after the existing `/usage` route, add:

```python
@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)) -> dict:
    """Local STT: audio blob -> {text}. Not rate-limited (the /chat it triggers is)."""
    try:
        data = await audio.read()
        return {"text": transcribe_audio(data)}
    except Exception as exc:  # noqa: BLE001 — surface any decode/transcribe error
        raise HTTPException(status_code=500, detail=f"Transcription failed: {exc}") from exc
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd ~/dev/Zenith/backend && ./.venv/bin/python -m pytest test_transcribe_route.py -v`
Expected: PASS — 2 passed.

- [ ] **Step 6: Update config + docs**

Append to `backend/.env.example`:

```
# Speech-to-text (faster-whisper). base/cpu/int8 suits the 8GB Mac.
# Home rig with a GPU: WHISPER_MODEL=small, WHISPER_DEVICE=cuda, WHISPER_COMPUTE=float16
WHISPER_MODEL=base
WHISPER_DEVICE=cpu
WHISPER_COMPUTE=int8
```

In `README.md`, under the backend/run section, add a note:

```
Voice (Pass B): the first request loads the faster-whisper model
(~140MB for `base`, downloaded once to the HF cache). No ffmpeg needed —
faster-whisper bundles audio decoding. Tune via WHISPER_* in backend/.env.
```

- [ ] **Step 7: Smoke-test the real endpoint (model loads + plumbing works)**

Run (generates a 0.5s silent WAV and posts it — proves the real model loads and the route returns the `{text}` shape without a crash; transcript will be empty for silence):
```bash
cd ~/dev/Zenith/backend
./.venv/bin/python - <<'PY'
import io, wave, struct
buf = io.BytesIO()
with wave.open(buf, "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
    w.writeframes(struct.pack("<8000h", *([0] * 8000)))
open("/tmp/silent.wav", "wb").write(buf.getvalue())
print("wrote /tmp/silent.wav")
PY
# start the server in another terminal first:  ./.venv/bin/uvicorn main:app --port 8000
curl -s -F "audio=@/tmp/silent.wav;type=audio/wav" http://localhost:8000/transcribe
```
Expected: first call may take a few seconds (model load), returns JSON like `{"text":""}` (HTTP 200, no error).

- [ ] **Step 8: Commit**

```bash
cd ~/dev/Zenith && git add backend/main.py backend/test_transcribe_route.py backend/.env.example README.md
git commit -m "feat(backend): POST /transcribe + startup model warm-up + config"
```

---

### Task 3: Frontend — `lib/voice.ts` helpers

**Files:**
- Create: `frontend/lib/voice.ts`

**Interfaces:**
- Produces:
  - `type RecordingHandle = { stop: () => Promise<Blob>; getLevel: () => number }`
  - `startRecording(): Promise<RecordingHandle>`
  - `transcribe(blob: Blob): Promise<string>`
  - `speak(text: string, lang?: string): Promise<void>`
  - `cancelSpeech(): void`

- [ ] **Step 1: Write the implementation**

Create `frontend/lib/voice.ts`:

```typescript
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type RecordingHandle = {
  stop: () => Promise<Blob>;
  getLevel: () => number;
};

/** Start mic capture; returns a handle exposing a live 0–1 level and stop()->Blob. */
export async function startRecording(): Promise<RecordingHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";
  const recorder = new MediaRecorder(stream, { mimeType: mime });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioCtx = new Ctx();
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  const buf = new Uint8Array(analyser.frequencyBinCount);

  recorder.start();

  return {
    getLevel() {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      return Math.min(1, Math.sqrt(sum / buf.length) * 3); // RMS, scaled to ~0–1
    },
    stop() {
      return new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          void audioCtx.close();
          resolve(new Blob(chunks, { type: mime }));
        };
        recorder.stop();
      });
    },
  };
}

/** POST the recorded blob to the backend STT route; returns the transcript. */
export async function transcribe(blob: Blob): Promise<string> {
  const form = new FormData();
  form.append("audio", blob, "clip.webm");
  const res = await fetch(`${API_URL}/transcribe`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`transcribe failed (${res.status})`);
  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim();
}

/** Speak text via the browser. Resolves when done; no-op if unsupported. */
export function speak(text: string, lang = "hi-IN"): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window) || !text) {
      resolve();
      return;
    }
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = lang;
    utter.onend = () => resolve();
    utter.onerror = () => resolve();
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  });
}

export function cancelSpeech(): void {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}
```

- [ ] **Step 2: Type-check**

Run: `cd ~/dev/Zenith/frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd ~/dev/Zenith && git add frontend/lib/voice.ts
git commit -m "feat(frontend): voice helpers (record/transcribe/speak)"
```

---

### Task 4: Frontend — `WaveformBar` live level prop

**Files:**
- Modify: `frontend/components/WaveformBar.tsx`

**Interfaces:**
- Consumes: none.
- Produces: `WaveformBar({ active?: boolean; level?: number })` — `level` (0–1) boosts amplitude; `active` behavior unchanged.

- [ ] **Step 1: Edit the component**

Replace the signature + amplitude lines in `frontend/components/WaveformBar.tsx`. Change:

```typescript
export function WaveformBar({ active = false }: { active?: boolean }) {
  const W = 600;
  const mid = 30;
  const amp = active ? 16 : 6;
```

to:

```typescript
export function WaveformBar({ active = false, level = 0 }: { active?: boolean; level?: number }) {
  const W = 600;
  const mid = 30;
  const amp = (active ? 16 : 6) + level * 18; // live mic level boosts amplitude
```

(Leave the rest of the component unchanged.)

- [ ] **Step 2: Type-check**

Run: `cd ~/dev/Zenith/frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd ~/dev/Zenith && git add frontend/components/WaveformBar.tsx
git commit -m "feat(frontend): WaveformBar accepts live level prop"
```

---

### Task 5: Frontend — voice state machine, PTT + mic button in `page.tsx`

**Files:**
- Modify: `frontend/app/page.tsx`

**Interfaces:**
- Consumes: `startRecording`, `transcribe`, `speak`, `cancelSpeech`, `RecordingHandle` (Task 3); `WaveformBar` `level` (Task 4); existing `ZenithOrb`, `OrbState`, `sendMessage`, `applyData`.
- Produces: nothing downstream (terminal UI wiring).

- [ ] **Step 1: Update imports + refs**

In `frontend/app/page.tsx`, add to the React import (line 3) so it reads:

```typescript
import { useCallback, useEffect, useRef, useState } from "react";
```

Add a voice-helpers import next to the other component imports:

```typescript
import { startRecording, transcribe, speak, cancelSpeech, type RecordingHandle } from "../lib/voice";
```

- [ ] **Step 2: Replace `devState` with `voiceState` and add level/refs**

Replace this line:

```typescript
  const [devState, setDevState] = useState<OrbState>("idle");
```

with:

```typescript
  const [voiceState, setVoiceState] = useState<OrbState>("idle");
  const [level, setLevel] = useState(0);
  const recordingRef = useRef<RecordingHandle | null>(null);
  const rafRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
```

Replace the `orbState` derivation line:

```typescript
  // Pass A: orb shows "thinking" during a live request, else the dev-selected state.
  const orbState: OrbState = loading ? "thinking" : devState;
```

with:

```typescript
  // Pass B: live voice state wins; otherwise "thinking" while a request is in flight.
  const orbState: OrbState = voiceState !== "idle" ? voiceState : loading ? "thinking" : "idle";
```

- [ ] **Step 3: Refactor `sendMessage` to accept a transcript and return the reply**

Change the `sendMessage` signature line:

```typescript
  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;
```

to:

```typescript
  async function sendMessage(textArg?: string): Promise<string | null> {
    const text = (textArg ?? input).trim();
    if (!text || loading) return null;
```

Inside the same function, change the success line `applyData(await res.json());` to:

```typescript
      const data = await res.json();
      applyData(data);
      return data.reply ?? null;
```

Add `return null;` at the end of the 429 branch and the `!res.ok` branch (replace each `return;` inside those branches with `return null;`), and in the `catch` block change `setError("Can't reach Zenith's backend. Is it running on :8000?");` to be followed by `return null;`. The function must return `null` on every non-reply path.

- [ ] **Step 4: Add the voice flow functions**

Immediately after `sendMessage` (before `resolvePending`), add:

```typescript
  const startListening = useCallback(async () => {
    if (recordingRef.current || loading) return;
    cancelSpeech();
    setError(null);
    try {
      const handle = await startRecording();
      recordingRef.current = handle;
      setVoiceState("listening");
      const tick = () => {
        if (!recordingRef.current) return;
        setLevel(recordingRef.current.getLevel());
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      setError("Mic blocked — check browser permissions.");
      setVoiceState("idle");
    }
  }, [loading]);

  const stopListening = useCallback(async () => {
    const handle = recordingRef.current;
    if (!handle) return;
    recordingRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setLevel(0);
    setVoiceState("thinking");
    try {
      const blob = await handle.stop();
      const text = await transcribe(blob);
      if (!text) {
        setVoiceState("idle");
        return;
      }
      const reply = await sendMessage(text);
      if (reply) {
        setVoiceState("speaking");
        await speak(reply);
      }
    } catch {
      setError("Voice failed — could not transcribe. Is the backend running on :8000?");
    } finally {
      setVoiceState("idle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

- [ ] **Step 5: Add the push-to-talk (Space) effect**

After the existing usage-poll `useEffect`, add:

```typescript
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== "Space" || e.repeat) return;
      if (document.activeElement === inputRef.current) return; // typing a space
      e.preventDefault();
      void startListening();
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code !== "Space") return;
      if (document.activeElement === inputRef.current) return;
      void stopListening();
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [startListening, stopListening]);
```

- [ ] **Step 6: Wire the waveform level**

Change the WaveformBar usage line:

```typescript
          <WaveformBar active={orbState === "listening" || orbState === "speaking"} />
```

to:

```typescript
          <WaveformBar active={orbState === "listening" || orbState === "speaking"} level={level} />
```

- [ ] **Step 7: Replace the dev cycler with a mic button + ref the input**

Replace the dev-cycler block (the `<div className="flex items-center gap-1">` … `</div>` containing the `dev` label and the four `OrbState` buttons) with a mic button:

```typescript
          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              void startListening();
            }}
            onPointerUp={() => void stopListening()}
            onPointerLeave={() => {
              if (recordingRef.current) void stopListening();
            }}
            title="Hold to talk (or hold Space)"
            className={`rounded-lg border px-4 py-3 font-mono text-sm transition ${
              voiceState === "listening"
                ? "border-zenith-cyan bg-zenith-cyan/15 text-zenith-cyan"
                : "border-zenith-cyan/30 text-zenith-text/70 hover:border-zenith-cyan"
            }`}
          >
            {voiceState === "listening" ? "● REC" : "🎤"}
          </button>
```

Add the `ref` to the text input — change:

```typescript
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message…  (voice arrives in Pass B)"
```

to:

```typescript
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message…  (or hold Space to talk)"
```

Update the bottom-bar comment `{/* bottom bar: waveform + dev orb cycler + input */}` to `{/* bottom bar: waveform + mic (push-to-talk) + input */}`.

- [ ] **Step 8: Fix the `onClick={sendMessage}` type (now returns a Promise)**

Change the Send button handler:

```typescript
            onClick={sendMessage}
```

to:

```typescript
            onClick={() => void sendMessage()}
```

And the Enter handler inside `handleKeyDown` — change `sendMessage();` to `void sendMessage();`.

- [ ] **Step 9: Type-check**

Run: `cd ~/dev/Zenith/frontend && npx tsc --noEmit`
Expected: no errors. (If `OrbState` becomes an unused import, it is still used by `voiceState`/`orbState` typing — keep it.)

- [ ] **Step 10: Commit**

```bash
cd ~/dev/Zenith && git add frontend/app/page.tsx
git commit -m "feat(frontend): voice state machine, push-to-talk + mic button"
```

---

### Task 6: End-to-end verification (manual)

**Files:** none (verification only).

- [ ] **Step 1: Start both servers**

```bash
# terminal A
cd ~/dev/Zenith/backend && source .venv/bin/activate && uvicorn main:app --reload --port 8000
# terminal B
cd ~/dev/Zenith/frontend && npm run dev
```
Expected: backend logs the model load on first `/transcribe`; frontend compiles in seconds (now local, off iCloud).

- [ ] **Step 2: Walk the Pass B "done when" checklist** at http://localhost:3000

  1. Click into the page (not the text box). **Hold Space**, speak a Hinglish line ("kal ka schedule batao"), release.
  2. Transcript posts as your message; orb goes **idle → listening → thinking → speaking → idle**.
  3. Reply appears in chat **and is spoken** aloud.
  4. While holding Space, the **WaveformBar visibly reacts** to your voice.
  5. The **🎤 mic button** works as a press-and-hold alternative.
  6. Typing in the text box + Enter still works; pressing **space inside the text box types a space** (does not trigger recording).
  7. Trigger an action-tool reply → the **M1 confirm card (StatusCard)** still fires and `/chat/confirm` still works.
  8. Exhaust the rate limit (or simulate) → **429 still handled** gracefully via the voice path (error shown, orb returns to idle).

- [ ] **Step 3: Tag the milestone**

```bash
cd ~/dev/Zenith && git commit --allow-empty -m "test: Pass B voice E2E verified (hold-space STT -> /chat -> TTS)"
```

---

## Self-Review

**Spec coverage:**
- Backend `stt_service` (singleton, env config) → Task 1. ✓
- `POST /transcribe` ({text}, error, not rate-limited) + startup warm + `.env.example` + README → Task 2. ✓
- `lib/voice.ts` (startRecording+analyser, transcribe, speak, cancelSpeech) → Task 3. ✓
- WaveformBar `level` prop → Task 4. ✓
- Voice state machine, `sendMessage(textArg)` returning reply, orb derivation, PTT (space, input-focus guard, no auto-repeat), mic button, remove dev cycler → Task 5. ✓
- Error handling (mic denied, transcribe error, empty transcript, 429, TTS unsupported, pending card) → Task 5 functions + Task 6 checklist. ✓
- E2E "done when" → Task 6. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code or exact edits. ✓

**Type consistency:** `RecordingHandle.getLevel/stop`, `transcribe`, `speak`, `cancelSpeech` signatures match between Task 3 (definition) and Task 5 (use). `WaveformBar` `level` prop matches Task 4↔Task 5. `sendMessage(textArg?: string): Promise<string | null>` consistent across Task 5 steps 3–4 and the `void sendMessage()` call sites in step 8. `voiceState`/`OrbState` consistent. ✓
