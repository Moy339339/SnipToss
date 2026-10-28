// Three-way merge of a notes file (docs/adr/0005-write-protocol.md). Pure logic: used when the UI finds, before writing, that the file was
// changed by someone else; undo / redo use it too, to revert only that step's own change (without wiping out states an agent wrote back in
// between).
//
// base   = the common starting point of both sides (the disk content as last known)
// mine   = my side (the UI's)
// theirs = the other side (what is on disk now: written back by an agent / changed elsewhere)
//
// Rules: different notes each keep their own side; different fields of the same note each keep their own side; when both sides changed the
// same field:
//   status: the newer updated_at wins, and on a tie theirs wins (an agent writing back a status is the most common concurrent change)
//   updated_at, handed_off_at: the newer one wins
//   replies: replies added on either side are kept (de-duplicated by author + time + content)
//   everything else (comment text, category, position, snapshot…): mine wins, and it is recorded in conflicts
// Deletion: deleted on one side and untouched on the other → deleted; edited on the other → if I deleted it, it is deleted (an explicit user action),
// if they deleted it, my edited copy is kept

import type { Annotation, MaterialFile, Reply } from "./types.js";

export interface MergeResult {
  file: MaterialFile;
  /**
   * Places where both sides changed the same thing and the rules picked one side: "note id.field", for the log (like the log, always
   * English and not translated)
   */
  conflicts: string[];
}

type Obj = Record<string, unknown>;

export function mergeMaterialFiles(base: MaterialFile | undefined, mine: MaterialFile, theirs: MaterialFile): MergeResult {
  const conflicts: string[] = [];
  const baseById = new Map((base?.annotations ?? []).map((a) => [a.id, a]));
  const theirsById = new Map(theirs.annotations.map((a) => [a.id, a]));
  const mineIds = new Set(mine.annotations.map((a) => a.id));

  const annotations: Annotation[] = [];
  for (const m of mine.annotations) {
    const b = baseById.get(m.id);
    const t = theirsById.get(m.id);
    if (!b) {
      // Added on my side (the other side having the same id by chance is very rare: take mine)
      annotations.push(m);
      continue;
    }
    if (!t) {
      // Deleted on their side: if I never touched it, delete it too; if I edited it, keep it
      if (!same(m, b)) {
        annotations.push(m);
        conflicts.push(`${m.id} (deleted there, edited here: kept)`);
      }
      continue;
    }
    annotations.push(mergeAnnotation(b, m, t, conflicts));
  }
  for (const t of theirs.annotations) {
    if (mineIds.has(t.id)) continue;
    const b = baseById.get(t.id);
    if (!b)
      annotations.push(t); // added on their side
    else if (!same(t, b)) conflicts.push(`${t.id} (deleted here, edited there: deleted)`);
    // Deleted on my side, untouched on theirs: delete
  }

  // The file's own fields (item info, fields added later) are merged one by one in the same way; annotations is already merged above
  const merged = mergeFields(
    base as unknown as Obj | undefined,
    mine as unknown as Obj,
    theirs as unknown as Obj,
    (key) => {
      conflicts.push(`file.${key}`);
      return (mine as unknown as Obj)[key];
    },
    ["annotations"],
  ) as unknown as MaterialFile;
  merged.schema = mine.schema;
  merged.annotations = annotations;
  return { file: merged, conflicts };
}

function mergeAnnotation(b: Annotation, m: Annotation, t: Annotation, conflicts: string[]): Annotation {
  return mergeFields(b as unknown as Obj, m as unknown as Obj, t as unknown as Obj, (key) => {
    switch (key) {
      case "status":
        return (m.updated_at ?? "") > (t.updated_at ?? "") ? m.status : t.status;
      case "updated_at":
        return (m.updated_at ?? "") > (t.updated_at ?? "") ? m.updated_at : t.updated_at;
      case "handed_off_at":
        // Copied once on each of two computers: keep the later one (compared as instants, not strings: other tools may write time zones)
        return later(m.handed_off_at, t.handed_off_at);
      case "replies":
        return mergeReplies(b.replies ?? [], m.replies ?? [], t.replies ?? []);
      default:
        conflicts.push(`${m.id}.${key}`);
        return (m as unknown as Obj)[key];
    }
  }) as unknown as Annotation;
}

/** The later of two ISO times; if only one side has a value or only one parses, that side is taken */
function later(a: string | undefined, b: string | undefined): string | undefined {
  const ta = a ? Date.parse(a) : NaN;
  const tb = b ? Date.parse(b) : NaN;
  if (Number.isNaN(tb)) return Number.isNaN(ta) ? (a ?? b) : a;
  if (Number.isNaN(ta)) return b;
  return ta >= tb ? a : b;
}

/** Field-level three-way merge: if only one side changed, take that side; if both changed (differently), onBoth decides */
function mergeFields(base: Obj | undefined, mine: Obj, theirs: Obj, onBoth: (key: string) => unknown, skip: string[] = []): Obj {
  const out: Obj = {};
  const keys = new Set([...Object.keys(mine), ...Object.keys(theirs), ...Object.keys(base ?? {})]);
  for (const key of keys) {
    if (skip.includes(key)) continue;
    const b = base?.[key];
    const m = mine[key];
    const t = theirs[key];
    let v: unknown;
    if (same(m, t)) v = m;
    else if (same(m, b)) v = t;
    else if (same(t, b)) v = m;
    else v = onBoth(key);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

function mergeReplies(base: Reply[], mine: Reply[], theirs: Reply[]): Reply[] {
  const id = (r: Reply) => `${r.author}\u0000${r.at}\u0000${r.body}`;
  const seen = new Set<string>();
  const out: Reply[] = [];
  for (const r of [...base, ...mine, ...theirs]) {
    const k = id(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  // Replies deleted on either side (the UI does not delete replies today, but may later): deleted if either side deleted them
  const gone = new Set(base.map(id).filter((k) => !mine.some((r) => id(r) === k) || !theirs.some((r) => id(r) === k)));
  return out.filter((r) => !gone.has(id(r))).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/** Same content (key order does not matter) */
export function same(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

function canonical(v: unknown): string {
  return (
    JSON.stringify(v, (_k, value: unknown) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value as Obj).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
        : value,
    ) ?? "undefined"
  );
}
