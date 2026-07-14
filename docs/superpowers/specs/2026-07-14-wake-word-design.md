# Wake word "Zenith" — design spec

**Date:** 2026-07-14
**Status:** Approved (brainstorming complete) — ready for implementation plan
**Milestone:** The marquee Phase-1 capability, unblocked by the Tauri desktop shell (M2). Adds
always-listening voice activation on top of the existing hold-Space push-to-talk loop.

---

## 1. What this is

Today Zenith activates by **holding Space** (`page.tsx` → `startListening` on keydown, `stopListening`
on keyup → `startRecording` → `/transcribe` → `sendMessage` → `/speak`). This feature adds a
**hands-free trigger**: say **"Zenith"** and the same loop runs, no key. Detection is **on-device**
(Porcupine WASM in the webview), so nothing leaves the machine until you actually speak a command —
which is then transcribed locally by faster-whisper, exactly as today.

Because there is no Space to release, this feature introduces the one thing PTT never needed:
**automatic end-of-speech detection** (an energy-based silence endpointer).

**Scope is the activation path only.** Everything else the always-on host eventually enables —
system tray, global push-to-talk hotkey, autostart-on-login, and the background proactivity watcher —
is a **separate TODO item and out of scope here.**

## 2. Locked decisions

| Decision | Choice | Why |
|---|---|---|
| **Engine** | **Porcupine Web** (`@picovoice/porcupine-web` + `@picovoice/web-voice-processor`) — WASM in the webview. | The mic already lives in the webview (getUserMedia + the record loop). Running detection there = one mic owner, a clean handoff to `startListening`, very low CPU, robust, low false-positives. openWakeWord is the Phase-2 fully-open swap (see §11). |
| **Endpointing** | **Energy-based silence**, reusing the analyser level `startRecording()` already exposes. | Stop after ~1.2s of silence (0.5s floor, 10s hard cap). Zero new deps; thresholds tunable. Silero VAD is a later upgrade if a noisy room fools it. |
| **Default state** | **On by default**, persisted; a visible indicator + one-click mute. | It's the owner's personal daily driver and the whole point is hands-free. Muting **fully releases the mic** (real off, not just ignored). |
| **Keyword (v1)** | **"Zenith" only.** | `"Hey Zenith"` is a trivial second-keyword add (one more `.ppn`) held in reserve for if single-word false-triggers show up in real use. YAGNI. |
| **AccessKey** | Backend **`.env` `PICOVOICE_ACCESS_KEY`**, served to the webview via an **auth-gated `GET /wakeword/config`** route. | The repo is public — the key must not be bundled/committed. The `.ppn` keyword model **is** committed (it's a model, not a secret). Unset key → wake word disables gracefully, PTT still works. |
| **Mic sharing** | **Pause the detector during command capture, resume after.** | Avoids two simultaneous mic streams (Porcupine's WebVoiceProcessor + MediaRecorder). Exact release/re-subscribe mechanism confirmed against the SDK at plan time. |

## 3. Architecture & flow

```
webview (Tauri or browser)                                         backend (UNCHANGED)
  Porcupine WASM ── listens on mic ──▶ "Zenith" detected
        │                                   │
        │                                   ├─ 1. wake chime (WebAudio beep) + orb "listening" cue
        │                                   ├─ 2. barge-in: cancelSpeech()
        │                                   ├─ 3. pause detector, startListening()  ── existing ──▶ startRecording()
        │                                   ├─ 4. energy endpointer watches getLevel():
        │                                   │        ≥1.2s silence (0.5s floor, 10s cap) → stopListening()
        │                                   │                                     └─▶ /transcribe → sendMessage → /speak
        │                                   └─ 5. resume detector
        ▼
  GET /wakeword/config (auth) ──▶ { access_key, sensitivity }   [only new backend surface]
```

**No changes to the chat loop, tools, confirm gate, or the voice endpoints.** The wake path reuses
`startListening`/`stopListening` verbatim; the only new backend surface is the config route that hands
the AccessKey to the webview.

**Window focus:** getUserMedia + the WebVoiceProcessor keep running while the HUD window is unfocused
or minimized (as long as it isn't closed), so "Zenith" works "in the background" of the running app.
True closed-app/background listening needs the tray — out of scope.

## 4. Engine — `frontend/lib/wakeword.ts`

A small module owning the Porcupine lifecycle. Public surface:

- `initWakeWord(opts: { accessKey, sensitivity, onWake: () => void }) -> WakeHandle` — creates the
  Porcupine worker for the committed **"Zenith"** keyword and subscribes it to the `WebVoiceProcessor`;
  on a detection it invokes `onWake`.
- `WakeHandle`: `pause()` / `resume()` (unsubscribe/re-subscribe the mic around command capture),
  `release()` (tear down + free the mic — used on mute and unmount), `isListening()`.

Assets (committed under `frontend/public/wakeword/`): the **`Zenith.ppn`** keyword file (from the
Picovoice console) and the Porcupine **params `.pv`** file, both loaded by `publicPath`. Exact
`PorcupineWorker.create(...)` / `WebVoiceProcessor.subscribe(...)` signatures are confirmed against the
`@picovoice/porcupine-web` docs during planning.

**Graceful disable:** if `accessKey` is empty (not configured) or Porcupine init throws, `initWakeWord`
logs once and returns a no-op handle — the HUD runs PTT-only, never crashes.

## 5. Endpointing — silence auto-stop

A helper (in `voice.ts` or `wakeword.ts`) arms only for **wake-initiated** recordings (PTT still ends
on Space-release):

- Poll `recordingRef.current.getLevel()` every ~100ms.
- Track consecutive-silence time (level below `SILENCE_LEVEL`, a tunable constant).
- Call `stopListening()` when silence ≥ `SILENCE_MS` (~1200), **after** a `MIN_MS` (~500) floor so a
  brief gap at the start can't end it instantly, **or** when total ≥ `MAX_MS` (~10000) so it can never
  hang.
- All four thresholds are named constants at the top of the file.

## 6. Toggle, indicator & persistence

- **Pref:** add a `wakeWord: boolean` (default **true**) to `lib/prefs.ts`, mirroring the existing
  reduced-motion trio — `getWakeWord()` / `setWakeWord()` / `useWakeWord()` + a `WAKE_WORD_KEY`
  localStorage key and a `zenith:wake-word` change event (exact analogues of `getReduceMotion` /
  `setReduceMotion` / `useReducedMotion` / `REDUCE_MOTION_KEY` / `REDUCE_MOTION_EVENT`).
- **Indicator:** a small control in the **top status bar** — a dot + `LISTENING` / `MUTED`. Reflects
  live state; clicking it toggles the pref. Also mirrored as a switch in the **Settings** view.
- **Mute = real off:** turning it off calls `handle.release()` (frees the mic); turning it on
  re-inits. On by default means it inits on load (after fetching the config).

## 7. Feedback & barge-in

- **Wake chime:** a short WebAudio oscillator blip on detection (no audio asset). Skipped under a
  future "sounds off" pref if one exists; not gated by reduced-motion (that's visual).
- **Orb:** reuses its existing `voiceState` reaction — `startListening()` already drives the orb into
  its listening state, so no orb code changes are required; an optional brief wake pulse is a nicety,
  not required.
- **Barge-in:** because the detector keeps listening during a reply, saying "Zenith" while Zenith is
  **speaking** cancels the TTS (`cancelSpeech()`) and starts a new command.

## 8. Coexistence & guards

- **Hold-Space PTT is unchanged** and always available (even with wake word muted).
- The `onWake` handler is guarded by `voiceState`:
  - `listening` or `thinking` → **ignore** (already mid-turn).
  - `speaking` → **barge-in** (cancel TTS, start).
  - `idle` → start.
- Only wake-initiated recordings arm the endpointer; PTT recordings are untouched.

## 9. Config & secrets

- Backend `.env`: `PICOVOICE_ACCESS_KEY` (required for the feature) and optional
  `ZENITH_WAKEWORD_SENSITIVITY` (default `0.6`). Added to `.env.example` (documented; the owner fills
  the real key — a `.env*` write rule may require the owner to paste it).
- Route `GET /wakeword/config` (behind `Depends(auth.require_token)`, via `apiFetch`): returns
  `{ "access_key": <str>, "sensitivity": <float> }`. When the key is unset it returns
  `{ "access_key": "", "sensitivity": 0.6 }` so the frontend disables cleanly (mirrors how other
  config is surfaced).
- The `.ppn` / `.pv` assets are committed (models, not secrets).

## 10. Testing

**Backend** (`backend/test_wakeword_config.py`, seams mocked, offline):
- `/wakeword/config` returns the env key + sensitivity when set; returns `""`/default when unset (never
  500); is behind the auth gate (401 without the token when auth is enforced, like the other routes).

**Frontend** (no unit harness → `tsc --noEmit` + manual acceptance):
- Say **"Zenith"** → chime → records → transcribes → replies (Arc; spot-check Ghost/Amethyst).
- Silence ends the command (~1.2s); a long command isn't cut off before the cap.
- **Mute** in the top bar / Settings → the mic indicator goes off and `getUserMedia` is released
  (verify no active-mic indicator); un-mute re-arms.
- **Barge-in:** say "Zenith" while it's speaking → TTS stops, new command starts.
- **PTT still works** with wake word both on and off.
- **Unconfigured:** with `PICOVOICE_ACCESS_KEY` unset, the HUD loads, wake word is silently disabled,
  PTT works.
- False-trigger sanity: normal conversation near the mic doesn't constantly fire (tune `sensitivity`).

## 11. Out of scope (v1) / future

- **`"Hey Zenith"`** second keyword — a one-`.ppn` add if false-triggers prove bad. Held in reserve.
- **openWakeWord** — the fully-open, no-account engine; the Phase-2 swap if the Picovoice account/key
  or its occasional-online validation becomes a problem.
- **Silero VAD** endpointing — the accuracy upgrade over energy-based silence.
- **System tray / global hotkey / autostart / background watcher** — separate TODO items; the wake
  word only works while the app window is running (focused or not).
- **Multi-language / Hinglish wake** — English "Zenith" only for now.

## 12. Files

**New:** `frontend/lib/wakeword.ts`, `frontend/public/wakeword/{Zenith.ppn,porcupine_params.pv}`,
`backend/test_wakeword_config.py`, `SETUP-WAKEWORD.md`, this spec, the implementation plan.
**Touched:** `frontend/package.json` (`@picovoice/porcupine-web`, `@picovoice/web-voice-processor`),
`frontend/lib/prefs.ts` (`wakeWord` pref), `frontend/lib/voice.ts` (endpointer helper),
`frontend/app/page.tsx` (init + `onWake` handler + guards + endpointer wiring),
`frontend/components/TopBar.tsx` (the LISTENING/MUTED indicator), `frontend/components/SettingsView.tsx`
(toggle), `frontend/lib/api.ts` (`getWakeWordConfig`), `backend/main.py` (`/wakeword/config` route),
`backend/.env.example`
(`PICOVOICE_ACCESS_KEY`, `ZENITH_WAKEWORD_SENSITIVITY`).
**Reuses:** `startListening`/`stopListening`, `startRecording`'s `getLevel`, `cancelSpeech`, the orb's
`voiceState`, `apiFetch`, `auth.require_token`, `lib/prefs.ts`.
