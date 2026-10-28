// Validation and filling in of defaults when a notes file is read (docs/adr/0006-format-versioning.md item 7; the rules are in
// docs/annotation-format.md, "Reading rules").
// Agents often edit the JSON directly (the documentation tells them to), and a hand-edited file may lack replies or repeat an id:
// what can be filled in safely is filled in (a missing replies means no replies), and what cannot is reported with the field name, so the
// UI does not render bad data and fail halfway.
//
// Problem descriptions use only field paths and symbols (no wording in any language): the UI and the CLI each add their own explanatory text.

import { isMarkColor } from "./types.js";

const STATUSES = ["open", "resolved", "wontfix"];
const CATEGORIES = ["change", "remove", "add", "question"];

type Obj = Record<string, unknown>;

export const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isPair = (v: unknown) => Array.isArray(v) && v.length === 2 && v.every(isNum);

/** For problem descriptions: what the value looks like (truncated if too long) */
export function show(v: unknown): string {
  if (v === undefined) return "undefined";
  const s = JSON.stringify(v) ?? String(v);
  return s.length > 40 ? `${s.slice(0, 37)}…` : s;
}

/**
 * Validates a notes file that has already been through JSON.parse, filling in the fields that can be filled in place (missing anchor → {},
 * missing replies → [], missing author and times → "").
 * Returns the list of problems; empty = usable. Each looks like `annotations[2].status: "done" ≠ open | resolved | wontfix`
 */
export function checkMaterialFile(data: unknown): string[] {
  const problems: string[] = [];
  const want = (at: string, value: unknown, expected: string) => problems.push(`${at}: ${show(value)} ≠ ${expected}`);

  if (!isObj(data)) {
    want("(root)", data, "object");
    return problems;
  }
  const m = data.material;
  if (!isObj(m)) want("material", m, "object");
  else {
    if (typeof m.path !== "string" || m.path === "") want("material.path", m.path, "string");
    if (typeof m.kind !== "string" || m.kind === "") want("material.kind", m.kind, "string");
    for (const k of ["width", "height", "duration"]) if (m[k] !== undefined && !isNum(m[k])) want(`material.${k}`, m[k], "number");
    if (m.pages !== undefined && !(Array.isArray(m.pages) && m.pages.every((p) => isObj(p) && isNum(p.width) && isNum(p.height))))
      want("material.pages", m.pages, "[{ width, height }]");
  }
  if (!Array.isArray(data.annotations)) {
    want("annotations", data.annotations, "array");
    return problems;
  }

  const ids = new Map<string, number>();
  data.annotations.forEach((a: unknown, i) => {
    const at = `annotations[${i}]`;
    if (!isObj(a)) {
      want(at, a, "object");
      return;
    }
    if (typeof a.id !== "string" || a.id === "") want(`${at}.id`, a.id, "string");
    else if (ids.has(a.id)) problems.push(`${at}.id: ${show(a.id)} = annotations[${ids.get(a.id)}].id`);
    else ids.set(a.id, i);
    if (!STATUSES.includes(a.status as string)) want(`${at}.status`, a.status, STATUSES.join(" | "));
    if (!CATEGORIES.includes(a.category as string)) want(`${at}.category`, a.category, CATEGORIES.join(" | "));
    if (typeof a.body !== "string") want(`${at}.body`, a.body, "string");

    if (a.anchor === undefined) a.anchor = {};
    if (!isObj(a.anchor)) want(`${at}.anchor`, a.anchor, "object");
    else checkAnchor(a.anchor, `${at}.anchor`, want);

    for (const k of ["author", "created_at", "updated_at"]) {
      if (a[k] === undefined) a[k] = "";
      else if (typeof a[k] !== "string") want(`${at}.${k}`, a[k], "string");
    }
    if (a.snapshot !== undefined && typeof a.snapshot !== "string") want(`${at}.snapshot`, a.snapshot, "string");
    // Only used to mark a card as copied: a malformed value counts as never copied, and is not worth making the whole file unreadable
    if (a.handed_off_at !== undefined && (typeof a.handed_off_at !== "string" || Number.isNaN(Date.parse(a.handed_off_at))))
      delete a.handed_off_at;
    // Only used to recognize "written on an earlier version": a malformed value counts as not recorded (handled like an old note, see
    // versions.ts), and likewise does not make the whole file unreadable
    if (a.material_sha256 !== undefined && typeof a.material_sha256 !== "string") delete a.material_sha256;
    // Only decides the color the marks are drawn in: a malformed value counts as not changed (the Settings color is used). It is put into
    // SVG, so only #rrggbb is accepted
    if (a.color !== undefined && !isMarkColor(a.color)) delete a.color;

    if (a.replies === undefined) a.replies = [];
    if (!Array.isArray(a.replies)) want(`${at}.replies`, a.replies, "array");
    else
      a.replies.forEach((r: unknown, j) => {
        if (!isObj(r)) return want(`${at}.replies[${j}]`, r, "object");
        for (const k of ["author", "body", "at"]) {
          if (r[k] === undefined && k !== "body") r[k] = "";
          else if (typeof r[k] !== "string") want(`${at}.replies[${j}].${k}`, r[k], "string");
        }
      });
  });
  return problems;
}

function checkAnchor(anchor: Obj, at: string, want: (at: string, value: unknown, expected: string) => void) {
  if (anchor.page !== undefined && !(Number.isInteger(anchor.page) && (anchor.page as number) >= 1))
    want(`${at}.page`, anchor.page, "integer ≥ 1");
  const t = anchor.time;
  if (t !== undefined) {
    if (!isObj(t) || !isNum(t.start)) want(`${at}.time`, t, "{ start, end? }");
    else if (t.end !== undefined && !isNum(t.end)) want(`${at}.time.end`, t.end, "number");
  }
  // shapes (since sniptoss/5); shape is the form up to sniptoss/4 and must be valid too (it is converted to shapes when read, see store.ts)
  if (anchor.shapes !== undefined) {
    if (!Array.isArray(anchor.shapes)) want(`${at}.shapes`, anchor.shapes, "[{ type, … }, …]");
    else anchor.shapes.forEach((s, i) => checkShape(s, `${at}.shapes[${i}]`, want));
  }
  if (anchor.shape !== undefined) checkShape(anchor.shape, `${at}.shape`, want);
}

function checkShape(s: unknown, sat: string, want: (at: string, value: unknown, expected: string) => void) {
  if (!isObj(s) || typeof s.type !== "string") return want(sat, s, "{ type, … }");
  // The place's own color: like the note's color, a malformed value counts as not changed
  if (s.color !== undefined && !isMarkColor(s.color)) delete s.color;
  switch (s.type) {
    case "rect":
      for (const k of ["x", "y", "w", "h"]) if (!isNum(s[k])) want(`${sat}.${k}`, s[k], "number");
      break;
    case "point":
      for (const k of ["x", "y"]) if (!isNum(s[k])) want(`${sat}.${k}`, s[k], "number");
      break;
    case "arrow":
      for (const k of ["from", "to"]) if (!isPair(s[k])) want(`${sat}.${k}`, s[k], "[x, y]");
      break;
    case "path":
      if (!Array.isArray(s.points) || !s.points.every(isPair)) want(`${sat}.points`, s.points, "[[x, y], …]");
      if (s.breaks !== undefined && !(Array.isArray(s.breaks) && s.breaks.every((b) => Number.isInteger(b))))
        want(`${sat}.breaks`, s.breaks, "[integer, …]");
      break;
    // Shapes added later (docs/annotation-format.md, "Planned extensions"): unknown ones are not validated, and the drawing code skips them
  }
}
