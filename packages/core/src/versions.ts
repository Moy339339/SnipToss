import type { Annotation, MaterialFile } from "./types.js";

// Which version of an item a note was written on (docs/adr/0008-earlier-versions.md; format document, "Notes written on an earlier
// version"). Pure logic: the item's current fingerprint and modification time are supplied by the caller (the UI gets them through the
// shell, the CLI computes
// them itself), and the UI, the CLI and REVIEW.md all use this one set of rules

/**
 * Which version a note was written on: the item's SHA-256 at that time; undefined = the current version (the item has not changed since the
 * note was written, so no fingerprint is needed).
 * If material_sha256 is recorded, that is it; for a note without one, a note written after the item's last
 * modification is on the current version, and an earlier one uses the fingerprint recorded for the whole file (taken when the first note
 * was written).
 * A time that cannot be parsed (a hand-edited file) counts as the current version: when unsure, a note is not counted as "earlier"
 */
export function writtenOn(a: Annotation, file: MaterialFile, mtimeMs: number): string | undefined {
  if (a.material_sha256) return a.material_sha256.toLowerCase();
  if (!(Date.parse(a.created_at) < mtimeMs)) return undefined;
  return file.material.sha256?.toLowerCase() || undefined;
}

/**
 * The item's current fingerprint as known without reading the file: the one recorded by the latest note that has a fingerprint and was
 * written after the item's last modification
 */
export function knownSha(file: MaterialFile, mtimeMs: number): string | undefined {
  let best: { at: number; sha: string } | undefined;
  for (const a of file.annotations) {
    const at = Date.parse(a.created_at);
    if (!a.material_sha256 || !(at >= mtimeMs)) continue;
    if (!best || at > best.at) best = { at, sha: a.material_sha256.toLowerCase() };
  }
  return best?.sha;
}

export interface Versions {
  /** Notes written on an earlier version (ids) */
  earlier: Set<string>;
  /**
   * The item's current fingerprint is needed to decide and was not given: earlier is a guess that it changed (it was modified after these
   * notes, which usually means it really did)
   */
  pending: boolean;
}

/**
 * Which notes of this item were written on an earlier version. nowSha = the item's current fingerprint (if not given, knownSha is tried
 * first, and if it is still unknown the result is pending); mtimeMs = the item file's modification time.
 * Folder comments have no versions
 */
export function earlierVersions(file: MaterialFile, mtimeMs: number, nowSha?: string): Versions {
  const earlier = new Set<string>();
  if (file.material.kind === "folder") return { earlier, pending: false };
  const now = nowSha?.toLowerCase() ?? knownSha(file, mtimeMs);
  let pending = false;
  for (const a of file.annotations) {
    const on = writtenOn(a, file, mtimeMs);
    if (on === undefined) continue;
    if (now === undefined) pending = true;
    if (now === undefined || on !== now) earlier.add(a.id);
  }
  return { earlier, pending };
}
