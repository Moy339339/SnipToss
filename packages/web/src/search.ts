// Notes panel search (with many notes, scrolling is the only other way to find one). It searches the note text and replies; when several words are separated by spaces, every word must be present (case-insensitive, in any order).

/** The text in the search box → the words to look for (lowercase). Only whitespace gives [], which means no search */
export function searchTerms(query: string): string[] {
  return query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
}

/** Every word can be found in this note's text and replies */
export function annotationMatches(a: { body: string; replies: readonly { body: string }[] }, terms: readonly string[]): boolean {
  if (terms.length === 0) return true;
  const text = [a.body, ...a.replies.map((r) => r.body)].join("\n").toLocaleLowerCase();
  return terms.every((t) => text.includes(t));
}

/**
 * The ranges [start, end) in the text that match the search words, sorted in order with overlapping ones merged (highlighted on the card, so it is clear why the note was found).
 * Text whose length changes after lowercasing (a few rare letters) is not highlighted: the positions would not line up
 */
export function hitRanges(text: string, terms: readonly string[]): [number, number][] {
  const lower = text.toLocaleLowerCase();
  if (terms.length === 0 || lower.length !== text.length) return [];
  const found: [number, number][] = [];
  for (const t of terms) for (let i = lower.indexOf(t); i >= 0; i = lower.indexOf(t, i + t.length)) found.push([i, i + t.length]);
  found.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const out: [number, number][] = [];
  for (const [s, e] of found) {
    const last = out.at(-1);
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}
