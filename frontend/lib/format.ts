// Pure text formatters shared by the chat renderer and the TTS layer.
// Logic validated via lib/_format_check.mjs (throwaway) before porting here.

const EMOJI_RE = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u{FE0F}\u{200D}\u{20E3}]/gu;

/** Remove emojis / pictographs and tidy the leftover whitespace. */
export function stripEmoji(text: string): string {
  return text.replace(EMOJI_RE, "").replace(/[ \t]{2,}/g, " ").replace(/ +$/gm, "").trim();
}

/** Flatten markdown + emoji into plain prose for text-to-speech (no "asterisk asterisk"). */
export function cleanForSpeech(text: string): string {
  let t = stripEmoji(text);
  t = t.replace(/```[\s\S]*?```/g, " ");          // fenced code
  t = t.replace(/`([^`]+)`/g, "$1");               // inline code
  t = t.replace(/\*\*([^*]+)\*\*/g, "$1");         // bold
  t = t.replace(/\*([^*]+)\*/g, "$1");             // italic
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");   // links → text
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, "");        // headings
  t = t.replace(/^\s{0,3}>\s?/gm, "");             // blockquotes
  t = t.replace(/^\s*[-*]{3,}\s*$/gm, "");         // horizontal rules
  t = t.replace(/^\s*[-*+]\s+/gm, "");             // bullet markers
  t = t.replace(/^\s*\d+\.\s+/gm, "");             // ordered markers
  t = t.replace(/\n{2,}/g, ". ");                  // paragraph break → sentence pause
  t = t.replace(/\n/g, " ");                       // soft line break → space
  t = t.replace(/\s{2,}/g, " ").trim();
  return t;
}

export type InlineToken = { type: "text" | "bold" | "italic" | "code"; value: string };

/** Tokenize one line of inline markdown (**bold**, *italic*, `code`) into spans. */
export function parseInline(s: string): InlineToken[] {
  const RE = /\*\*([^*]+)\*\*|`([^`]+)`|\*([^*\n]+)\*/g;
  const out: InlineToken[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = RE.exec(s)) !== null) {
    if (m.index > last) out.push({ type: "text", value: s.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ type: "bold", value: m[1] });
    else if (m[2] !== undefined) out.push({ type: "code", value: m[2] });
    else out.push({ type: "italic", value: m[3] as string });
    last = RE.lastIndex;
  }
  if (last < s.length) out.push({ type: "text", value: s.slice(last) });
  return out;
}
