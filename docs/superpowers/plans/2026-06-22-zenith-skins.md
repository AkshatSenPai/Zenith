# Zenith Skins — Implementation Plan

> ## ⏯️ STATUS — 2026-06-24: Tasks 1–8 DONE, on `main` (range `9302683..b8556dd`)
> Arc / Ghost / Amethyst all built + working Settings picker, each task an atomic commit
> (`9e3b7b7` T1 · `9e75018` T2 · `88266f2` T3 · `7c5d6e7` T4 · `bf8b30d` T5 · `f7412ba` T6 ·
> `590e530` T7 · `b8556dd` T8), tsc-clean + browser-verified. **RESUME AT TASK 9** (Amethyst
> bento layout), then **Task 10** (cross-skin QA). Task-10 tune candidate: Ghost ink-web is
> still a touch dense in the centre. See memory `skins-build-resume`. (Per-step `- [ ]` boxes
> below are left unticked — git history + this banner are the source of truth for progress.)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) or
> superpowers:subagent-driven-development to implement this task-by-task. Frontend visual work
> has **no JS test runner** in this repo, so each task is verified by (a) `npx tsc --noEmit` /
> dev-server compile, (b) **browser screenshots via the chrome-devtools MCP** (drive
> `http://localhost:3000`, toggle `data-skin` to inspect each skin), and (c) for the design
> passes, the **Impeccable** skill (`/impeccable audit|polish|critique`) + its slop-detector.
> Steps use `- [ ]` checkboxes.

> **Revised 2026-06-23:** Ghost is now a **light / ink-network** skin (white paper canvas, black
> ink, a black network/web orb with no connection nodes) — see the spec. This split the old
> "orb reads tokens" task into **Task 3 (sphere recolor, for Arc/Amethyst)** + a new **Task 4
> (Ghost network-orb render mode)**, and changed Task 5's Ghost values from dark to light. Plan
> is now 10 tasks.

**Goal:** Add a skin/theme system to Zenith with three skins — Arc (current cyan, default),
Ghost (light/ink-network focus-mode, built first), Amethyst (violet bento) — switchable from Settings.

**Architecture:** All color + treatment values become CSS variables selected by a `data-skin`
attribute on `<html>`. Tailwind tokens become `rgb(var(--…)/<alpha>)` so existing utility classes
auto-theme. A `SkinProvider` (context + localStorage) sets `data-skin`; a head inline-script
applies the saved skin before paint. The WebGL orb reads its colors/knobs (incl. `--orb-mode`)
from the same CSS vars via `getComputedStyle` on skin change; Ghost renders a **second orb mode**
(dark nodes + neighbour lines, normal blending, no bloom). Ghost additionally hides the side
dashboard columns (centered-focus layout) and trims chrome.

**Tech Stack:** Next.js 14 (App Router) · Tailwind · TypeScript · react-three-fiber · GSAP.
Design skills applied during build: **impeccable**, **taste-skill**, **minimalist-skill**
(Ghost), **redesign-skill**, **emil-design-eng**.

## Global Constraints
- Spec: `docs/superpowers/specs/2026-06-22-zenith-skins-design.md` (authoritative for values).
- **Arc must look pixel-identical to today** after the token refactor — it's the regression gate.
- Only animate `transform`/`opacity`/`filter` (emil). Keep all `prefers-reduced-motion` paths.
- Tailwind color vars stored as **space-separated RGB channels** so `/opacity` modifiers work.
- Do NOT touch voice/confirm-gate/backend behavior. Frontend only.
- Don't `npm run build` while `npm run dev` is live. Commit per task; direct to `main`.
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Token foundation (Arc unchanged)
Convert all hardcoded colors to CSS variables; Arc keeps today's exact values.

**Files:**
- Modify: `frontend/tailwind.config.ts`
- Modify: `frontend/app/globals.css`
- Modify: `frontend/components/BootScreen.tsx`, `frontend/components/StatusCard.tsx`,
  `frontend/components/ZenithOrb.tsx` (hardcoded hex → vars)

**Interfaces produced:** CSS vars `--zenith-bg/-cyan/-blue/-text/-alert/-red` (RGB channels),
`--orb-color/-cool/-core` (orb; hex or RGB), knobs `--glow-strength/-panel-tint/-border-strength/
-notch/-radius/-motion-scale/-bloom/-particle-count`, **plus orb-mode knobs `--orb-mode`
(`sphere`|`network`), `--orb-link-dist`, `--orb-link-alpha`**. Tailwind keys (`zenith-cyan` etc.)
unchanged in name.

- [ ] **Step 1 — Impeccable baseline.** Run `/impeccable audit` over `frontend/` to capture the
  current HUD's design state + any anti-patterns to avoid carrying into the skins. Save notes.
