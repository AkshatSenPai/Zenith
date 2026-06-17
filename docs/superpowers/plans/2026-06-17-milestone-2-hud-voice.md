# Zenith — Milestone 2 Plan: HUD UI + Voice

> **Execution:** inline, in **two passes**. Build **Pass A** (HUD shell, mock data, /usage) and **STOP** for approval before Pass B (voice). Builds on Slice 0 + M1 — extends them, rebuilds nothing.

**Goal:** Turn the bare page into the Iron-Man-style HUD, then (Pass B) make voice work end to end — hold-space → faster-whisper → the *existing* /chat loop → spoken reply.

**References:** five images studied in-session; on disk at `docs/superpowers/plans/hud-ref/ref01–ref05.png` (the spec's `docs/hud-refs/` path doesn't exist — using the real one). Reproduce the visual **language**, not branding — original HUD, no Stark/Marvel/Iron-Man marks or figure.

---

## Design system (per frontend-design: token plan → critique → build)

**Color** (from PRD UI STYLE; locked):
- `#000008` bg · `#00FFE5` cyan **primary** · `#0066FF` blue **secondary** · `#E0F7F7` cool-white text
- `#FF6B00` alert / `#FF2020` critical — **warning states only, never decoration**
- derived: `cyan @ 8–20% alpha` for grid lines / inactive ticks; optional `#2EE6A6` green as a sparing "scanning" accent (ref 3 only)

**Type:** Space Grotesk (display — panel titles, the wordmark, wide tracking) · Inter (body — chat messages, prose) · JetBrains Mono (**data/chrome** — labels, gauges, day-ruler, timestamps, terminal). Loaded via `next/font/google` as CSS vars. HUD chrome is uppercase, letter-spaced mono; content is Inter. (First dev/build compile fetches the fonts once — needs network.)

**Layout:** the PRD ASCII — top timeline bar · left CALENDAR · center ORB+chat · right COMMS · bottom waveform+input · hex corners. Orb-centric.

**Signature:** the **ZENITH orb** — concentric segmented tick-rings + white double inner ring + gear/crosshair + caliper bracket arcs. The one bold, memorable element. Orchestrated motion lives here; everything else stays quiet.

**Critique vs. AI-default looks:** not cream/serif, not acid-green-on-black, not broadsheet — a specific instrument-panel HUD grounded in the refs. The real failure mode for a HUD is *animated slop*: many competing motions + decorative clutter. **Mitigations:** orb is the focal motion; panels use at most one subtle ambient motion each; orange/red strictly for warnings; `prefers-reduced-motion` dials all motion down; clear hierarchy (orb dominant → panels → chrome).

## Reference → component mapping
- **ref01** (Stark desktop) → overall **composition**: top **day-ruler** (01–30), circular **date widget** = CalendarPanel header, horizontal **bar-meters** = usage, **angled list-cards** = CommsPanel.
- **ref04** (clean centered orb) → **ZenithOrb primary / idle**: concentric segmented tick-rings + white double inner ring + central gear/crosshair, caliper brackets L/R, hex clusters in corners.
- **ref02** (orange orbital core) → ZenithOrb **thinking** (orbit ring + sweeping satellite node, blue glow); StatusCard warning-triangle; WaveformBar cyan bell-curve.
- **ref05** (targeting HUD) → ZenithOrb **listening** (reticle / crosshair-with-diamond lock); StatusCard/critical (bracketed alert boxes + circular red "Warning" gauge); WaveformBar EKG trace.
- **ref03** (teal compass globe) → GaugeIndicator (compass-rose N/NE/E ring + segmented arc gauges + small %-radials). Green is "scanning"-only; cyan stays primary.

---

## PASS A — HUD shell (visual; MOCK panel data; REAL /usage)

### File structure
```
frontend/
├── app/
│   ├── layout.tsx          # UPDATE: load 3 fonts as CSS vars
│   ├── globals.css         # UPDATE: HUD keyframes, grid, reduced-motion
│   └── page.tsx            # REWRITE: compose the HUD; keep M1 chat logic
├── components/
│   ├── hud/primitives.tsx  # NEW: TickRing, Arc, Caliper, Hex, Crosshair, RadialGauge, HexCorners
│   ├── TopBar.tsx          # NEW: day-ruler + date/time + ONLINE + gear
│   ├── ZenithOrb.tsx       # NEW: 4 states + Pass-A dev state-cycler
│   ├── CalendarPanel.tsx   # NEW: circular date header + events (mock, loading/empty)
│   ├── CommsPanel.tsx      # NEW: Gmail/WhatsApp/Discord + items (mock, loading/empty)
│   ├── GaugeIndicator.tsx  # NEW: segmented gauge + %-radial (binds /usage)
│   ├── WaveformBar.tsx     # NEW: animated oscilloscope/EKG placeholder
│   └── StatusCard.tsx      # NEW: bracketed alert; renders the M1 pending-action confirm
│   └── ConfirmCard.tsx     # REMOVE (absorbed into StatusCard)
├── lib/mock.ts             # NEW: mock calendar + comms data
└── tailwind.config.ts      # UPDATE: fontFamily (display/body/mono)
backend/
├── rate_limiter.py         # UPDATE: add .stats() (non-consuming snapshot)
└── main.py                 # UPDATE: add GET /usage
```

