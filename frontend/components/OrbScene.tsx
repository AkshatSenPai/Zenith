"use client";

// Zenith orb — a glowing particle sphere (WebGL / react-three-fiber).
// ~28k additive points on a Fibonacci shell + an inner haze for a bright dense core,
// Bloom for the glow, slow rotation. Audio-reactive via the `bars` feed: the core
// breathes/brightens and particles displace OUTWARD while brightness flows INWARD
// (energy gathering to the core) — NO per-node ballooning. 4 states, no rings.
//
// Colors / bloom / particle-count come from CSS vars (--orb-* / --bloom / --particle-count)
// keyed by data-skin, so Arc stays identical and Amethyst recolors for free (Task 3). A
// second `--orb-mode: network` render mode (Ghost ink web) lands in Task 4.
// Loaded client-only by ZenithOrb.tsx (ssr:false). See TODO.md §2 / PRD §6.

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";
import type { Connection } from "../lib/mock";
import type { OrbState, ZenithOrbProps } from "./ZenithOrb";
import { useSkin } from "./SkinProvider";

const SHELL_RATIO = 0.6; // mostly a soft surface shell; the rest concentrate toward the centre

type Anchor = { channel: Connection["channel"]; pos: [number, number, number] };
// Fixed cardinal anchors around the sphere — they do NOT rotate with the cloud.
// All four at the SAME radius so they sit symmetrically INSIDE the camera frustum
// (the old ±1.98 left/right anchors fell outside it, so Calendar/Discord were off-screen).
const ANCHOR_R = 1.45;
const ANCHORS: Anchor[] = [
  { channel: "Gmail", pos: [0, ANCHOR_R, 0] },
  { channel: "Calendar", pos: [ANCHOR_R, 0, 0] },
  { channel: "Telegram", pos: [0, -ANCHOR_R, 0] }, // WhatsApp parked — Telegram takes the bottom slot
  { channel: "Discord", pos: [-ANCHOR_R, 0, 0] },
];

/** Aggregate the live frequency bars into a single 0–1 amplitude. */
function ampFromBars(bars: number[]): number {
  if (!bars.length) return 0;
  let sum = 0;
  let max = 0;
  for (const v of bars) {
    sum += v;
    if (v > max) max = v;
  }
  const avg = sum / bars.length;
  return Math.min(1, (avg * 0.6 + max * 0.4) * 1.5);
}

export type OrbTokens = {
  mode: "sphere" | "network";
  color: string;
  cool: string;
  core: string;
  bloom: number;
  count: number;
  linkDist: number;
  linkAlpha: number;
};

/** Read the orb's colors + knobs from the active skin's CSS vars on <html>. */
export function readOrbTokens(): OrbTokens {
  const cs = getComputedStyle(document.documentElement);
  const num = (k: string, d: number) => {
    const v = parseFloat(cs.getPropertyValue(k));
    return Number.isFinite(v) ? v : d;
  };
  const str = (k: string, d: string) => cs.getPropertyValue(k).trim() || d;
  const rgb = (k: string, d: string) => {
    const v = cs.getPropertyValue(k).trim();
    return v ? `rgb(${v.split(/\s+/).join(",")})` : d;
  };
  return {
    mode: str("--orb-mode", "sphere") as "sphere" | "network",
    color: str("--orb-color", "#00ffe5"),
    cool: str("--orb-cool", "#39d6ff"),
    core: rgb("--orb-core", "rgb(190,255,250)"),
    bloom: num("--bloom", 0.7),
    count: Math.round(num("--particle-count", 28000)),
    linkDist: num("--orb-link-dist", 0.34),
    linkAlpha: num("--orb-link-alpha", 0.5),
  };
}

/** Parse a hex or rgb()/space-channel CSS color into an `rgba(r,g,b,a)` string WITHOUT any
 *  colorspace conversion — so the canvas gradient matches the literal sRGB values exactly
 *  (THREE.Color would linearize and shift Arc's look). */