- [ ] **Step 2 — Tailwind tokens → vars.** In `tailwind.config.ts`, replace each hex with
  `rgb(var(--zenith-<key>) / <alpha-value>)`:
  ```ts
  colors: {
    zenith: {
      bg:   "rgb(var(--zenith-bg) / <alpha-value>)",
      cyan: "rgb(var(--zenith-cyan) / <alpha-value>)",
      blue: "rgb(var(--zenith-blue) / <alpha-value>)",
      text: "rgb(var(--zenith-text) / <alpha-value>)",
      alert:"rgb(var(--zenith-alert) / <alpha-value>)",
      red:  "rgb(var(--zenith-red) / <alpha-value>)",
      scan: "#2EE6A6", // unchanged (not themed)
    },
  },
  ```
- [ ] **Step 3 — Arc var block.** At the top of `globals.css` add the default (Arc) block with
  today's values + knobs (note `--orb-mode: sphere` + zeroed link knobs so non-Ghost skins ignore them):
  ```css
  :root, [data-skin="arc"] {
    --zenith-bg: 0 0 8; --zenith-cyan: 0 255 229; --zenith-blue: 0 102 255;
    --zenith-text: 224 247 247; --zenith-alert: 255 107 0; --zenith-red: 255 32 32;
    --orb-color: #00ffe5; --orb-cool: #39d6ff; --orb-core: 190 255 250;
    --glow-strength: 1; --panel-tint: 1; --border-strength: 1;
    --notch: 14px; --radius: 0px; --motion-scale: 1; --bloom: 0.7; --particle-count: 28000;
    --orb-mode: sphere; --orb-link-dist: 0; --orb-link-alpha: 0;
  }
  ```
- [ ] **Step 4 — Convert hardcoded sites in globals.css** (18 spots). Rules:
  `rgba(0,255,229,A)` → `rgb(var(--zenith-cyan) / calc(A * var(--glow-strength)))` for glows,
  or `* var(--panel-tint)` for panel/card fills/inner-glows, or `* var(--border-strength)` for
  borders; `rgba(0,102,255,A)` → `rgb(var(--zenith-blue) / A)`; `#000008`→`rgb(var(--zenith-bg))`;
  `#e0f7f7`→`rgb(var(--zenith-text))`. Make `.hud-card` clip-path use `var(--notch)`; make the
  spin/ambient animations use `calc(<dur> * var(--motion-scale))`. Keep `.bg-aura` gradients on
  `--zenith-cyan`/`--zenith-blue` scaled by `--panel-tint`.
- [ ] **Step 5 — Component hex → var.** `BootScreen.tsx` BootOrb SVG strokes `#00FFE5` →
  `currentColor` (wrap in `text-zenith-cyan`) or `rgb(var(--zenith-cyan))`; its inline rgba glows
  → `rgb(var(--zenith-cyan)/…)`. `StatusCard.tsx` hardcoded hex → token class/var.
  `ZenithOrb.tsx` `OrbFallback` gradient → `rgb(var(--zenith-cyan)/…)`.
- [ ] **Step 6 — Verify Arc unchanged.** Restart dev if needed; in chrome-devtools MCP load
  `http://localhost:3000`, screenshot the HUD + boot screen. Compare to the pre-change look —
  must be identical. Run `npx tsc --noEmit` (clean). Spot-check a `/opacity` class (e.g.
  `text-zenith-text/40`) renders translucent.
- [ ] **Step 7 — Commit.**
  ```bash
  git add frontend/tailwind.config.ts frontend/app/globals.css frontend/components/BootScreen.tsx frontend/components/StatusCard.tsx frontend/components/ZenithOrb.tsx
  git commit -m "refactor(frontend): tokenize colors into CSS vars (Arc unchanged)"
  ```

---

### Task 2: SkinProvider + persistence + no-flash
**Files:**
- Create: `frontend/lib/skins.ts`
- Create: `frontend/components/SkinProvider.tsx`
- Modify: `frontend/app/layout.tsx` (head inline script + wrap children)

**Interfaces produced:** `SKINS: {id:"arc"|"ghost"|"amethyst"; label:string; swatch:{bg,accent,panel:string}}[]`;
`type SkinId`; `useSkin(): { skin: SkinId; setSkin(id: SkinId): void }`; `SkinProvider`;
`DEFAULT_SKIN`, `SKIN_STORAGE_KEY`.

- [ ] **Step 1 — `lib/skins.ts`:** export `SkinId` union, `SKINS` array (id/label + preview swatch
  hexes for the picker), `DEFAULT_SKIN="arc"`, `SKIN_STORAGE_KEY="zenith-skin"`:
  ```ts
  export type SkinId = "arc" | "ghost" | "amethyst";
  export const DEFAULT_SKIN: SkinId = "arc";
  export const SKIN_STORAGE_KEY = "zenith-skin";
  export const SKINS: { id: SkinId; label: string; swatch: { bg: string; accent: string; panel: string } }[] = [
    { id: "arc",      label: "Arc",      swatch: { bg: "#000008", accent: "#00ffe5", panel: "#06121a" } },
    { id: "ghost",    label: "Ghost",    swatch: { bg: "#f7f7f5", accent: "#1a1a1c", panel: "#ffffff" } },
    { id: "amethyst", label: "Amethyst", swatch: { bg: "#07050f", accent: "#b26bff", panel: "#140e26" } },
  ];
  export function isSkinId(v: unknown): v is SkinId {
    return v === "arc" || v === "ghost" || v === "amethyst";
  }
  ```