### Backend — GET /usage (binds the gauges to real M1 numbers)

`rate_limiter.py` — add a non-consuming snapshot:
```python
def stats(self) -> dict:
    """Current usage without consuming a request slot (for GET /usage)."""
    with self._lock:
        self._roll()
        now = time.monotonic()
        while self._minute and now - self._minute[0] >= 60:
            self._minute.popleft()
        return {
            "requests_today": self._day_count,
            "daily_request_cap": MAX_REQUESTS_PER_DAY,
            "requests_last_minute": len(self._minute),
            "per_minute_cap": MAX_REQUESTS_PER_MINUTE,
            "tokens_today": self._day_tokens,
            "daily_token_budget": DAILY_TOKEN_BUDGET,
        }
```
`main.py` — add:
```python
@app.get("/usage")
def usage() -> dict:
    return limiter.stats()
```
(No request slot consumed; pure read. Gauges poll it.)

### HUD primitives (the faithful-to-refs core) — `components/hud/primitives.tsx`
All built as inline SVG so strokes + glow + animation are crisp at any size. Example — the segmented tick-ring that recurs in every ref:
```tsx
export function TickRing({ r, count, len, width = 1, className, cx = 0, cy = 0 }: {
  r: number; count: number; len: number; width?: number; className?: string; cx?: number; cy?: number;
}) {
  return (
    <g>
      {Array.from({ length: count }).map((_, i) => {
        const a = (i / count) * 2 * Math.PI;
        const [c, s] = [Math.cos(a), Math.sin(a)];
        return (
          <line key={i}
            x1={cx + r * c} y1={cy + r * s}
            x2={cx + (r - len) * c} y2={cy + (r - len) * s}
            strokeWidth={width} className={className} strokeLinecap="round" />
        );
      })}
    </g>
  );
}
```
Plus: `Arc` (partial ring via `<circle>` + `strokeDasharray`), `Caliper` (bracket `<path>`), `Hex`/`HexCorners` (`<polygon>` clusters for the four corners + edges), `Crosshair`/`Reticle` (lines + diamond + center dot), `RadialGauge` (arc fill + % label). Glow via a reusable SVG `<filter>` (feGaussianBlur) and/or `drop-shadow`. DRY — every component composes these.

### ZenithOrb — `state: "idle" | "listening" | "thinking" | "speaking"`
| State | Look (ref) | Motion |
|---|---|---|
| idle | ref04: segmented tick-rings + white double inner ring + gear/crosshair, caliper brackets | slow ring rotation, gentle cyan pulse |
| listening | ref05: + reticle/crosshair-with-diamond lock | faster bright pulse + expanding ripple rings |
| thinking | ref02: + orbit ellipse w/ sweeping satellite node, blue glow | arc rotation + node orbit |
| speaking | full brightness + orange accent ring + concentric wave pulses | wave animation |
Layered SVG; state toggles overlays/accent/animation-speed via classes. **Pass A:** a small labeled `DEV` state-cycler (4 buttons) to switch states on demand. (Pass B replaces it with live voice state.) Motion respects `prefers-reduced-motion`.

### Layout — `app/page.tsx` (CSS grid; keeps all M1 chat logic)
```
┌─ TopBar: ‹01..30 day-ruler, today=17 hi› ‹Wed 17 Jun 2026 · HH:MM:SS› ‹● ONLINE› ‹⚙›
├───────────────┬───────────────────────────────┬───────────────┐
│ CalendarPanel │   ZenithOrb (signature)       │  CommsPanel   │
│ (date widget) │   ───────────────────────     │  Gmail/WA/Disc│
│ today/tomorrow│   chat/response (Inter+mono)  │  list-cards   │
│ + GaugeIndic. │   StatusCard (pending action) │               │
├───────────────┴───────────────────────────────┴───────────────┤
│ WaveformBar (animated)   [ Type a message … ]        [ Send ▸ ] │
└─ hex corner accents at all four corners ───────────────────────┘
```
- Grid: rows `[auto] [1fr] [auto]`; middle row cols `[300px] [1fr] [300px]`. Desktop-first (PRD 1440px); panels collapse/scroll gracefully on narrow widths; `prefers-reduced-motion` honored.
- **M1 chat preserved verbatim**: `sendMessage`, `resolvePending`, `applyData`, loading, 429, warning — unchanged logic, re-laid-out. Input+Send move to the bottom bar; messages render in center; the pending action renders via **StatusCard** (Confirm/Cancel still call `/chat/confirm`).
- Date/time/day-ruler computed live from `new Date()` (no hardcoding).

