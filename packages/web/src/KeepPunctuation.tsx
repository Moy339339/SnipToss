import { Children, cloneElement, Fragment, isValidElement, type ReactNode } from "react";

// Line breaking around full-width punctuation (design rule S9). The interface's own text breaks only at punctuation and spaces
// (word-break: keep-all), and a line must not start with a closing mark (」』）。，、…) or end with an opening one (「『（…).
// WebKit gets the marks wrong under keep-all: it breaks on both sides of every full-width mark, leaving 」 or 。 alone at the start of a
// line. Chromium keeps them right, except when a sentence with no break opportunity is wider than its box and is broken anywhere.
// So an opening mark is kept with the character after it and a closing mark with the character before it, in an inline span that may not
// wrap. WebKit then finds no break opportunity at the edges of such a span, which would leave whole sentences without one (and broken
// inside a word instead); a <wbr> gives back the opportunities the marks allow, after a closing mark and before an opening one. These are
// places where Chromium breaks anyway, so there the text breaks as it did before.
// WebKit also breaks after the dot of a file name that starts with one (".sniptoss" at the end of a line as "." / "sniptoss"), so such a
// name, after a space or at the start, is kept whole the same way

const OPEN = "「『（〈《【〔";
const CLOSE = "」』）〉》】〕。，、；：！？…";
const MARK = new RegExp(`[${OPEN}${CLOSE}]`);
/** A name that starts with a dot, after white space or at the start of the text */
const DOT_NAME = /(^|\s)\.[A-Za-z0-9]/;
const NAME_CHAR = /[A-Za-z0-9_-]/;

/** Text as it is; a mark with the characters it must stay with (not to be broken inside); a place where a line may break */
export type PunctuationRun = { kind: "text"; text: string } | { kind: "keep"; text: string } | { kind: "break" };

/** No break between a and b: after an opening mark or before a closing one, never across white space */
function sticks(a: string, b: string) {
  return !/\s/.test(a) && !/\s/.test(b) && (OPEN.includes(a) || CLOSE.includes(b));
}

const edge = (c: string | undefined) => c === undefined || /\s/.test(c);

/** Where the characters of a dot name stay together: name[i] = no break between chars[i] and chars[i + 1] */
function dotNames(chars: string[]) {
  const name = chars.map(() => false);
  chars.forEach((c, i) => {
    if (c !== "." || !edge(chars[i - 1]) || !NAME_CHAR.test(chars[i + 1] ?? "")) return;
    for (let j = i; NAME_CHAR.test(chars[j + 1] ?? ""); j++) name[j] = true;
  });
  return name;
}

/** The text cut into runs. Text without full-width marks or dot names is one run */
export function punctuationRuns(text: string): PunctuationRun[] {
  if (!MARK.test(text) && !DOT_NAME.test(text)) return [{ kind: "text", text }];
  const chars = Array.from(text);
  const name = dotNames(chars);
  const stays = (i: number) => name[i] || sticks(chars[i], chars[i + 1]);
  const runs: PunctuationRun[] = [];
  let loose = "";
  for (let i = 0; i < chars.length;) {
    let end = i;
    while (end + 1 < chars.length && stays(end)) end++;
    if (end === i) {
      loose += chars[i];
      i++;
      continue;
    }
    if (loose) runs.push({ kind: "text", text: loose });
    loose = "";
    const keep = chars.slice(i, end + 1);
    // White space and the ends of the text are places to break already
    if (OPEN.includes(keep[0]) && !edge(chars[i - 1]) && runs.at(-1)?.kind !== "break") runs.push({ kind: "break" });
    runs.push({ kind: "keep", text: keep.join("") });
    if (CLOSE.includes(keep[keep.length - 1]) && !edge(chars[end + 1])) runs.push({ kind: "break" });
    i = end + 1;
  }
  if (loose) runs.push({ kind: "text", text: loose });
  return runs;
}

function keepText(text: string): ReactNode {
  const runs = punctuationRuns(text);
  if (runs.length === 1 && runs[0].kind === "text") return text;
  return runs.map((r, i) =>
    r.kind === "keep" ? (
      <span key={i} className="keep-punctuation">
        {r.text}
      </span>
    ) : r.kind === "break" ? (
      <wbr key={i} />
    ) : (
      r.text
    ),
  );
}

function keepAll(node: ReactNode): ReactNode {
  return Children.map(node, (child) => {
    if (typeof child === "string") return keepText(child);
    // Down through plain elements and fragments; other components lay out their own text
    if (isValidElement<{ children?: ReactNode }>(child) && (typeof child.type === "string" || child.type === Fragment)) {
      const inner = child.props.children;
      return inner === undefined ? child : cloneElement(child, undefined, keepAll(inner));
    }
    return child;
  });
}

/** The text inside, including the text of plain elements and fragments inside, with full-width marks kept on the right side of line
 * breaks and names that start with a dot kept whole. Adds no element around it. Used where S9 applies (setting descriptions, empty states, confirm dialogs, tour, hints …) */
export function KeepPunctuation({ children }: { children?: ReactNode }) {
  return <>{keepAll(children)}</>;
}

/** The same for text put into the page without React (the tooltip) */
export function punctuationNodes(text: string): (string | HTMLElement)[] {
  return punctuationRuns(text).map((r) => {
    if (r.kind === "text") return r.text;
    if (r.kind === "break") return document.createElement("wbr");
    const span = document.createElement("span");
    span.className = "keep-punctuation";
    span.textContent = r.text;
    return span;
  });
}