function toRGBA(css: string, a: number): string {
  const s = css.trim();
  if (s[0] === "#") {
    let h = s.slice(1);
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const n = parseInt(h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  const m = s.match(/[\d.]+/g) || ["0", "0", "0"];
  return `rgba(${m[0]},${m[1]},${m[2]},${a})`;
}

/** Soft radial sprite for the bright central core (additive). `core` = densest inner tint,
 *  `color` = the accent the glow fades out through. */
function makeGlowTexture(color: string, core: string): THREE.Texture {
  const s = 128;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.18, toRGBA(core, 0.9));
  g.addColorStop(0.5, toRGBA(color, 0.35));
  g.addColorStop(1, toRGBA(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Build the Fibonacci-shell + inner-haze sphere geometry for `count` points. */
function buildSphereGeometry(count: number): THREE.BufferGeometry {
  const positions = new Float32Array(count * 3);
  const scales = new Float32Array(count);
  const phases = new Float32Array(count);
  const radii = new Float32Array(count);
  const GA = Math.PI * (3 - Math.sqrt(5)); // golden angle
  for (let i = 0; i < count; i++) {
    const shell = Math.random() < SHELL_RATIO;
    let x: number;
    let y: number;
    let z: number;
    if (shell) {
      const t = i / count;
      const inc = Math.acos(1 - 2 * t); // even latitude
      const az = GA * i; // golden-angle longitude
      const sinc = Math.sin(inc);
      x = sinc * Math.cos(az);
      y = sinc * Math.sin(az);
      z = Math.cos(inc);
    } else {
      const u = Math.random() * 2 - 1; // random direction for the inner haze
      const az = Math.random() * Math.PI * 2;
      const sx = Math.sqrt(1 - u * u);
      x = sx * Math.cos(az);
      y = sx * Math.sin(az);
      z = u;
    }
    // shell = a soft band near the surface (defines the sphere, stays see-through);
    // interior = concentrated toward the centre (^1.8) so the core reads dense + bright
    // while the edges stay sparse — that's the reference look, not a filled disc.
    const r = shell ? 0.84 + Math.random() * 0.16 : Math.pow(Math.random(), 1.8) * 0.82;
    const j = shell ? 0.02 : 0.0; // tiny jitter so the shell isn't a perfect surface
    positions[i * 3] = (x + (Math.random() - 0.5) * j) * r;
    positions[i * 3 + 1] = (y + (Math.random() - 0.5) * j) * r;
    positions[i * 3 + 2] = (z + (Math.random() - 0.5) * j) * r;
    radii[i] = r;
    scales[i] = shell ? 0.35 + Math.random() * 0.5 : 0.55 + Math.random() * 0.7;
    phases[i] = Math.random() * Math.PI * 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  g.setAttribute("aScale", new THREE.BufferAttribute(scales, 1));
  g.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
  g.setAttribute("aRadius", new THREE.BufferAttribute(radii, 1));
  return g;
}

/** Build the Ghost ink-web: centre-dense node positions + a capped neighbour line set.
 *  Lines are computed once at build; their endpoints coincide with node positions so the
 *  shared wobble shader keeps them attached. */
function buildNetwork(count: number, linkDist: number): {
  nodeGeo: THREE.BufferGeometry;
  lineGeo: THREE.BufferGeometry;
} {
  const pos = new Float32Array(count * 3);
  const scale = new Float32Array(count);
  const GA = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const t = i / count;
    const inc = Math.acos(1 - 2 * t);
    const az = GA * i;
    const s = Math.sin(inc);
    // radius: a hollow-ish centre (min 0.14) so the web reads as an airy sphere of links,
    // mildly denser toward the middle — NOT a solid black core.
    const r = Math.pow(Math.random(), 1.3) * 0.66 + 0.14;
    pos[i * 3] = s * Math.cos(az) * r + (Math.random() - 0.5) * 0.04;
    pos[i * 3 + 1] = s * Math.sin(az) * r + (Math.random() - 0.5) * 0.04;
    pos[i * 3 + 2] = Math.cos(inc) * r + (Math.random() - 0.5) * 0.04;
    scale[i] = 0.5 + Math.random() * 0.9;
  }
  // neighbour lines: O(n^2) once at build; cap links/node + total segments. Kept modest so
  // overlapping lines don't sum to an opaque black mass (the web must stay see-through).
  const MAX_PER = 3;
  const MAX_SEG = 2200;
  const d2 = linkDist * linkDist;
  const seg: number[] = [];
  for (let i = 0; i < count && seg.length / 6 < MAX_SEG; i++) {
    let made = 0;
    for (let j = i + 1; j < count && made < MAX_PER; j++) {
      const dx = pos[i * 3] - pos[j * 3];
      const dy = pos[i * 3 + 1] - pos[j * 3 + 1];
      const dz = pos[i * 3 + 2] - pos[j * 3 + 2];
      if (dx * dx + dy * dy + dz * dz < d2) {
        seg.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]);
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

const VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uAmp;
  uniform float uSize;
  uniform float uPixelRatio;
  attribute float aScale;
  attribute float aPhase;
  attribute float aRadius;
  varying float vBright;
  void main() {
    vec3 pos = position;
    vec3 dir = normalize(position + 1e-5);
    // idle shimmer: tiny per-particle radial wobble so it reads alive, never static
    float wob = sin(uTime * 0.7 + aPhase) * 0.010;
    // audio: displace OUTWARD, outer particles move more
    float disp = uAmp * (0.05 + 0.16 * aRadius);
    pos += dir * (wob + disp);
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uPixelRatio * aScale * (1.0 + uAmp * 0.5) / -mv.z;
    // Radial brightness falloff: the CENTRE glows, the shell stays dim. This is what makes
    // it read as "bright core + sparse dim edge" instead of one uniformly-glowing ball.
    float radial = clamp(1.0 - aRadius, 0.0, 1.0); // 1 at centre, ~0 at the shell
    float radialFall = 0.3 + 0.7 * radial;
    float base = (0.3 + 0.7 * aScale) * radialFall;
    float shimmer = 0.8 + 0.2 * sin(uTime * 0.9 + aPhase * 1.7);
    // audio: brightness flows INWARD — inner particles brighten most as amp rises
    vBright = base * shimmer + uAmp * 0.8 * radial;
  }
`;

const FRAGMENT = /* glsl */ `
  precision mediump float;
  uniform vec3 uColor;
  uniform vec3 uCool;
  uniform float uCoolMix;
  uniform float uBright;
  varying float vBright;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.0, d);
    a *= a; // soft glow falloff
    vec3 col = mix(uColor, uCool, uCoolMix) * vBright * uBright;
    gl_FragColor = vec4(col, a);
  }
`;

// ---- Ghost network-orb shaders (ink web) ----
// The wobble depends ONLY on position, so a line endpoint coincident with a node moves
// identically → nodes and their lines never separate. Audio drives a uniform amp, not
// per-node jitter, so the whole web breathes/expands rather than scattering.
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

/** Faint spoke from the sphere surface out to a connected anchor (connection map). */
function Spoke({ anchor, color }: { anchor: Anchor; color: string }) {
  const obj = useMemo(() => {
    const v = new THREE.Vector3(...anchor.pos);
    const dir = v.clone().normalize();
    const geo = new THREE.BufferGeometry().setFromPoints([
      dir.clone().multiplyScalar(1.02),
      dir.clone().multiplyScalar(v.length() - 0.3),
    ]);
    const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      depthTest: false,
    });
    return new THREE.Line(geo, mat);
  }, [anchor, color]);
  useEffect(() => () => {
    obj.geometry.dispose();
    (obj.material as THREE.Material).dispose();
  }, [obj]);
  return <primitive object={obj} />;
}

/** Labelled connection anchors around the sphere — lit when connected, dim when not.
 *  Label/dot colors theme via Tailwind `*-zenith-cyan`; the inline glows + spoke use the
 *  accent CSS var / token so Amethyst recolors automatically. */
function Anchors({ connections, color }: { connections: Connection[]; color: string }) {
  return (
    <>
      {ANCHORS.map((a) => {
        const on = !!connections.find((c) => c.channel === a.channel)?.connected;
        return (
          <group key={a.channel}>
            {on && <Spoke anchor={a} color={color} />}
            <Html position={a.pos} center style={{ pointerEvents: "none" }}>
              <div
                className={`flex select-none items-center gap-1.5 whitespace-nowrap rounded-sm border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.18em] transition-colors duration-500 ${
                  on
                    ? "border-zenith-cyan/40 bg-black/55 text-zenith-cyan"
                    : "border-zenith-text/15 bg-black/40 text-zenith-text/40"
                }`}
                style={on ? { boxShadow: "0 0 12px rgb(var(--zenith-cyan) / 0.18)" } : undefined}
              >
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    on ? "bg-zenith-cyan" : "bg-transparent ring-1 ring-zenith-text/30"
                  }`}
                  style={on ? { boxShadow: "0 0 6px rgb(var(--zenith-cyan) / 0.9)" } : undefined}
                />
                {a.channel}
              </div>
            </Html>
          </group>
        );
      })}
    </>
  );
}

