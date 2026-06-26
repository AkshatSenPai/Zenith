# Zenith — TODO (next session)

**Update (2026-06-26):** M3 (Google), M4 (Discord + Telegram), and M5 (security + usage/cost dashboard +
Settings + docs) are all **shipped + merged to main**. Telegram now sends a **first-contact welcome**
(`/start` or first message). **New backlog item §5 below: Discord voice — listen to a call + Hindi brief**
(owner request — to discuss/scope). Next milestone is **M6 (memory vault + Copy Factory)**.

**Status (2026-06-21):** items **1–3 DONE** (v1.5 voice + particle orb + CC minimize/restore).
**§4 half done:** the **Kokoro local/offline TTS** option shipped in v1.6 (`d8926bf`) and is now the
default engine; only **TTS pre-fetch/stream** (cut reply lag) is left. Full details below as a record.

---

## 1. Voice — default to English + actually use the GPU  ✅ DONE (v1.5, commit f7c6d30)

**Problem:** 10–12s of speech takes ~20s+ before Zenith starts answering, and it often mishears.
**Root cause is NOT the language** — it's `small`/CPU faster-whisper silently running on **CPU
even on the GPU desktop** (the "safe CUDA→CPU fallback" hides this). Owner is fine in English
(occasional Hindi word here and there).

Do:
- **Default to English.** Make `WHISPER_LANGUAGE=en` the default (`.env.example` + code default).
  When language is `en`, **skip the transliteration / Urdu-reforce step entirely.**
- **KEEP the Hinglish / romanisation path, but DORMANT behind the flag — do NOT delete it.**
  It's a Phase-2 differentiator for the Indian market; must be re-enabled later with one env var.
- **Make the device LOUD (this is hiding a bug).** On startup, log clearly: the *requested*
  device+model vs the **ACTUAL** device/compute the model loaded on. If CUDA was requested but
  unavailable, print a prominent **WARNING** with the likely cause (missing CUDA/cuDNN runtime) —
  never fail silently. Also expose the active whisper **device + model** on `/usage` (or a new
  `GET /health`) so it's verifiable from the browser.
- **GPU setup help:** document exactly what faster-whisper / CTranslate2 needs to run on **CUDA,
  Windows, NVIDIA** (CUDA 12 + cuDNN runtime — which pip packages and *pinned* versions, e.g.
  `nvidia-cublas-cu12` / `nvidia-cudnn-cu12` matched to the installed CTranslate2), and how to
  confirm it's actually on the GPU.

**Target (desktop):** `WHISPER_DEVICE=cuda`, `WHISPER_MODEL=large-v3`, `WHISPER_COMPUTE=float16`,
`WHISPER_LANGUAGE=en`. Expect a 12s clip to transcribe in ~2–3s (vs ~20s) and far better accuracy.
**Note:** CUDA needs an **NVIDIA** GPU. If the GPU is non-NVIDIA, fall back to English on
`medium`/CPU (still much faster than Hinglish `small`/CPU).

Files: `backend/stt_service.py` (model load + device logging), `backend/.env.example`,
`backend/main.py` (the `/usage` or new `/health` route).

---

## 2. Orb → glowing PARTICLE SPHERE  ✅ DONE (v1.5, commit 6e7b285; tuned + owner-approved)

**This supersedes the previous orb plan.** The per-node mesh reaction redesign and the
ring-removal items are now **MOOT** — we're rebuilding the orb entirely as a WebGL particle
sphere. Carry forward only the *principles* below (they still hold).