- [ ] **Step 2 — `SkinProvider.tsx`:** React context; on mount read `localStorage[SKIN_STORAGE_KEY]`
  (validate with `isSkinId`, else default), set `document.documentElement.dataset.skin`; `setSkin`
  writes localStorage + dataset. Expose `{skin,setSkin}` via `useSkin()`:
  ```tsx
  "use client";
  import { createContext, useCallback, useContext, useEffect, useState } from "react";
  import { DEFAULT_SKIN, SKIN_STORAGE_KEY, type SkinId, isSkinId } from "../lib/skins";

  const Ctx = createContext<{ skin: SkinId; setSkin: (id: SkinId) => void }>({
    skin: DEFAULT_SKIN, setSkin: () => {},
  });

  export function SkinProvider({ children }: { children: React.ReactNode }) {
    const [skin, setSkinState] = useState<SkinId>(DEFAULT_SKIN);
    useEffect(() => {
      const saved = localStorage.getItem(SKIN_STORAGE_KEY);
      if (isSkinId(saved)) setSkinState(saved);
    }, []);
    const setSkin = useCallback((id: SkinId) => {
      setSkinState(id);
      localStorage.setItem(SKIN_STORAGE_KEY, id);
      document.documentElement.dataset.skin = id;
    }, []);
    useEffect(() => { document.documentElement.dataset.skin = skin; }, [skin]);
    return <Ctx.Provider value={{ skin, setSkin }}>{children}</Ctx.Provider>;
  }
  export const useSkin = () => useContext(Ctx);
  ```
- [ ] **Step 3 — No-flash script in `layout.tsx`:** a `<script dangerouslySetInnerHTML>` in
  `<head>` that reads the same key and sets `document.documentElement.dataset.skin` before paint
  (default `arc`). Wrap `{children}` in `<SkinProvider>`:
  ```tsx
  <head>
    <script dangerouslySetInnerHTML={{ __html:
      `(function(){try{var s=localStorage.getItem('zenith-skin');document.documentElement.dataset.skin=(s==='ghost'||s==='amethyst'||s==='arc')?s:'arc';}catch(e){document.documentElement.dataset.skin='arc';}})();`
    }} />
  </head>
  ```
- [ ] **Step 4 — Verify:** browser — set skin via `useSkin` (temporarily wire a console call or set
  `localStorage` + reload); confirm `<html data-skin>` updates, persists across reload, no color
  flash on load. `npx tsc --noEmit` clean.
- [ ] **Step 5 — Commit** `feat(frontend): SkinProvider + persisted data-skin (no-flash)`.

---

### Task 3: Orb reads sphere tokens (Arc + Amethyst recolor)
Make the **existing sphere orb** read its colors/bloom/particle-count from CSS vars so Arc stays
identical and Amethyst (Task 8) recolors for free. Read `--orb-mode` and branch, but the `network`
branch lands in Task 4 (here it renders the sphere as today when mode is `sphere`).

**Files:** Modify `frontend/components/OrbScene.tsx`.

**Interfaces consumed:** `useSkin()` (Task 2).
**Interfaces produced:** `readOrbTokens(): { mode:"sphere"|"network"; color:string; cool:string;
core:string; bloom:number; count:number; linkDist:number; linkAlpha:number }`;
`makeGlowTexture(color:string, core:string): THREE.Texture`;
`buildSphereGeometry(count:number): THREE.BufferGeometry`.

- [ ] **Step 1 — Token reader.** Add at module scope:
  ```ts
  export function readOrbTokens() {
    const cs = getComputedStyle(document.documentElement);
    const num = (k: string, d: number) => { const v = parseFloat(cs.getPropertyValue(k)); return Number.isFinite(v) ? v : d; };
    const str = (k: string, d: string) => cs.getPropertyValue(k).trim() || d;
    const rgb = (k: string, d: string) => { const v = cs.getPropertyValue(k).trim(); return v ? `rgb(${v.split(/\s+/).join(",")})` : d; };
    return {
      mode: (str("--orb-mode", "sphere") as "sphere" | "network"),
      color: str("--orb-color", "#00ffe5"),
      cool: str("--orb-cool", "#39d6ff"),
      core: rgb("--orb-core", "rgb(190,255,250)"),
      bloom: num("--bloom", 0.7),
      count: Math.round(num("--particle-count", 28000)),
      linkDist: num("--orb-link-dist", 0.34),
      linkAlpha: num("--orb-link-alpha", 0.5),
    };
  }
  ```
- [ ] **Step 2 — Parameterize the core texture.** Change `makeGlowTexture()` to
  `makeGlowTexture(color: string, core: string)` and build the gradient from the args (core at
  the inner stops, color at the outer): keep the white centre, then `core` at 0.18, then `color`
  at 0.5 and transparent `color` at 1. Replace the hardcoded cyan stops.
