# Copy Factory (M6 Part 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Three **output-only** tools that draft, in the owner's voice, a coherent multi-stage email/WhatsApp **sequence**, **ad copy + creative brief** (Meta/Google), and **landing/funnel copy** — from a client brief read out of the M6-Part-1 vault. Copy only; nothing is sent or wired to Arkquen.

**Architecture:** Claude is the copywriter. Each tool is a thin **brief-assembler**: it (1) resolves the brief (a `clients/<name>.md` vault note, else the inline text), (2) pulls the owner's voice/style from the vault, and (3) returns a structured **directive** — the brief + voice + the exact output format — as the tool result. The EXISTING loop's Claude then writes the finished deliverable in its reply, which renders in the Command Center (copy/save already exist) and can be saved to the vault via the EXISTING `save_note`. No second Claude call, no new HUD, no route/gate change.

**Tech Stack:** Python stdlib + the Part-1 `vault_service`. Reuses `tools.py` registration and `claude_service.run_loop`.

## Global Constraints

- **Output-only. NONE of the three tools are in `ACTION_TOOLS` or gated.** They return text. (verbatim: "OUTPUT-ONLY (they return drafts) — NOT in ACTION_TOOLS, NOT gated, NOTHING wired to Arkquen")
- **Reads the vault for the brief AND the voice.** Each tool takes a **client name OR an inline brief**: match `clients/<name>.md` → read it; else treat the passed text as the brief. Voice-match from `notes/voice.md` + recent `clients/` drafts; if nothing to learn from, write clean professional copy.
- **Use the brief's REAL specifics** (price, location, approvals, USPs). Specifics convert; generic doesn't.
- **WhatsApp = real Meta WABA templates** — positional `{{1}}`/`{{2}}` format, each tagged by **Category (Marketing / Utility / Authentication)**, header/body/footer/buttons where relevant, + a variable legend. Meta approval still required (we improve odds, don't skip it).
- **Language = en | hi | hinglish** (Telugu on request). Hinglish stays **Latin script only** (the existing system-prompt rule).
- **Vault reads here are TRUSTED** (owner's own briefs) — not fenced; consistent with Part 1.
- **`MAX_TOKENS` 1024 → 8192** in `claude_service` so a full sequence isn't truncated. 8192 is non-streaming-safe (SDK's streaming-required threshold is ~16K for Sonnet 4.6, which caps at 64K output); normal replies still stop on their own.
- **OUT OF SCOPE (do NOT build):** any Arkquen integration / sending, WhatsApp Business API sending (Phase-2), M7 proactivity/triage, image/video **generation** (Zenith writes the creative *brief*, not the asset).

---

## The OUTPUT FORMATS (what Claude produces — shown to the owner before build)

### 1. `draft_sequence` — EMAIL stage
```
### STAGE 2 — Nurture (1 of 3)   ·   trigger: 1 day after enquiry, no booking
Subject A: <≤6 words, specific>
Subject B: <variant>
Subject C: <variant>
Preview: <40-90 chars>
Body:
Hi {{first_name}},
<2-4 short paragraphs using the brief's real price / location / approvals / USPs>
<single clear CTA line>
— {{sender_name}}, {{company}}
```
### 1. `draft_sequence` — WHATSAPP (WABA template) stage
```
### STAGE 2 — Nurture (1 of 3)
Template name: shadnagar_nurture_01
Category: Marketing            ← Marketing | Utility | Authentication
Header (optional): <text or {image}>
Body:
Hi {{1}}, {{2}} plots in {{3}} start at {{4}}/sq yd, {{5}}-approved. Want the layout + price sheet?
Footer (optional): <e.g. "Reply STOP to opt out">
Buttons: [Quick reply: Send layout] · [Quick reply: Book a visit] · [URL: {{6}}]
Variables: {{1}}=first_name {{2}}=project {{3}}=location {{4}}=price {{5}}=approval {{6}}=link
```
Stages (each builds on the last): **Enquiry/Welcome → Nurture (2-4) → Booking push → Appointment reminder → No-show/Re-engage.** `channel=email` → email blocks only; `whatsapp` → WABA only; `both` → both per stage. Ends with a consolidated **Variable legend** + an **Approval note** (submit each template under its tagged category).

### 2. `draft_ad_copy` — Meta
```
PRIMARY TEXT
  1: <hook + offer + CTA, 1-3 short lines>
  2: <variant, different angle>
  3: <variant>
HEADLINES (≤40 chars):  1: …   2: …   3: …
DESCRIPTIONS (≤30 chars):  1: …   2: …
CREATIVE BRIEF (for the designer)
  Visual direction: <what the image/video shows>
  Hook (first line / first 3s): <…>
  Format: <single image | carousel | reel>, aspect <4:5 | 1:1 | 9:16>
  On-image text: <≤6 words>
  CTA button: <Learn More | Book Now | Get Offer>
```
### 2. `draft_ad_copy` — Google (RSA)
```
HEADLINES (up to 15, ≤30 chars each):  1: …  2: …  …
DESCRIPTIONS (up to 4, ≤90 chars each):  1: …  2: …
KEYWORD THEMES:  - <theme>: kw, kw, kw
DISPLAY PATHS:  /<path1> /<path2>
```

### 3. `draft_landing_copy`
```
HERO        Headline: …   Subhead: …   Primary CTA: …
TRUST / APPROVALS   - RERA <no.>, bank approvals, <years in market> …
BENEFITS    (3-5, each with a real specific)  - <benefit>: <proof>
HOW IT WORKS  (optional, 3 steps)
FAQ         (4-6)   Q: … / A: …
FINAL CTA   Headline: …   Button: …   Risk-reversal / urgency: …
```

---

## File Structure
- **Create `backend/copy_factory.py`** — `resolve_brief`, `voice_context`, and `build_sequence_brief` / `build_ad_brief` / `build_landing_brief` (each returns the directive string). The only new module.
- **Modify `backend/tools.py`** — 3 tool schemas + 3 executors + 3 `_EXECUTORS` entries + activity-target hints. NOT in `ACTION_TOOLS`/`UNTRUSTED_TOOLS`.
- **Modify `backend/claude_service.py`** — `MAX_TOKENS = 8192`; add a Copy-Factory line to `ZENITH_PROMPT`.
- **Create `backend/test_copy_factory.py`** — brief resolution, voice context, the three directives, tool registration/gating.

---

## Task 1: copy_factory — brief resolution + voice context

**Files:** Create `backend/copy_factory.py`; Test `backend/test_copy_factory.py`

**Interfaces:** Produces `resolve_brief(client_or_brief: str) -> tuple[str, str | None]` (brief_text, client_name|None); `voice_context() -> str`.

- [ ] **Step 1: Failing tests**
```python
"""M6 Part 2 — Copy Factory: brief resolution (vault note vs inline), voice context, and the three
output-only directive builders. The tools return a DIRECTIVE (brief + voice + format) — Claude writes
the actual copy in the loop, so these tests assert the directive content, not generated copy."""

import pytest
import copy_factory
import vault_service


@pytest.fixture(autouse=True)
def _vault(tmp_path, monkeypatch):
    root = tmp_path / "Zenith Vault"
    root.mkdir()
    monkeypatch.setenv("ZENITH_VAULT_PATH", str(root))
    return root


def test_resolve_brief_from_vault_client_note(_vault):
    vault_service.save_note("clients", "Shadnagar Heights", "Villa plots, 166 sq yd, Rs 21000/sq yd.", "new")
    brief, name = copy_factory.resolve_brief("Shadnagar Heights")
    assert "21000" in brief and name == "Shadnagar Heights"


def test_resolve_brief_falls_back_to_inline(_vault):
    brief, name = copy_factory.resolve_brief("Brand new gym in Pune, Rs 1500/month, first class free.")
    assert "Pune" in brief and name is None


def test_voice_context_reads_voice_note_else_empty(_vault):
    assert copy_factory.voice_context() == ""           # nothing to learn from yet
    vault_service.save_note("notes", "voice", "Warm, direct, no fluff. Short sentences.", "new")
    assert "no fluff" in copy_factory.voice_context()
```

- [ ] **Step 2: Run → FAIL** (`./.venv/Scripts/python.exe -m pytest test_copy_factory.py -q`).

- [ ] **Step 3: Implement `backend/copy_factory.py` (this part)**
```python
"""Zenith — Copy Factory (M6 Part 2). OUTPUT-ONLY draft builders. Each tool resolves a brief from the
vault (or inline text), pulls the owner's writing voice from the vault, and returns a structured
DIRECTIVE (brief + voice + exact output format). Claude writes the finished copy in the loop — these
functions never call Claude and never send anything."""

from __future__ import annotations

import vault_service


def resolve_brief(client_or_brief: str) -> tuple[str, str | None]:
    """If the arg matches a clients/<name>.md note, return (its content, name); else (inline text, None)."""
    s = (client_or_brief or "").strip()
    if not s:
        return "", None
    # try the clients/ folder first (exact note), then a title match anywhere
    note = vault_service.read(f"clients/{s}") or vault_service.read(s)
    if note is not None and len(s) < 80 and "\n" not in s:   # a name, not a pasted brief
        return note, s
    return s, None


def voice_context() -> str:
    """The owner's writing style: notes/voice.md plus up to 2 recent client notes as samples. Pragmatic
    — returns '' when there's nothing to learn from (Claude then writes clean professional copy)."""
    parts: list[str] = []
    voice = vault_service.read("notes/voice")
    if voice:
        parts.append(voice.strip())
    for n in vault_service.list_notes("clients", recent=2):
        body = vault_service.read(n["path"])
        if body:
            parts.append(f"[sample: {n['title']}]\n{body.strip()[:600]}")
    return "\n\n".join(parts).strip()
```

- [ ] **Step 4: Run → PASS** (the build_* tests fail until Task 2). **Step 5: Commit** `feat(copy): brief resolution + voice context`.

---

## Task 2: the three directive builders

**Files:** Modify `backend/copy_factory.py`; Test `backend/test_copy_factory.py`

**Interfaces:** Produces `build_sequence_brief(client_or_brief, channel="both", language="en") -> str`; `build_ad_brief(client_or_brief, platform="meta", language="en") -> str`; `build_landing_brief(client_or_brief, language="en") -> str`.

- [ ] **Step 1: Failing tests** (append)
```python
def test_sequence_directive_has_brief_voice_format_and_language(_vault):
    vault_service.save_note("clients", "Shadnagar Heights", "Villa plots at Rs 21000/sq yd.", "new")
    d = copy_factory.build_sequence_brief("Shadnagar Heights", channel="both", language="hinglish")
    assert "21000" in d                       # real specifics
    assert "WABA" in d and "{{1}}" in d        # WhatsApp template format
    assert "Marketing" in d                    # category tagging
    assert "{{first_name}}" in d               # email merge var
    assert "hinglish" in d.lower() and "Latin" in d
    assert "Enquiry" in d and "No-show" in d   # the journey stages


def test_sequence_channel_filter(_vault):
    email_only = copy_factory.build_sequence_brief("Gym, Rs 1500/mo", channel="email")
    assert "{{first_name}}" in email_only and "WABA" not in email_only
    wa_only = copy_factory.build_sequence_brief("Gym, Rs 1500/mo", channel="whatsapp")
    assert "WABA" in wa_only and "Subject" not in wa_only


def test_ad_directive_meta_vs_google(_vault):
    meta = copy_factory.build_ad_brief("Gym, Rs 1500/mo", platform="meta")
    assert "PRIMARY TEXT" in meta and "CREATIVE BRIEF" in meta
    google = copy_factory.build_ad_brief("Gym, Rs 1500/mo", platform="google")
    assert "HEADLINES" in google and "30 char" in google and "KEYWORD THEMES" in google


def test_landing_directive_sections(_vault):
    d = copy_factory.build_landing_brief("Gym, Rs 1500/mo")
    for section in ("HERO", "TRUST", "BENEFITS", "FAQ", "FINAL CTA"):
        assert section in d
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement (append to `copy_factory.py`)**
```python
_LANG = {
    "en": "English",
    "hi": "Hindi",
    "hinglish": "Hinglish (Latin script ONLY — never Devanagari or Urdu)",
}


def _directive(title: str, client_or_brief: str, language: str, produce: str) -> str:
    brief, name = resolve_brief(client_or_brief)
    voice = voice_context()
    who = f' for "{name}"' if name else ""
    lang = _LANG.get((language or "en").strip().lower(), _LANG["en"])
    return (
        f"[COPY FACTORY — {title}{who}]\n"
        f"Language: {lang}\n\n"
        "== CLIENT BRIEF (use these REAL specifics; specifics convert, generic doesn't) ==\n"
        f"{brief or '(no brief provided — ask the owner for the intake details)'}\n\n"
        "== OWNER'S VOICE / STYLE (match this) ==\n"
        f"{voice or 'No voice samples yet — write clean, confident, professional copy.'}\n\n"
        "== PRODUCE NOW — full and copy-paste ready; NO preamble, NO commentary ==\n"
        f"{produce}"
    )


def build_sequence_brief(client_or_brief: str, channel: str = "both", language: str = "en") -> str:
    channel = (channel or "both").strip().lower()
    email = (
        "EMAIL per stage: 2-3 A/B **Subject** variants + **Preview** + **Body** using {{first_name}} "
        "merge vars and the brief's real price/location/approvals/USPs; one clear CTA per email.\n"
    )
    whatsapp = (
        "WHATSAPP per stage: a Meta **WABA template** — `Template name`, `Category` "
        "(Marketing | Utility | Authentication), optional Header/Footer/Buttons, Body with positional "
        "vars {{1}},{{2}}…; finish with a consolidated **Variable legend**. Meta approval is still "
        "required — tag each template's category to improve approval odds.\n"
    )
    blocks = (email if channel in ("email", "both") else "") + (whatsapp if channel in ("whatsapp", "both") else "")
    produce = (
        "A COHERENT multi-stage journey (each stage builds on the last):\n"
        "  Enquiry/Welcome → Nurture (2-4) → Booking push → Appointment reminder → No-show/Re-engage.\n"
        f"{blocks}"
        "Label each stage with its trigger. Keep it specific and on-brand."
    )
    return _directive("draft an EMAIL + WHATSAPP sequence", client_or_brief, language, produce)


def build_ad_brief(client_or_brief: str, platform: str = "meta", language: str = "en") -> str:
    if (platform or "meta").strip().lower() == "google":
        produce = (
            "GOOGLE Responsive Search Ad:\n"
            "HEADLINES — up to 15, each ≤30 chars.\n"
            "DESCRIPTIONS — up to 4, each ≤90 chars.\n"
            "KEYWORD THEMES — grouped tightly.\nDISPLAY PATHS — two ≤15-char paths.\n"
            "Stay within the character limits; lead with the brief's real offer."
        )
        title = "draft GOOGLE ad copy"
    else:
        produce = (
            "META ads:\n"
            "PRIMARY TEXT — 3 variants (different angles).\n"
            "HEADLINES — 3, ≤40 chars.\nDESCRIPTIONS — 2, ≤30 chars.\n"
            "CREATIVE BRIEF (for the designer) — Visual direction, Hook (first line/3s), Format "
            "(image/carousel/reel + aspect), On-image text (≤6 words), CTA button. "
            "Describe the creative; do NOT generate the image."
        )
        title = "draft META ad copy"
    return _directive(title, client_or_brief, language, produce)


def build_landing_brief(client_or_brief: str, language: str = "en") -> str:
    produce = (
        "Landing/funnel copy, section by section:\n"
        "HERO (Headline + Subhead + Primary CTA) · TRUST / APPROVALS (RERA, bank, etc.) · "
        "BENEFITS (3-5, each with a real proof point) · HOW IT WORKS (optional, 3 steps) · "
        "FAQ (4-6 Q/A) · FINAL CTA (Headline + Button + risk-reversal/urgency)."
    )
    return _directive("draft LANDING / funnel copy", client_or_brief, language, produce)
```

- [ ] **Step 4: Run → PASS. Step 5: Commit** `feat(copy): sequence/ad/landing directive builders`.

---

## Task 3: the three tools + the model bump

**Files:** Modify `backend/tools.py`, `backend/claude_service.py`; Test `backend/test_copy_factory.py`

**Interfaces:** tool names `draft_sequence`, `draft_ad_copy`, `draft_landing_copy` in `_EXECUTORS`; none in `ACTION_TOOLS`/`UNTRUSTED_TOOLS`.

- [ ] **Step 1: Failing tests** (append)
```python
import tools


def test_copy_tools_registered_output_only():
    for t in ("draft_sequence", "draft_ad_copy", "draft_landing_copy"):
        assert t in tools._EXECUTORS
        assert t not in tools.ACTION_TOOLS      # output-only — never gated
        assert t not in tools.UNTRUSTED_TOOLS


def test_draft_sequence_tool_returns_directive(_vault):
    out = tools.run_tool("draft_sequence", {"client_or_brief": "Gym, Rs 1500/mo", "channel": "both", "language": "en"})
    assert "COPY FACTORY" in out and "WABA" in out
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: tools.py** — `import copy_factory`; add executors:
```python
def _draft_sequence(i: dict) -> str:
    return copy_factory.build_sequence_brief(i.get("client_or_brief", ""), i.get("channel", "both"), i.get("language", "en"))

def _draft_ad_copy(i: dict) -> str:
    return copy_factory.build_ad_brief(i.get("client_or_brief", ""), i.get("platform", "meta"), i.get("language", "en"))

def _draft_landing_copy(i: dict) -> str:
    return copy_factory.build_landing_brief(i.get("client_or_brief", ""), i.get("language", "en"))
```
Add schemas to `TOOLS` (descriptions: "Draft … in the owner's voice from a client brief (a clients/<name> vault note OR inline text). Output-only — returns the draft; nothing is sent."), with properties: `client_or_brief` (required), and `channel` (`email|whatsapp|both`) / `platform` (`meta|google`) / `language` (`en|hi|hinglish`) as relevant. Add the three `_EXECUTORS` entries. Add `_activity_target`: `if name in ("draft_sequence","draft_ad_copy","draft_landing_copy"): return i.get("client_or_brief", "")[:40]`.

- [ ] **Step 4: claude_service.py** — `MAX_TOKENS = 8192`; append to `ZENITH_PROMPT` Tools section:
```
- Copy Factory (draft_sequence / draft_ad_copy / draft_landing_copy): when the tool returns a
  "[COPY FACTORY …]" directive, WRITE THE FULL DELIVERABLE in your reply, exactly in the format the
  directive specifies, ready to copy-paste. No preamble, no summary, no "here's a draft" — just the copy.
  These are drafts for the owner to paste elsewhere; nothing is sent.
```

- [ ] **Step 5: Run → PASS. Full fast suite green. Commit** `feat(copy): draft_sequence/draft_ad_copy/draft_landing_copy tools (output-only) + raise MAX_TOKENS`.

---

## Task 4: docs + live verification

- [ ] **Step 1** — README: one line in "What Zenith does" (Copy Factory) + flip the M6-Part-2 roadmap line; PRD/CLAUDE.md M6 Part 2 → shipped (separate commit).
- [ ] **Step 2 (live, on the real vault)** — put a brief in `clients/<name>.md`; `/chat` "draft a WhatsApp + email sequence for <name> in Hinglish" → coherent journey; WABA templates in `{{1}}` format with category tags; Latin-script Hinglish.
- [ ] **Step 3** — `/chat` "draft Meta ad copy for <name>" → primary text + headlines + a creative brief.
- [ ] **Step 4** — `/chat` "save that sequence as a draft for <name>" → Claude calls the existing `save_note` (e.g. `clients/<name> - sequence`); confirm it lands in the vault + shows in the Drafts tab + opens in Obsidian.
- [ ] **Step 5** — confirm none of the three tools are gated (no confirm card appears) and the full fast suite is green (`--ignore=test_stt.py --ignore=test_transcribe_route.py`). Merge to main + push.

---

## Self-review
- **Spec coverage:** brief from vault-or-inline (T1) ✓ · voice-match (T1) ✓ · `draft_sequence` coherent journey + email A/B + WABA `{{1}}`/category (T2, formats above) ✓ · `draft_ad_copy` Meta primary/headlines/creative-brief + Google RSA limits (T2) ✓ · `draft_landing_copy` sections (T2) ✓ · EN/HI/Hinglish (T2) ✓ · output-only / not gated (T3) ✓ · save via existing `save_note` + Drafts tab (T4, reused) ✓ · `MAX_TOKENS` so sequences don't truncate (T3) ✓. Out-of-scope items excluded (no Arkquen, no sending, no image gen).
- **Type consistency:** `build_sequence_brief(client_or_brief, channel, language)`, `build_ad_brief(..., platform, language)`, `build_landing_brief(..., language)` identical across copy_factory, tools, tests.
- **No placeholders:** concrete code + formats throughout.

## Decision to confirm
**`MAX_TOKENS` 1024 → 8192** is a global change (affects all replies, HUD + Telegram). It's required so a full sequence doesn't cut off mid-deliverable; normal replies are unaffected (Claude stops at `end_turn`), and the daily token budget + kill-switch still cap spend. Flag if you'd rather keep it lower and accept "say 'continue' for the rest" on long sequences.
