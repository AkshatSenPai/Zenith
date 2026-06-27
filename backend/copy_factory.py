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
