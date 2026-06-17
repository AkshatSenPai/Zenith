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

  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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
