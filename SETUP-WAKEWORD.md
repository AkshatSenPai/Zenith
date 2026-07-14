# Setup — Wake word "Zenith"

> **Status:** the wake-word feature is being built (branch `feat/wake-word`). These are the **owner
> setup steps** — the Picovoice account, AccessKey, and the trained "Zenith" model. You can do them
> now, in parallel with the build. The feature won't respond to "Zenith" until the code lands **and**
> these files are in place. Until then, hold-Space push-to-talk keeps working exactly as today.

The wake word uses **Picovoice Porcupine** running on-device (WebAssembly, in the app's webview).
Detection never leaves your machine.

---

## What you need (one-time, ~10 minutes)

1. A **free Picovoice account** — an **AccessKey** (identifies your account; free for personal use).
2. A **custom "Zenith" keyword model** trained in the Picovoice console for the **Web (WASM)** platform
   — a `.ppn` file.
3. The English **Porcupine params** file — a `.pv` file.

---

## Step 1 — Get your AccessKey

1. Sign up / log in at **https://console.picovoice.ai/**.
2. On the dashboard, copy your **AccessKey** (a long string).
3. Put it in **`backend/.env`** (create the line if it's not there):

   ```
   PICOVOICE_ACCESS_KEY=your-access-key-here
   ```

   > Zenith reads this from `.env` and hands it to the app at runtime — it is **never committed**
   > (the repo is public). If it's missing, the wake word simply stays off and PTT still works.
   > Optional: `ZENITH_WAKEWORD_SENSITIVITY=0.6` (0–1; higher = more sensitive / more false-triggers).

## Step 2 — Train the "Zenith" keyword

1. In the console, open **Porcupine → Wake Word**.
2. Create a new wake word: type **`Zenith`**, language **English**.
3. Choose platform **Web (WASM)** and **train / download** — you get a file like
   `Zenith_en_wasm_vX_X_X.ppn`.

   > The `.ppn` is **platform-specific** — it must be the **Web / WASM** build, not Windows/Linux/etc.

4. Rename it to **`Zenith.ppn`** and put it in **`frontend/public/wakeword/`** (create the folder):

   ```
   frontend/public/wakeword/Zenith.ppn
   ```

## Step 3 — Add the English params file

1. Download the English Porcupine params file **`porcupine_params.pv`** (from the Picovoice console's
   downloads, or the public `Picovoice/porcupine` GitHub repo under `lib/common/`).
2. Put it next to the keyword:

   ```
   frontend/public/wakeword/porcupine_params.pv
   ```

> Both files in `frontend/public/wakeword/` **are** committed — they're models, not secrets. Only the
> AccessKey stays in `.env`.

---

## After it's built — how to use it

- **On by default.** Launch Zenith and just say **"Zenith"** → a short chime, then speak your command
  (it auto-stops after a ~1.2s pause). No key to hold.
- **Mute it** anytime from the **LISTENING / MUTED** indicator in the top bar (or Settings) — muting
  **fully releases the mic**.
- **Push-to-talk still works** (hold **Space**), with the wake word on or off.
- Say **"Zenith"** while it's speaking to **interrupt** and start a new command.

## Troubleshooting

- **Nothing happens when I say "Zenith":** check `PICOVOICE_ACCESS_KEY` is in `backend/.env`, both files
  are in `frontend/public/wakeword/`, and the `.ppn` is the **Web/WASM** build. Watch the app console
  for a `[wakeword]` init line.
- **It false-triggers on normal talk:** lower `ZENITH_WAKEWORD_SENSITIVITY` (e.g. `0.4`). If a single
  word keeps mis-firing, we can add **"Hey Zenith"** as a second keyword (train one more `.ppn`).
- **It misses me:** raise the sensitivity a little, or speak "Zenith" a touch more distinctly.
- **AccessKey error / expired:** Porcupine validates the key online occasionally — make sure you're
  connected the first time it runs.
