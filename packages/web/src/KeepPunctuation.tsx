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

const NBSP = String.fromCharCode(0xa0);
/** The separator between the steps of a menu or settings path: an arrow, or ">" (Korean writes paths as Apple's Korean documents do) */
const PATH_STEP = /[→>]/;
const SPACED_STEP = new RegExp(`[ ${NBSP}]([→>])[ ${NBSP}]`, "g");
/** Arrows that name arrow keys (“←→ switch”), not steps of a path */
const ARROW_KEYS = "←↑→↓";

/**
 * The separator between the steps of a path (“File → Get Info”, “System Settings → Privacy & Security”, Korean “파일 > 정보 가져오기”) stays
 * on one line with the steps on its sides: the spaces around it become no-break spaces (some translations already have one before the
 * arrow and a plain space after it), and pathSteps keeps the characters next to it in one unbreakable run, so no line starts or ends with
 * the separator. The no-break spaces alone are not enough: some WebKit versions still break between a closing quote and a no-break space
 * („Ablage“ → …)
 */
export const gluePaths = (text: string) => text.replace(SPACED_STEP, `${NBSP}$1${NBSP}`);

/** A character a path step may end or start with right against an arrow: not white space, not another arrow (←→ are keys) */
const solid = (c: string | undefined) => c !== undefined && !/\s/.test(c) && !ARROW_KEYS.includes(c);

/**
 * step[i] = no break between chars[i] and chars[i + 1]: from the character before a path separator to the one after it. The separator is
 * one between no-break spaces (gluePaths has run), or an arrow right between two characters (Chinese and Japanese put it between a
 * closing and an opening corner bracket, where the marks would otherwise give a place to break on both sides of the arrow)
 */
function pathSteps(chars: string[]) {
  const step = chars.map(() => false);
  const keep = (from: number, to: number) => {
    for (let j = Math.max(0, from); j < Math.min(chars.length - 1, to); j++) step[j] = true;
  };
  chars.forEach((c, i) => {
    if (!"→>".includes(c)) return;
    if (chars[i - 1] === NBSP && chars[i + 1] === NBSP) keep(i - 2, i + 2);
    else if (c === "→" && solid(chars[i - 1]) && solid(chars[i + 1])) keep(i - 1, i + 1);
  });
  return step;
}

/** What sits right against the text in its line: other inline content before it, after it */
export interface Neighbors {
  before?: boolean;
  after?: boolean;
}

/**
 * The text cut into runs. Text without full-width marks or dot names is one run.
 * White space is a place to break already, and so is an end of the text with nothing against it. An end with other inline content
 * against it is not ("<code>path</code>(default…)"): WebKit finds no place to break at an element's edge, so a mark there gets its <wbr>
 * like any other. Nothing is added at the start or end of a block, where an extra place to break could still change how
 * text-wrap: pretty balances the lines
 */
export function punctuationRuns(raw: string, { before = false, after = false }: Neighbors = {}): PunctuationRun[] {
  const text = gluePaths(raw);
  if (!MARK.test(text) && !DOT_NAME.test(text) && !PATH_STEP.test(text)) return [{ kind: "text", text }];
  const chars = Array.from(text);
  const name = dotNames(chars);
  const step = pathSteps(chars);
  const stays = (i: number) => name[i] || step[i] || sticks(chars[i], chars[i + 1]);
  const breaksBefore = (i: number) => (i === 0 ? !before : /\s/.test(chars[i - 1]));
  const breaksAfter = (i: number) => (i === chars.length - 1 ? !after : /\s/.test(chars[i + 1]));
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
    if (OPEN.includes(keep[0]) && !breaksBefore(i) && runs.at(-1)?.kind !== "break") runs.push({ kind: "break" });
    runs.push({ kind: "keep", text: keep.join("") });
    if (CLOSE.includes(keep[keep.length - 1]) && !breaksAfter(end)) runs.push({ kind: "break" });
    i = end + 1;
  }
  if (loose) runs.push({ kind: "text", text: loose });
  return runs;
}

function keepText(text: string, neighbors: Neighbors): ReactNode {
  const runs = punctuationRuns(text, neighbors);
  if (runs.length === 1 && runs[0].kind === "text") return runs[0].text;
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

const empty = (n: ReactNode) => n === null || n === undefined || typeof n === "boolean" || n === "";

/** Elements that start a line of their own: next to one, a string ends its line as at the end of a block. Only the element type is known
 * here, so text laid out as a block by a class (a span with display: block) is written as one of these instead */
const OWN_LINE = new Set([
  "br",
  "address",
  "article",
  "aside",
  "blockquote",
  "dd",
  "details",
  "dialog",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "ul",
]);

function keepAll(node: ReactNode): ReactNode {
  // The children in the order Children.map visits them, to see what sits next to each string: the nearest one that isn't empty, unless it
  // is a line break (<br>) or a block (div, p, li …)
  const all: ReactNode[] = [];
  Children.forEach(node, (child) => void all.push(child));
  const against = (i: number, step: 1 | -1) => {
    for (let j = i + step; j >= 0 && j < all.length; j += step) {
      const n = all[j];
      if (!empty(n)) return !(isValidElement(n) && typeof n.type === "string" && OWN_LINE.has(n.type));
    }
    return false;
  };
  return Children.map(node, (child, i) => {
    if (typeof child === "string") return keepText(child, { before: against(i, -1), after: against(i, 1) });
    // Down through plain elements and fragments; other components lay out their own text
    if (isValidElement<{ children?: ReactNode }>(child) && (typeof child.type === "string" || child.type === Fragment)) {
      const inner = child.props.children;
      return inner === undefined ? child : cloneElement(child, undefined, keepAll(inner));
    }
    return child;
  });
}

/** The text inside, including the text of plain elements and fragments inside, with full-width marks kept on the right side of line
 * breaks, names that start with a dot kept whole and the steps of a path kept with their arrow. Adds no element around it. Used where S9 applies (setting descriptions, empty states, confirm dialogs, tour, hints …) */
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