- [ ] **Step 3 — Extract geometry builder.** Move the Fibonacci-shell `useMemo` body into a
  module function `buildSphereGeometry(count: number)` returning the `BufferGeometry`; have the
  component call it with the token count (stored in state, see Step 5).
- [ ] **Step 4 — Tokenize the sphere materials + anchors.** In `SceneContents`, replace the
  hardcoded `new THREE.Color("#00ffe5")`/`"#39d6ff"` uniforms and the `Spoke` line color
  (`0x00ffe5`) and the Anchors' inline `rgba(0,255,229,…)` glows with values read from
  `readOrbTokens()` (`color`/`cool`). (The Anchor label classes already use `text-zenith-cyan`
  etc., so they auto-theme via Task 1.)
- [ ] **Step 5 — React to skin.** Consume `useSkin()`. Hold `const [tokens, setTokens] =
  useState(readOrbTokens)`; in `useEffect` keyed on `skin`, call `setTokens(readOrbTokens())`.
  On token change: update `material.uniforms.uColor/uCool`; regenerate `coreTex` via
  `makeGlowTexture(tokens.color, tokens.core)` (dispose the old); if `tokens.count` differs from
  the built geometry, rebuild via `buildSphereGeometry` (dispose old). Lift `<Bloom intensity>` to
  `tokens.bloom`.
- [ ] **Step 6 — Mode guard (scaffold).** Wrap the sphere render (`<points>`, core `<sprite>`,
  `<Anchors>`, `<Bloom>`) in `tokens.mode === "sphere" && (…)`. When `mode === "network"` render
  `null` for now — **Task 4 fills this in.** Add a `// network mode: see Task 4` comment.
- [ ] **Step 7 — Verify:** browser — Arc orb identical to before (sphere, cyan, bloom). Temporarily
  set `document.documentElement.dataset.skin='amethyst'` in devtools (Amethyst vars don't exist
  until Task 8 — inject test vars or accept defaults) and confirm the sphere recolors + the core
  texture updates with no WebGL errors. `npx tsc --noEmit` clean.
- [ ] **Step 8 — Commit** `feat(frontend): sphere orb reads color/bloom/particle tokens per skin`.

---

### Task 4: Ghost network-orb render mode
Add the **second orb mode** — a black ink **network/web** (dark nodes + thin neighbour lines,
normal blending, NO bloom, NO core sprite, NO connection anchors). Renders when `--orb-mode:
network`. Nodes + lines share a position-based wobble shader so line endpoints always track their
nodes (they stay connected). Audio-reactive via opacity + a group breathing-scale, not per-node
jitter.

**Files:** Modify `frontend/components/OrbScene.tsx`.

**Interfaces consumed:** `readOrbTokens()` (Task 3), `ampFromBars()` (existing), `OrbState`.
**Interfaces produced:** `NetworkOrb` component (rendered by `SceneContents` when mode is network).

- [ ] **Step 1 — Network geometry builder.** Add a module function that builds node positions
  (centre-dense ball) + a capped neighbour line set:
  ```ts
  function buildNetwork(count: number, linkDist: number) {
    const pos = new Float32Array(count * 3);
    const scale = new Float32Array(count);
    const GA = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < count; i++) {
      const t = i / count;
      const inc = Math.acos(1 - 2 * t);
      const az = GA * i;
      const s = Math.sin(inc);
      // centre-dense radius so the web is dense in the middle, sparse at the edge
      const r = Math.pow(Math.random(), 1.5) * 0.78 + 0.04;
      pos[i * 3] = s * Math.cos(az) * r + (Math.random() - 0.5) * 0.04;
      pos[i * 3 + 1] = s * Math.sin(az) * r + (Math.random() - 0.5) * 0.04;
      pos[i * 3 + 2] = Math.cos(inc) * r + (Math.random() - 0.5) * 0.04;
      scale[i] = 0.5 + Math.random() * 0.9;
    }
    // neighbour lines: O(n^2) once at build; cap links/node + total segments
    const MAX_PER = 4, MAX_SEG = 7000, d2 = linkDist * linkDist;
    const seg: number[] = [];
    for (let i = 0; i < count && seg.length / 6 < MAX_SEG; i++) {
      let made = 0;
      for (let j = i + 1; j < count && made < MAX_PER; j++) {
        const dx = pos[i*3]-pos[j*3], dy = pos[i*3+1]-pos[j*3+1], dz = pos[i*3+2]-pos[j*3+2];
        if (dx*dx + dy*dy + dz*dz < d2) {
          seg.push(pos[i*3],pos[i*3+1],pos[i*3+2], pos[j*3],pos[j*3+1],pos[j*3+2]);
          made++;
        }
      }
    }
    const nodeGeo = new THREE.BufferGeometry();
    nodeGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    nodeGeo.setAttribute("aScale", new THREE.BufferAttribute(scale, 1));
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(seg), 3));
    return { nodeGeo, lineGeo };
  }
  ```
