import { parseInline, stripEmoji, type InlineToken } from "../lib/format";

function Inline({ tokens }: { tokens: InlineToken[] }) {
  return (
    <>
      {tokens.map((t, i) => {
        if (t.type === "bold")
          return <strong key={i} className="font-semibold text-zenith-cyan">{t.value}</strong>;
        if (t.type === "italic") return <em key={i} className="italic">{t.value}</em>;
        if (t.type === "code")
          return (
            <code key={i} className="rounded bg-black/40 px-1 py-0.5 font-mono text-[0.85em] text-zenith-cyan">
              {t.value}
            </code>
          );
        return <span key={i}>{t.value}</span>;
      })}
    </>
  );
}

const UL = /^\s*[-*+]\s+/;
const OL = /^\s*\d+\.\s+/;
const HR = /^\s*[-*]{3,}\s*$/;
const HEADING = /^\s{0,3}#{1,6}\s+/;

/** Minimal markdown renderer for chat replies: bold/italic/code, lists, headings,
 *  paragraphs with soft line breaks. Emoji are stripped. Styled to the HUD. */
export function Markdown({ text }: { text: string }) {
  const blocks = stripEmoji(text).split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return (
    <div className="space-y-2">
      {blocks.map((block, bi) => {
        const lines = block.split("\n");
        if (HR.test(block)) return <hr key={bi} className="border-zenith-cyan/15" />;
        if (lines.every((l) => UL.test(l)))
          return (
            <ul key={bi} className="ml-4 list-disc space-y-1 marker:text-zenith-cyan/60">
              {lines.map((l, li) => (
                <li key={li}><Inline tokens={parseInline(l.replace(UL, ""))} /></li>
              ))}
            </ul>
          );
        if (lines.every((l) => OL.test(l)))
          return (
            <ol key={bi} className="ml-5 list-decimal space-y-1 marker:text-zenith-cyan/60">
              {lines.map((l, li) => (
                <li key={li}><Inline tokens={parseInline(l.replace(OL, ""))} /></li>
              ))}
            </ol>
          );
        if (HEADING.test(block))
          return (
            <p key={bi} className="font-semibold text-zenith-cyan">
              <Inline tokens={parseInline(block.replace(HEADING, ""))} />
            </p>
          );
        return (
          <p key={bi} className="leading-relaxed">
            {lines.map((l, li) => (
              <span key={li}>
                {li > 0 && <br />}
                <Inline tokens={parseInline(l)} />
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