**Reference:** the particle-sphere image (a dense glowing sphere of tens of thousands of points).
Match that look in **OUR CYAN (#00FFE5 on #000008)**, not purple.

This needs WebGL — **add react-three-fiber FOR THE ORB ONLY:**
- Deps: `three`, `@react-three/fiber`, `@react-three/drei`, `@react-three/postprocessing`.
- **Rewrite `ZenithOrb.tsx`:** orb = a `<Points>` system. `BufferGeometry` of ~40,000–60,000
  particles distributed over/within a **sphere** (Fibonacci distribution + slight radial jitter
  for volume). Soft circular sprite per point, **AdditiveBlending**, cyan, varied size/opacity for
  depth. A brighter dense **core** at center.
- **Bloom** (postprocessing) for the glow — the key premium ingredient. Keep Bloom modest.
- Slow rotation + subtle drift.
- **Audio-reactive — carry over the existing `bars` feed (this is the old B+C reaction, kept):**
  mic / Zenith amplitude → a uniform that **(a) the CORE breathes + brightens with**, and
  **(b) gently displaces particles outward + flows brightness INWARD toward the core** (energy
  *gathering* to the core). Idle = a calm slow shimmer, not static. **NOT** per-node ballooning —
  the old **"bleeding dots"** look stays **rejected**.
- **No concentric / orbital rings in any state** (carried from old item 2): no blue
  "thinking" orbit ellipse, no white core ring. State cues come from the core/particles — e.g.
  `thinking` = cooler tone + slow pulse, or a tiny rotating **arc segment**, never a full ring.
- **Cyan-only — the SPEAKING state must NOT turn orange** (carried from old): keep speaking cyan,
  maybe a touch brighter/whiter.
- **Keep the 4 CONNECTION NODES** (Gmail / Calendar / WhatsApp / Discord): render as labelled
  anchors **around** the sphere (drei `<Html>` or billboarded sprites), lit cyan when connected,
  dim when not (Gmail + Calendar on, others off, as now). Keep the 4 states
  (idle / listening / thinking / speaking). **These 4 nodes are what keep it recognizably Zenith
  vs a generic AI sphere — keep them clear.**
- Make it **BIG** — the center hero.

**Performance:** one `<Points>` draw call, so 40–60k is fine on the GPU desktop; put the particle
count in a `const` to tune; keep Bloom modest. (Test on the 8GB MacBook; lower particles/bloom if
it stutters.) **2D-flat refs are gone — this one genuinely needs WebGL; that's expected.**

Files: `frontend/components/ZenithOrb.tsx` (**rewrite** — current mesh internals `buildField` /
`ReactiveNodes` / core-rings are removed), `frontend/app/page.tsx` (keep feeding `bars` to
`<ZenithOrb bars=… />`), `frontend/lib/voice.ts` (`getBars` / `getSpeechBars` stay).

---

## 3. Command Center — minimize / restore  ✅ DONE

Built: a **▾ chevron** in the CC header (shown once there's a conversation) collapses the panel to
a slim **"Command Center / Restore ⌃" pill**, handing the freed space to the orb (`orbBig`). Click
the pill to restore. **Auto-restores on any new message** (e.g. a push-to-talk answer while
minimized) so Zenith's reply is always shown — voice works while minimized, type after restoring.
~300ms `ease-out` collapse. State: `ccMinimized` in `page.tsx`, folded into `orbBig` + `ccExpanded`.

Files: `frontend/components/CommandCenter.tsx` (chevron + pill + collapse),
`frontend/app/page.tsx` (`ccMinimized` state + auto-restore + wiring).

---

## 4. Backlog: TTS latency + offline option

- ✅ **Kokoro local/offline TTS — DONE (v1.6, commit `d8926bf`).** Now the default engine
  (`ZENITH_TTS_ENGINE=kokoro`, voice `af_heart`, English; edge-tts kept as the fallback). Backend
  venv rebuilt on Python 3.11 (spacy/blis have no 3.14 wheels). CPU ~0.5× realtime. Hindi voices
  are weak, so English-only for now (revisit if/when the Hinglish path goes live).
- ⬜ **Pre-fetch / stream the TTS** so it starts speaking sooner. Still open — and now the *main*
  voice-latency lever. Kokoro generates faster than realtime, so streaming the first chunk while the
  rest synthesizes would make even long replies start in ~1s. (Was masked before by edge's round-trip.)

---

## 5. Discord voice — join a call, listen, brief it (in Hindi)  ⬜ FUTURE (to discuss — owner request 2026-06-26)

**What the owner wants:** Zenith joins a Discord **voice channel**, stays in the call, listens, and
produces a **brief of what's being discussed**. Meetings will be in **Hindi**.

**Verdict: doable, but it's a milestone-sized feature, not a quick add.** Discuss + scope before building.

**Fits our stack (the easy half):**
- Discord hands the bot **per-user audio streams** → speaker labels ("who said what") come *for free*
  (normally the hardest part of meeting transcription).
- We already have both engines: **faster-whisper** (STT, supports Hindi) + **Claude** (the brain) for
  the summary. So "transcribe the call → Claude writes a brief" is squarely in the existing architecture.

**The real catches (why it's a build):**
1. **`discord.py` cannot RECEIVE voice** — our current lib only sends. Need either **Pycord** (built-in
   recording "sinks") or **`discord-ext-voice-recv`**. Dependency decision + possible bot rewrite. *(biggest risk)*
2. **Hindi accuracy wants a bigger Whisper model on the GPU** (`medium`/`large-v3`), but Whisper is on
   **CPU `small`** right now to free the 8GB card for Kokoro TTS. Resource trade-off → likely run the
   transcription as a **batch job after the call** (when TTS isn't busy).
3. **Batch, not live, first.** "Record call → brief afterward" is reliable; live "what are we talking
   about now" is much harder (latency/chunking) — defer.
4. **Consent:** the bot is recording a conversation → it should announce itself when it joins.

**Open questions for the discuss session:** Pycord vs `discord-ext-voice-recv` · batch vs live · the
GPU/model plan (swap Whisper to GPU for the brief?) · where the brief lands (DM / channel post /
Activity Log / a note in the M6 memory vault) · Hindi output: Devanagari transcript → Claude summary in
EN or Hinglish? · likely lands **after M6** (the vault is a natural home for saved briefs).

---

## Context / reminders
- **Orb is being rebuilt in WebGL (R3F)** — the old SVG mesh in `ZenithOrb.tsx` is replaced.
  Reaction data still flows: `page.tsx` (`bars` via rAF) → `<ZenithOrb bars=… />`, sourced from
  `getBars` / `getSpeechBars` in `lib/voice.ts`.
- STT lives in `backend/stt_service.py`; routes in `backend/main.py`; env in
  `backend/.env` / `.env.example`.
- Left rail extras (done): `frontend/components/LeftRailExtras.tsx`.
- **Don't `npm run build` while `npm run dev` is live** (it desyncs `.next`).
- **Attach for item 2:** the particle-sphere reference image + a current-orb screenshot.