- [ ] **Step 2 — Shared wobble + shaders.** Add the GLSL (the wobble depends only on `position`,
  so a line endpoint coincident with a node moves identically → they never separate):
  ```ts
  const NET_WOBBLE = /* glsl */ `
    uniform float uTime; uniform float uAmp;
    vec3 orgPos(vec3 p){
      vec3 o = vec3(
        sin(uTime*0.6 + p.y*4.0 + p.z*3.1),
        sin(uTime*0.5 + p.z*4.0 + p.x*3.1),
        sin(uTime*0.7 + p.x*4.0 + p.y*3.1));
      vec3 dir = normalize(p + 1e-5);
      return p + o*0.014 + dir*(uAmp*0.10);
    }`;
  const NET_NODE_VERT = NET_WOBBLE + /* glsl */ `
    uniform float uSize; uniform float uPixelRatio; attribute float aScale;
    void main(){
      vec3 pos = orgPos(position);
      vec4 mv = modelViewMatrix * vec4(pos,1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = uSize * uPixelRatio * aScale * (1.0 + uAmp*0.4) / -mv.z;
    }`;
  const NET_NODE_FRAG = /* glsl */ `
    precision mediump float; uniform vec3 uColor; uniform float uOpacity;
    void main(){
      float d = length(gl_PointCoord - 0.5);
      if(d > 0.5) discard;
      float a = smoothstep(0.5, 0.30, d);
      gl_FragColor = vec4(uColor, a * uOpacity);
    }`;
  const NET_LINE_VERT = NET_WOBBLE + /* glsl */ `
    void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(orgPos(position),1.0); }`;
  const NET_LINE_FRAG = /* glsl */ `
    precision mediump float; uniform vec3 uColor; uniform float uOpacity;
    void main(){ gl_FragColor = vec4(uColor, uOpacity); }`;
  ```
- [ ] **Step 3 — `NetworkOrb` component.** Normal blending (ink over white), no bloom, no anchors:
  ```tsx
  function NetworkOrb({ state, bars }: { state: OrbState; bars: number[] }) {
    const { gl } = useThree();
    const tk = useMemo(readOrbTokens, []);
    const { nodeGeo, lineGeo } = useMemo(() => buildNetwork(tk.count, tk.linkDist), [tk.count, tk.linkDist]);
    const uniforms = useMemo(() => ({
      uTime: { value: 0 }, uAmp: { value: 0 },
      uSize: { value: 7 }, uPixelRatio: { value: 1 },
      uColor: { value: new THREE.Color(tk.color) },
      uOpacity: { value: tk.linkAlpha },
    }), [tk]);
    const nodeMat = useMemo(() => new THREE.ShaderMaterial({
      uniforms: { ...uniforms, uOpacity: { value: 0.85 } },
      vertexShader: NET_NODE_VERT, fragmentShader: NET_NODE_FRAG,
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.NormalBlending,
    }), [uniforms]);
    const lineMat = useMemo(() => new THREE.ShaderMaterial({
      uniforms: { ...uniforms, uOpacity: { value: tk.linkAlpha } },
      vertexShader: NET_LINE_VERT, fragmentShader: NET_LINE_FRAG,
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.NormalBlending,
    }), [uniforms, tk.linkAlpha]);
    const group = useRef<THREE.Group>(null);
    const extAmp = useRef(0); extAmp.current = ampFromBars(bars);
    const stateRef = useRef(state); stateRef.current = state;
    const reduceMotion = useMemo(() =>
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);
    useEffect(() => {
      const pr = Math.min(gl.getPixelRatio(), 2);
      nodeMat.uniforms.uPixelRatio.value = pr; lineMat.uniforms.uPixelRatio.value = pr;
    }, [gl, nodeMat, lineMat]);
    useEffect(() => () => {
      nodeGeo.dispose(); lineGeo.dispose(); nodeMat.dispose(); lineMat.dispose();
    }, [nodeGeo, lineGeo, nodeMat, lineMat]);
    useFrame((_, dtRaw) => {
      const dt = Math.min(dtRaw, 0.05); const t = performance.now() / 1000; const st = stateRef.current;
      let target = extAmp.current;
      if (!reduceMotion) {
        if (st === "idle") target = Math.max(target, 0.05 + 0.04 * Math.sin(t * 1.0));
        else if (st === "thinking") target = Math.max(target, 0.1 + 0.08 * Math.sin(t * 2.2));
      }
      const nu = nodeMat.uniforms, lu = lineMat.uniforms;
      nu.uTime.value = t; lu.uTime.value = t;
      nu.uAmp.value += (target - nu.uAmp.value) * Math.min(1, dt * 6);
      lu.uAmp.value = nu.uAmp.value;
      // ink "brighter" = a touch more opacity when speaking/listening
      const nodeOp = st === "speaking" ? 0.95 : st === "listening" ? 0.9 : 0.82;
      const lineOp = tk.linkAlpha * (st === "speaking" ? 1.25 : st === "listening" ? 1.12 : 1.0);
      nu.uOpacity.value += (nodeOp - nu.uOpacity.value) * Math.min(1, dt * 4);
      lu.uOpacity.value += (lineOp - lu.uOpacity.value) * Math.min(1, dt * 4);
      if (group.current && !reduceMotion) {
        group.current.rotation.y += dt * 0.04;
        group.current.rotation.x = Math.sin(t * 0.1) * 0.1;
        const s = 1 + nu.uAmp.value * 0.06; group.current.scale.setScalar(s);
      }
    });
    return (
      <group ref={group}>
        <lineSegments geometry={lineGeo} material={lineMat} />
        <points geometry={nodeGeo} material={nodeMat} />
      </group>
    );
  }
  ```