/** Ghost ink web: dark nodes + neighbour lines, normal blending, no bloom, no anchors.
 *  "Brighter" on speech/listen = a touch more opacity (it's ink, never a colour/glow). */
function NetworkOrb({ state, bars }: { state: OrbState; bars: number[] }) {
  const { gl } = useThree();
  const tk = useMemo(readOrbTokens, []);
  const { nodeGeo, lineGeo } = useMemo(
    () => buildNetwork(tk.count, tk.linkDist),
    [tk.count, tk.linkDist],
  );
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uAmp: { value: 0 },
      uSize: { value: 7 },
      uPixelRatio: { value: 1 },
      uColor: { value: new THREE.Color(tk.color) },
      uOpacity: { value: tk.linkAlpha },
    }),
    [tk],
  );
  const nodeMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { ...uniforms, uOpacity: { value: 0.85 } },
        vertexShader: NET_NODE_VERT,
        fragmentShader: NET_NODE_FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.NormalBlending,
      }),
    [uniforms],
  );
  const lineMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { ...uniforms, uOpacity: { value: tk.linkAlpha } },
        vertexShader: NET_LINE_VERT,
        fragmentShader: NET_LINE_FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.NormalBlending,
      }),
    [uniforms, tk.linkAlpha],
  );
  const group = useRef<THREE.Group>(null);
  const extAmp = useRef(0);
  extAmp.current = ampFromBars(bars);
  const stateRef = useRef(state);
  stateRef.current = state;
  const reduceMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );
  useEffect(() => {
    const pr = Math.min(gl.getPixelRatio(), 2);
    nodeMat.uniforms.uPixelRatio.value = pr;
    lineMat.uniforms.uPixelRatio.value = pr;
  }, [gl, nodeMat, lineMat]);
  useEffect(
    () => () => {
      nodeGeo.dispose();
      lineGeo.dispose();
      nodeMat.dispose();
      lineMat.dispose();
    },
    [nodeGeo, lineGeo, nodeMat, lineMat],
  );
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const t = performance.now() / 1000;
    const st = stateRef.current;
    let target = extAmp.current;
    if (!reduceMotion) {
      if (st === "idle") target = Math.max(target, 0.05 + 0.04 * Math.sin(t * 1.0));
      else if (st === "thinking") target = Math.max(target, 0.1 + 0.08 * Math.sin(t * 2.2));
    }
    const nu = nodeMat.uniforms;
    const lu = lineMat.uniforms;
    nu.uTime.value = t;
    lu.uTime.value = t;
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
      const s = 1 + nu.uAmp.value * 0.06;
      group.current.scale.setScalar(s);
    }
  });
  return (
    <group ref={group}>
      <lineSegments geometry={lineGeo} material={lineMat} />
      <points geometry={nodeGeo} material={nodeMat} />
    </group>
  );
}

