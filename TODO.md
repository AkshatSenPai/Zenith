# Zenith — TODO (next session)

Two priorities: **(1) fix voice speed + accuracy (English + GPU)** — the daily-use blocker —
and **(2) rebuild the orb as a particle sphere** (replaces the old mesh-orb polish). Plus the
Command Center minimize control, and a TTS item parked in the backlog.

**Guard:** items **2 & 3 are MOCK/visual only** — no API wiring (Gmail/Calendar/WhatsApp/Discord),
no Tauri/Pass B. **Item 1 is a backend config/robustness fix to the EXISTING voice pipeline**
(allowed — it is not integration work). Use the **design/frontend skills** for item 2 (visual craft).
Items are independent — order doesn't matter, but #1 is quick and high-impact, do it first.

---

## 1. Voice — default to English + actually use the GPU  ⚡ PRIORITY (quick; fixes the ~20s lag)

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

## 2. Orb → glowing PARTICLE SPHERE  (REPLACES the old orb work)

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

## 3. Command Center — minimize / restore  (kept from previous TODO)

When an answer is shown, allow minimizing the Command Center and reopening on demand.
- Add a **minimize control** (chevron ▾) in the Command Center header.
- Minimized = collapse to a thin bar / pill (e.g. "▸ Command Center"), freeing the space (the
  bigger orb can take it). Click to expand back to the full panel.
- Smooth transition (reuse the existing `--ease-out` / height-grow approach). Remember the last
  state during the session.

Files: `frontend/components/CommandCenter.tsx` (minimize state + toggle),
`frontend/app/page.tsx` (drives `expanded`).

---

## 4. Backlog — NOT this session: TTS latency + offline option

The spoken reply lags a beat because **edge-tts** round-trips to Microsoft; quality is passable,
not great. Later options (don't do now):
- **Pre-fetch / stream** the TTS so it starts speaking sooner.
- Evaluate **Kokoro** (hexgrad/kokoro) for fully-local **offline** TTS — verify English quality
  first; Hindi support is limited. Keep edge-tts (English voices Neerja / Prabhat) as default for now.

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