- [ ] **Step 4 — Wire the branch.** In `SceneContents`, replace the Task-3 `null` network branch
  with `tokens.mode === "network" && <NetworkOrb state={state} bars={bars} />`. Ensure
  `<EffectComposer><Bloom/></EffectComposer>` only renders in `sphere` mode (Ghost has bloom 0
  and ink colors — bloom must be OFF, not just 0, so the bright-pass can't lift the ink).
- [ ] **Step 5 — Verify:** browser — set `data-skin="ghost"` in devtools (Ghost vars land in Task 5;
  to test now, temporarily add `--orb-mode:network; --orb-color:#1a1a1c; --particle-count:1400;
  --orb-link-dist:0.34; --orb-link-alpha:0.5` to `:root`, OR do Task 5 first then return). Confirm:
  a dark web of dots + lines on the (currently dark) canvas, slow rotation, gentle breathe on
  speech, no bloom/glow, no WebGL/console errors. Switching back to `arc` restores the cyan sphere.
  `npx tsc --noEmit` clean.
- [ ] **Step 6 — Commit** `feat(frontend): Ghost network-orb render mode (ink web, no bloom)`.

---

### Task 5: Ghost skin — color + treatment (light / ink)
**Files:** Modify `frontend/app/globals.css` (add `[data-skin="ghost"]` block + light-surface
panel rule).

- [ ] **Step 1 — Consult minimalist + impeccable.** Invoke `taste-skill:minimalist-skill` and run
  `/impeccable critique` against the Ghost target (light paper, ink, flat, restrained) before
  setting values, so the knobs reflect real minimal-design discipline. On white, depth comes from
  a whisper of shadow + a hairline border, NOT glow.
- [ ] **Step 2 — Ghost var block:**
  ```css
  [data-skin="ghost"] {
    --zenith-bg: 247 247 245; --zenith-cyan: 24 24 27; --zenith-blue: 90 96 104;
    --zenith-text: 30 30 34; --zenith-alert: 180 83 9; --zenith-red: 200 30 46;
    --orb-color: #1a1a1c; --orb-cool: #4a4f57; --orb-core: 18 18 20;
    --glow-strength: 0; --panel-tint: 0; --border-strength: 0.16;
    --notch: 0px; --radius: 0px; --motion-scale: 1.35; --bloom: 0; --particle-count: 1400;
    --orb-mode: network; --orb-link-dist: 0.34; --orb-link-alpha: 0.5;
  }
  ```
- [ ] **Step 3 — Light surfaces (depth without glow).** With `--panel-tint: 0` the cyan/inner-glow
  fills vanish, so cards would read as borderless on paper. Add a Ghost-scoped rule giving panels a
  white surface, a hairline ink border, and a *whisper* of soft shadow:
  ```css
  [data-skin="ghost"] .hud-card, [data-skin="ghost"] .panel {
    background: #ffffff;
    border: 1px solid rgb(var(--zenith-cyan) / 0.12);
    box-shadow: 0 1px 2px rgb(var(--zenith-cyan) / 0.05), 0 8px 24px rgb(var(--zenith-cyan) / 0.04);
  }
  ```
- [ ] **Step 4 — Flatten the background in Ghost.** The `.bg-aura` gradients already scale by
  `--panel-tint` (Task 1) → at 0 they vanish. Keep the faint grain + soft vignette. Verify the
  canvas reads as flat paper, not a dark field with the aura merely dimmed.
- [ ] **Step 5 — Type-forward labels (optional knob).** Add a `[data-skin="ghost"]` rule bumping
  `letter-spacing` on `.font-mono` section labels if the minimal feel needs it (verify visually).
- [ ] **Step 6 — Verify:** browser — set `data-skin=ghost`; screenshot. Check: near-white paper
  canvas, ink text, hairline-bordered white panels with a whisper shadow (not flat wireframes),
  square corners, the **ink network orb** (Task 4) reading as a dark web on white, amber still
  visible on an alert element. `npx tsc` clean.
- [ ] **Step 7 — Commit** `feat(frontend): Ghost skin — light/ink colors + minimal treatment`.

---

### Task 6: Ghost layout — Centered Focus + chrome trim
**Files:** Modify `frontend/app/page.tsx`.

**Interfaces consumed:** `useSkin()`.

- [ ] **Step 1 — Read skin in page:** `const { skin } = useSkin(); const ghost = skin === "ghost";`
- [ ] **Step 2 — Conditional columns:** when `ghost`, do not render the left dashboard column
  (Calendar/QuickActions/Usage) or the right column (Connections/Focus/Activity); render only the
  icon rail + centered orb/status/command-center. Use the existing `orbBig` sizing so the orb is
  larger in focus mode. Switch to a centered single-column layout when ghost (keep the grid valid).
- [ ] **Step 3 — One-line usage:** in ghost, render a compact one-line usage readout (req/day/tokens)
  in a corner instead of the three gauges. (Connection status is intentionally absent in Ghost —
  panels hidden + orb has no nodes — per spec; do not add a connection readout.)
- [ ] **Step 4 — Trim chrome:** when `ghost`, hide `<HexCorners/>` and simplify/hide the top timeline
  strip in `TopBar` (pass a `minimal` prop or gate inside).
- [ ] **Step 5 — Verify:** browser — toggle ghost on/off; screenshot both. Ghost = clean centered
  focus screen on paper with the ink web; switching back to Arc restores the full dark dashboard
  intact. `npx tsc` clean.
- [ ] **Step 6 — Commit** `feat(frontend): Ghost centered-focus layout + trimmed chrome`.

---

### Task 7: Settings skin picker + switch crossfade
**Files:** Create `frontend/components/SkinPicker.tsx`; modify the Settings rendering
(`PlaceholderView` usage in `page.tsx` → render `SkinPicker` when `view==="settings"`);
add the switch-transition class to `globals.css`.

**Interfaces consumed:** `useSkin()`, `SKINS`.

- [ ] **Step 1 — `SkinPicker.tsx`:** three cards (one per `SKINS` entry) showing a mini swatch
  (bg + accent + a sample card, from `SKINS[].swatch`) + label; active card marked; click →
  `setSkin(id)`. Apply emil component rules: `:active { transform: scale(.97) }`, hover behind
  `@media (hover:hover) and (pointer:fine)`, transitions on transform/opacity only. Build with
  `frontend-design` + `taste-skill` for the card design.
- [ ] **Step 2 — Wire into Settings:** in `page.tsx`, when `view==="settings"` render `<SkinPicker/>`
  instead of `<PlaceholderView view="settings"/>` (keep PlaceholderView for drafts/clients).
- [ ] **Step 3 — Switch crossfade (emil blur-mask):** on change add a class to the app root for
  ~220ms (`filter: blur(2px)` + slight opacity dip) with `var(--ease-out)`, then remove it; the
  Arc↔Ghost dark↔light swap is the one this matters most for. CSS:
  ```css
  .skin-swapping { filter: blur(2px); opacity: .85; transition: filter .22s var(--ease-out), opacity .22s var(--ease-out); }
  @media (prefers-reduced-motion: reduce) { .skin-swapping { filter: none; transition: opacity .15s linear; } }
  ```
  Drive it from `setSkin` (or a wrapper): add `.skin-swapping` to `document.body`, then remove
  after 220ms. The orb re-reads tokens on the same `skin` change (Task 3/4 effects fire).
- [ ] **Step 4 — Verify:** browser — open Settings, click each skin; confirm live apply, persistence
  across reload, and a smooth blurred crossfade (slow it 5× per emil to inspect, especially
  Arc↔Ghost). Check the reduced-motion path (opacity only).
- [ ] **Step 5 — Commit** `feat(frontend): Settings skin picker + blur-mask switch transition`.

---

### Task 8: Amethyst skin — color + rounded-glass treatment
**Files:** Modify `frontend/app/globals.css` (add `[data-skin="amethyst"]` block + corner override).

- [ ] **Step 1 — Amethyst var block:**
  ```css
  [data-skin="amethyst"] {
    --zenith-bg: 7 5 15; --zenith-cyan: 178 107 255; --zenith-blue: 106 91 255;
    --zenith-text: 238 230 251; --zenith-alert: 255 107 0; --zenith-red: 255 48 80;
    --orb-color: #b26bff; --orb-cool: #8a6bff; --orb-core: 230 215 255;
    --glow-strength: 1; --panel-tint: 1; --border-strength: 1;
    --notch: 0px; --radius: 18px; --motion-scale: 1; --bloom: 0.7; --particle-count: 28000;
    --orb-mode: sphere; --orb-link-dist: 0; --orb-link-alpha: 0;
  }
  ```
- [ ] **Step 2 — Rounded-glass corner override:** Arc/Ghost cards use the notch/square clip-path;
  Amethyst is rounded glass:
  ```css
  [data-skin="amethyst"] .hud-card, [data-skin="amethyst"] .panel {
    clip-path: none; border-radius: var(--radius); backdrop-filter: blur(8px);
  }
  ```
  Ensure `.hud-card-border::before` (inset stroke) also uses `border-radius: var(--radius)` under
  Amethyst so the hairline follows the rounded corner.
- [ ] **Step 3 — taste/impeccable pass:** invoke `taste-skill` + `/impeccable polish` to tune the
  violet/glow/blur so panels read premium, not garish (adjust accent/bg depth/blur if needed).
- [ ] **Step 4 — Verify:** browser — switch to Amethyst; screenshot. Rounded glass cards, violet
  accent + orb (sphere recolors via Task 3), deeper glow, no notched corners. `npx tsc` clean.
  (Layout still the dashboard here; bento comes in Task 9.)
- [ ] **Step 5 — Commit** `feat(frontend): Amethyst skin colors + rounded-glass treatment`.

---

### Task 9: Amethyst layout — Bento
**Files:** Modify `frontend/app/page.tsx`; add `.bento`/area classes to `globals.css`.

**Interfaces consumed:** `useSkin()`. Reuses existing panels (Calendar/Connections/Usage/Activity/
CommandCenter/Orb) as tile contents.

- [ ] **Step 1 — Bento grid CSS** in `globals.css` (scoped so it only applies under Amethyst):
  ```css
  [data-skin="amethyst"] .bento {
    display: grid; gap: 14px; height: 100%;
    grid-template-columns: 1fr 1fr 1fr;
    grid-template-rows: 1fr 1fr 0.86fr 88px;
    grid-template-areas:
      "orb orb conn" "orb orb usage" "cal cal activity" "cc cc cc";
  }
  ```
  Plus `.bento-orb{grid-area:orb} .bento-conn{grid-area:conn} .bento-usage{grid-area:usage}
  .bento-cal{grid-area:cal} .bento-activity{grid-area:activity} .bento-cc{grid-area:cc}`.
- [ ] **Step 2 — Conditional layout in `page.tsx`:** when `skin === "amethyst"`, render the center
  region as the bento grid: orb (hero), Connections, Usage, Calendar (as a horizontal event strip —
  reuse `CalendarPanel` in a wide variant or a row layout), Activity, and the CommandCenter as the
  slim full-width `cc` bar. Arc/Ghost paths unchanged. Reference the spec's bento grid (authoritative;
  the original `mock_amethyst_C2.html` is gone).
