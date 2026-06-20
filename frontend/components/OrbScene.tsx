"use client";

// Zenith orb — a glowing CYAN particle sphere (WebGL / react-three-fiber).
// ~46k additive points on a Fibonacci shell + an inner haze for a bright dense core,
// Bloom for the glow, slow rotation. Audio-reactive via the `bars` feed: the core
// breathes/brightens and particles displace OUTWARD while brightness flows INWARD
// (energy gathering to the core) — NO per-node ballooning. 4 states, all cyan, no rings.
// Loaded client-only by ZenithOrb.tsx (ssr:false). See TODO.md §2 / PRD §6.

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";
import type { Connection } from "../lib/mock";
import type { OrbState, ZenithOrbProps } from "./ZenithOrb";

// One <points> draw call. Lower this on weak GPUs (the 8GB MacBook) if it stutters.
// Kept modest on purpose: the sphere must read as a SEE-THROUGH cloud of distinct points
// (like the reference), not a solid glowing ball — count/size are the levers for that.
const PARTICLE_COUNT = 28000;
const SHELL_RATIO = 0.6; // mostly a soft surface shell; the rest concentrate toward the centre

type Anchor = { channel: Connection["channel"]; pos: [number, number, number] };
// Fixed cardinal anchors around the sphere — they do NOT rotate with the cloud.
// All four at the SAME radius so they sit symmetrically INSIDE the camera frustum
// (the old ±1.98 left/right anchors fell outside it, so Calendar/Discord were off-screen).
const ANCHOR_R = 1.45;
const ANCHORS: Anchor[] = [
  { channel: "Gmail", pos: [0, ANCHOR_R, 0] },
  { channel: "Calendar", pos: [ANCHOR_R, 0, 0] },
  { channel: "WhatsApp", pos: [0, -ANCHOR_R, 0] },
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

/** Soft radial sprite for the bright central core (additive). */
function makeGlowTexture(): THREE.Texture {
  const s = 128;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.18, "rgba(190,255,250,0.9)");
  g.addColorStop(0.5, "rgba(0,255,229,0.35)");
  g.addColorStop(1, "rgba(0,255,229,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
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

/** Faint cyan spoke from the sphere surface out to a connected anchor (connection map). */
function Spoke({ anchor }: { anchor: Anchor }) {
  const obj = useMemo(() => {
    const v = new THREE.Vector3(...anchor.pos);
    const dir = v.clone().normalize();
    const geo = new THREE.BufferGeometry().setFromPoints([
      dir.clone().multiplyScalar(1.02),
      dir.clone().multiplyScalar(v.length() - 0.3),
    ]);
    const mat = new THREE.LineBasicMaterial({
      color: 0x00ffe5,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      depthTest: false,
    });
    return new THREE.Line(geo, mat);
  }, [anchor]);
  useEffect(() => () => {
    obj.geometry.dispose();
    (obj.material as THREE.Material).dispose();
  }, [obj]);
  return <primitive object={obj} />;
}

/** Labelled connection anchors around the sphere — lit cyan when connected, dim when not. */
function Anchors({ connections }: { connections: Connection[] }) {
  return (
    <>
      {ANCHORS.map((a) => {
        const on = !!connections.find((c) => c.channel === a.channel)?.connected;
        return (
          <group key={a.channel}>
            {on && <Spoke anchor={a} />}
            <Html position={a.pos} center style={{ pointerEvents: "none" }}>
              <div
                className={`flex select-none items-center gap-1.5 whitespace-nowrap rounded-sm border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.18em] transition-colors duration-500 ${
                  on
                    ? "border-zenith-cyan/40 bg-black/55 text-zenith-cyan"
                    : "border-zenith-text/15 bg-black/40 text-zenith-text/40"
                }`}
                style={on ? { boxShadow: "0 0 12px rgba(0,255,229,0.18)" } : undefined}
              >
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    on ? "bg-zenith-cyan" : "bg-transparent ring-1 ring-zenith-text/30"
                  }`}
                  style={on ? { boxShadow: "0 0 6px rgba(0,255,229,0.9)" } : undefined}
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

function SceneContents({ state = "idle", connections = [], bars = [] }: ZenithOrbProps) {
  const { gl } = useThree();

  // Geometry: a Fibonacci shell + an inner haze. Built once.
  const geometry = useMemo(() => {
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const scales = new Float32Array(PARTICLE_COUNT);
    const phases = new Float32Array(PARTICLE_COUNT);
    const radii = new Float32Array(PARTICLE_COUNT);
    const GA = Math.PI * (3 - Math.sqrt(5)); // golden angle
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const shell = Math.random() < SHELL_RATIO;
      let x: number;
      let y: number;
      let z: number;
      if (shell) {
        const t = i / PARTICLE_COUNT;
        const inc = Math.acos(1 - 2 * t); // even latitude
        const az = GA * i; // golden-angle longitude
        const sinc = Math.sin(inc);
        x = sinc * Math.cos(az);
        y = sinc * Math.sin(az);
        z = Math.cos(inc);
      } else {
        const u = Math.random() * 2 - 1; // random direction for the inner haze
        const az = Math.random() * Math.PI * 2;
        const s = Math.sqrt(1 - u * u);
        x = s * Math.cos(az);
        y = s * Math.sin(az);
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
  }, []);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uAmp: { value: 0 },
          uSize: { value: 9 },
          uPixelRatio: { value: 1 },
          uColor: { value: new THREE.Color("#00ffe5") },
          uCool: { value: new THREE.Color("#39d6ff") }, // cooler cyan for "thinking"
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

  const coreTex = useMemo(makeGlowTexture, []);
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

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
      coreTex.dispose();
    },
    [geometry, material, coreTex],
  );

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
      <Anchors connections={connections} />
      <EffectComposer>
        {/* threshold > 0 so ONLY the bright core blooms — the dim shell stays crisp points
            (this is what stops the whole ball glowing and the glow clipping to a square). */}
        <Bloom intensity={0.7} luminanceThreshold={0.32} luminanceSmoothing={0.2} mipmapBlur />
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
