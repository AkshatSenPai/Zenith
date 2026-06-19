import { cleanForSpeech } from "./format";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type RecordingHandle = {
  stop: () => Promise<Blob>;
  getLevel: () => number;
  /** n normalized (0–1) frequency-band magnitudes for a bar visualizer. */
  getBars: (n: number) => number[];
};

/** Downsample an analyser's frequency data into `n` normalized bars (voice band). */
function barsFromAnalyser(analyser: AnalyserNode, buf: Uint8Array, n: number): number[] {
  analyser.getByteFrequencyData(buf);
  const usable = Math.floor(buf.length * 0.7); // skip the near-silent top octave
  const per = Math.max(1, Math.floor(usable / n));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < per; j++) sum += buf[i * per + j] ?? 0;
    out.push(Math.min(1, (sum / per / 255) * 1.5)); // gentle boost
  }
  return out;
}

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

  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioCtx = new Ctx();
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  const buf = new Uint8Array(analyser.frequencyBinCount);
  const freqBuf = new Uint8Array(analyser.frequencyBinCount);

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
    getBars(n: number) {
      return barsFromAnalyser(analyser, freqBuf, n);
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

let _audio: HTMLAudioElement | null = null;
let _speechCtx: AudioContext | null = null;
let _speechAnalyser: AnalyserNode | null = null;
let _speechFreq: Uint8Array | null = null;

/** n normalized (0–1) bars from the current TTS playback, or [] when not speaking. */
export function getSpeechBars(n: number): number[] {
  if (!_speechAnalyser || !_speechFreq) return [];
  return barsFromAnalyser(_speechAnalyser, _speechFreq, n);
}

function teardownSpeechMeter(): void {
  _speechAnalyser = null;
  _speechFreq = null;
  if (_speechCtx) {
    void _speechCtx.close().catch(() => {});
    _speechCtx = null;
  }
}

/** Stop any in-flight TTS playback (called when the user starts a new recording). */
export function cancelSpeech(): void {
  if (_audio) {
    _audio.pause();
    _audio = null;
  }
  teardownSpeechMeter();
}

/** Speak text using the backend's neural TTS (/speak): browser-independent, plays the
 *  returned MP3. Resolves when playback ends; fails silently (the reply is shown as text). */
export async function speak(text: string): Promise<void> {
  if (typeof window === "undefined") return;
  const clean = cleanForSpeech(text);
  if (!clean) return;
  let url: string | null = null;
  try {
    const res = await fetch(`${API_URL}/speak`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: clean }),
    });
    if (!res.ok) return;
    cancelSpeech();
    url = URL.createObjectURL(await res.blob());
    const audio = new Audio(url);
    _audio = audio;

    // Tap the playback through a WebAudio analyser so the waveform reacts to TTS too.
    // Audio is connected to the destination first, so it stays audible even if the tap fails.
    try {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      void ctx.resume().catch(() => {});
      const src = ctx.createMediaElementSource(audio);
      src.connect(ctx.destination);
      const an = ctx.createAnalyser();
      an.fftSize = 256;
      src.connect(an);
      _speechCtx = ctx;
      _speechAnalyser = an;
      _speechFreq = new Uint8Array(an.frequencyBinCount);
    } catch {
      /* visualiser is optional; the <audio> element still plays */
    }

    await new Promise<void>((resolve) => {
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
      void audio.play().catch(() => resolve());
    });
  } catch {
    /* network/playback failed — the text reply is already visible */
  } finally {
    if (url) URL.revokeObjectURL(url);
    teardownSpeechMeter();
  }
}
