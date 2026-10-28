import { hitRanges } from "./search";

/** Highlights the parts of the text that match the search terms (card body and replies when searching the notes panel) */
export function Highlight({ text, terms }: { text: string; terms: readonly string[] }) {
  const ranges = hitRanges(text, terms);
  if (ranges.length === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const [s, e] of ranges) {
    if (s > at) parts.push(text.slice(at, s));
    parts.push(
      <mark key={s} className="hit">
        {text.slice(s, e)}
      </mark>,
    );
    at = e;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}