function SceneContents({ state = "idle", connections = [], bars = [] }: ZenithOrbProps) {
  const { gl } = useThree();
  const { skin } = useSkin();

  // Skin tokens drive colors/bloom/particle-count. Re-read on skin change; the no-flash
  // script has already set data-skin before paint so the first read is correct.
  const [tokens, setTokens] = useState<OrbTokens>(readOrbTokens);
  useEffect(() => {
    setTokens(readOrbTokens());
  }, [skin]);

  // Geometry rebuilds only when the particle count changes (rare — a skin switch).
  const geometry = useMemo(() => buildSphereGeometry(tokens.count), [tokens.count]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  // Core sprite texture follows the accent + core tint; swap + dispose on change.
  const coreTex = useMemo(() => makeGlowTexture(tokens.color, tokens.core), [tokens.color, tokens.core]);
  useEffect(() => () => coreTex.dispose(), [coreTex]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uAmp: { value: 0 },
          uSize: { value: 9 },
          uPixelRatio: { value: 1 },
          uColor: { value: new THREE.Color("#00ffe5") },
          uCool: { value: new THREE.Color("#39d6ff") }, // cooler accent for "thinking"
          uCoolMix: { value: 0 },
          uBright: { value: 1 },
        },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);

  // Recolor the point material when the skin's accent/cool changes.
  useEffect(() => {
    material.uniforms.uColor.value.set(tokens.color);
    material.uniforms.uCool.value.set(tokens.cool);
  }, [material, tokens.color, tokens.cool]);

  const points = useRef<THREE.Points>(null);
  const core = useRef<THREE.Sprite>(null);
  const coreMat = useRef<THREE.SpriteMaterial>(null);

  // Latest external amplitude + state kept in refs so the per-frame GL work doesn't
  // depend on React re-rendering (bars change ~60fps; this keeps it cheap).
  const extAmp = useRef(0);
  extAmp.current = ampFromBars(bars);
  const stateRef = useRef<OrbState>(state);
  stateRef.current = state;

  const reduceMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  useEffect(() => {
    material.uniforms.uPixelRatio.value = Math.min(gl.getPixelRatio(), 2);
  }, [gl, material]);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const t = performance.now() / 1000;
    const st = stateRef.current;
    const u = material.uniforms;

    // Target amplitude: voice drives listening/speaking; idle/thinking get a gentle pulse.
    let target = extAmp.current;
    if (!reduceMotion) {
      if (st === "idle") target = Math.max(target, 0.05 + 0.04 * Math.sin(t * 1.1));
      else if (st === "thinking") target = Math.max(target, 0.1 + 0.09 * Math.sin(t * 2.4));
    }

    u.uTime.value = t;
    u.uAmp.value += (target - u.uAmp.value) * Math.min(1, dt * 6);

    const coolTarget = st === "thinking" ? 0.6 : 0.0; // cooler tone, never orange
    const brightTarget =
      st === "speaking" ? 1.35 : st === "listening" ? 1.18 : st === "thinking" ? 0.95 : 1.0;
    u.uCoolMix.value += (coolTarget - u.uCoolMix.value) * Math.min(1, dt * 4);
    u.uBright.value += (brightTarget - u.uBright.value) * Math.min(1, dt * 4);

    if (points.current && !reduceMotion) {
      points.current.rotation.y += dt * 0.05;
      points.current.rotation.x = Math.sin(t * 0.12) * 0.12;
    }

    const amp = u.uAmp.value;
    if (core.current) {
      const ct = 0.8 + amp * 0.5;
      const cur = core.current.scale.x;
      const nx = cur + (ct - cur) * Math.min(1, dt * 6);
      core.current.scale.set(nx, nx, nx);
    }
    if (coreMat.current) {
      const op = (st === "speaking" ? 0.85 : 0.5) + amp * 0.3;
      coreMat.current.opacity += (op - coreMat.current.opacity) * Math.min(1, dt * 5);
    }
  });

  // network mode (Ghost ink web): a separate component with its own geometry/shaders/loop.
  // No EffectComposer/Bloom here — bloom must be OFF (not just 0) so it can't lift the ink.
  if (tokens.mode === "network") {
    return <NetworkOrb state={state} bars={bars} />;
  }

  return (
    <>
      <points ref={points} geometry={geometry} material={material} />
      <sprite ref={core} scale={[0.8, 0.8, 0.8]}>
        <spriteMaterial
          ref={coreMat}
          map={coreTex}
          transparent
          depthWrite={false}
          depthTest={false}
          blending={THREE.AdditiveBlending}
          opacity={0.55}
        />
      </sprite>
      <Anchors connections={connections} color={tokens.color} />
      <EffectComposer>
        {/* threshold > 0 so ONLY the bright core blooms — the dim shell stays crisp points
            (this is what stops the whole ball glowing and the glow clipping to a square). */}
        <Bloom intensity={tokens.bloom} luminanceThreshold={0.32} luminanceSmoothing={0.2} mipmapBlur />
      </EffectComposer>
    </>
  );
}

export default function OrbScene(props: ZenithOrbProps) {
  return (
    <Canvas
      className="orb-canvas"
      dpr={[1, 2]}
      camera={{ position: [0, 0, 4.6], fov: 45 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      // overflow:visible (overrides r3f's default hidden) so the connection-node labels can
      // spill past the canvas box instead of being clipped when the orb shrinks (CC open).
      style={{ width: "100%", height: "100%", overflow: "visible" }}
    >
      <SceneContents {...props} />
    </Canvas>
  );
}