### Panels — mock data + loading + empty (`lib/mock.ts`)
- **CalendarPanel:** circular date-widget header (big day number + month, ring around it); today + tomorrow events with ring-bullet markers. Simulated load (~600ms) → mock events; empty-state copy ("No events today.") if a list is empty.
- **CommsPanel:** Gmail / WhatsApp / Discord counts + a few recent items as angled list-cards (clip-path angled corner). Same loading + empty handling. **Clearly mock** (a small "demo data" tag) so it's not mistaken for live integrations.
- **GaugeIndicator:** binds to **real** `/usage` (fetch on mount + poll ~5s): "API min" (requests_last_minute/per_minute_cap), "Daily" (requests_today/daily_request_cap), "Tokens" (tokens_today/daily_token_budget). Segmented arc + % label; turns `alert`/`critical` as it approaches caps.

### WaveformBar (Pass A)
Animated SVG oscilloscope/EKG placeholder (cyan trace, subtle motion). Exposes a `level`/`active` prop now (unused) so Pass B can drive it from live audio with no API change.

### Pass A — verification (DONE WHEN)
- Type-check (`tsc --noEmit`) clean; production build compiles (sandbox permitting — else type-check + dev render).
- `GET /usage` returns the real numbers (curl), gauges read them.
- The four orb states all show via the dev cycler.
- Panels show mock data + their loading + empty states.
- Typing still works end-to-end (reuse M1 live path); pending action still renders (now as StatusCard) and confirms.
- **Then STOP and show you the running UI for OK.**

---

## PASS B — voice (only after your OK; outline)

**Backend** — `stt_service.py` + `POST /transcribe` (faster-whisper):
- Load the model **once at startup** (module-level, like the Anthropic client). Env: `WHISPER_MODEL` (default `small`), `WHISPER_DEVICE` (default `cpu`); desktop uses `medium`/`cuda`. Accept an audio blob (UploadFile), transcribe with language auto-detect (Hinglish), return `{text}`. Add `faster-whisper` to requirements; ffmpeg required (README note). `.env.example` gets the two WHISPER_* vars.

**Frontend** — `lib/voice.ts` + `components/VoiceInput.tsx`:
- Hold **SPACE** → `MediaRecorder` records; release → POST blob to `/transcribe` → `{text}` → run through the **existing** `sendMessage` flow → `speak(reply)`.
- `speak(text)`: `SpeechSynthesis`, lang `hi-IN` (toggle to `en-IN`).
- Web Audio `AnalyserNode` on the mic stream → drive `WaveformBar` levels while recording; animate it during TTS too.
- Wire `ZenithOrb.state` live: idle → **listening** (recording) → **thinking** (awaiting /chat) → **speaking** (TTS) → idle. (Replaces the Pass-A dev cycler.)
- Mic uses the normal browser `getUserMedia` prompt (no Tauri).

**Pass B done when:** hold space → talk → release → transcript → /chat → reply shown **and spoken** → orb cycles all four states → waveform reacts to voice → the M1 confirm card still fires.

---

## Explicitly OUT OF SCOPE (both passes)
Real Gmail/Calendar/WhatsApp/Discord (panels are MOCK only — no Google/Discord/WhatsApp API); new tools beyond the M1 stubs; Tauri shell (stay in the browser); PostgreSQL/persistence (in-memory); settings page, auth, usage-history charts.

## Self-review vs. spec
- Art direction: cyan-primary/blue-secondary on #000008, orange/red warning-only; the 6 house-style motifs (segmented tick-rings, caliper brackets, hex clusters, %-radials/bar-meters, crosshair/diamond, oscilloscope/EKG, stepped diagonals); 3 fonts ✓.
- Layout: top day-ruler + date/time + ONLINE + gear · left Calendar · center Orb+chat · right Comms · bottom waveform+input+Send · hex corners ✓.
- Components: ZenithOrb (4 states + dev cycler) · CalendarPanel · CommsPanel · WaveformBar · GaugeIndicator · StatusCard (absorbs ConfirmCard) · hex accents ✓.
- Backend: GET /usage from the M1 rate_limiter ✓. M1 chat/confirm/429 still work ✓.
- Pass B: stt_service + /transcribe (model loaded once, env-configurable), voice.ts + VoiceInput (hold-space → transcribe → existing /chat → speak), analyser→waveform, live orb state ✓.
- Out-of-scope respected; in-memory; Hinglish; local whisper; keys via .env ✓.