- [ ] **Step 3 — Tighten Usage tile** vertical rhythm (the one flagged loose spot in the mockup).
- [ ] **Step 4 — Verify:** browser — switch Amethyst; screenshot. Bento reads balanced (orb hero,
  event strip, slim command bar); switching to Arc/Ghost restores their layouts. `npx tsc` clean.
- [ ] **Step 5 — Commit** `feat(frontend): Amethyst bento layout`.

---

### Task 10: Cross-skin verification + design QA
- [ ] **Step 1 — Screenshot matrix:** via chrome-devtools MCP, capture all three skins (Arc, Ghost,
  Amethyst) for the main HUD AND the boot screen (use the rAF-freeze trick for boot). Confirm Arc
  unchanged, Ghost light/ink-network focus-mode, Amethyst premium violet bento.
- [ ] **Step 2 — Impeccable QA:** run `/impeccable critique` + the slop-detector CLI over `frontend/`;
  fix any flagged generic-AI patterns. Pay attention to Ghost-on-white (contrast, shadow weight).
- [ ] **Step 3 — Motion review (emil):** confirm switch crossfade < 300ms (esp. Arc↔Ghost dark↔light),
  ambient motion slowed only in Ghost (interactions still snappy), reduced-motion disables movement
  everywhere (sphere + network orb).
- [ ] **Step 4 — Regression:** `/opacity` classes render correctly in every skin; the orb switches
  cleanly between sphere and network modes with no WebGL/console errors and no GPU-memory leak
  (geometries/materials/textures disposed on switch); persistence works.
- [ ] **Step 5 — Final commit / docs:** update `MEMORY.md` + `CLAUDE.md` UI section + the spec status
  to "shipped". Commit `docs: skins v1 (Arc/Ghost/Amethyst) shipped`.

---

## Self-Review
- **Spec coverage:** token system (T1), provider/no-flash/persistence (T2), sphere orb tokens
  (T3), **Ghost network-orb mode (T4)**, Ghost light colors+treatment (T5) + layout+chrome (T6),
  Settings picker + switch transition (T7), Amethyst colors/glass (T8) + bento (T9), cross-skin
  verification incl. boot-per-skin + reduced-motion + Impeccable + dispose-on-switch (T10). All
  spec sections mapped, including the revised light-Ghost + `--orb-mode` network path.
- **Placeholders:** skin value blocks and key code (provider, token reader, network geometry +
  shaders + component) are concrete; globals.css conversions specified as explicit rules over the
  known 18 sites (Task 1). The only deferred bit is T3 Step 6's `null` network branch, explicitly
  filled by T4 (incremental, not a placeholder). Verification is browser/tsc/Impeccable, not a JS
  test runner, because none exists in this repo (stated up front).
- **Type consistency:** `SkinId`, `useSkin()`, `SKINS`, `isSkinId()`, `readOrbTokens()`,
  `makeGlowTexture(color, core)`, `buildSphereGeometry(count)`, `buildNetwork(count, linkDist)`,
  `NetworkOrb`, `ampFromBars()`, `OrbState` referenced consistently across tasks.
- **Order:** infra (T1–3) precedes skins; the Ghost network orb (T4) lands before Ghost colors
  (T5) so the mode exists when Ghost flips to it; Ghost (T4–6) before Amethyst (T8–9) per owner;
  picker (T7) sits between so both skins are switchable for QA.
