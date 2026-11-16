import type { MaterialFile } from "./types.js";

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
export function writtenOn(a: { material_sha256?: string; created_at: string }, file: MaterialFile, mtimeMs: number): string | undefined {
  if (a.material_sha256) return a.material_sha256.toLowerCase();
  if (!(Date.parse(a.created_at) < mtimeMs)) return undefined;
  return file.material.sha256?.toLowerCase() || undefined;
}

/**
 * What a new note records as material_mtime for an item file modified at mtimeMs: ISO 8601 UTC, truncated to whole milliseconds (the
 * shells give whole milliseconds, Node's stat a fraction)
 */
export function mtimeStamp(mtimeMs: number): string {
  return new Date(Math.floor(mtimeMs)).toISOString();
}

/**
 * The item's current fingerprint as known without reading the file. mtimeMs, size = the item file's modification time and size now.
 * A note that recorded material_mtime (from 1.6.0) counts only while its material_mtime and material_size both equal the file's now:
 * a file replaced by an older copy (extracted from an archive, copied with its timestamps kept) can have a modification time from before
 * the notes, and in formats whose size follows from the dimensions (BMP, uncompressed TIFF) the same size as well.
 * Notes without material_mtime count only while no note of the file has one (a mismatch there may mean a replacement they can't see):
 * the latest one with a fingerprint written after the item's last modification, unless it recorded a different material_size.
 * Nothing matching → undefined, and the fingerprint has to be computed
 */
export function knownSha(file: MaterialFile, mtimeMs: number, size?: number): string | undefined {
  const now = Math.floor(mtimeMs);
  const stamped = file.annotations.some((a) => a.material_sha256 && a.material_mtime !== undefined);
  let best: { at: number; sha: string } | undefined;
  for (const a of file.annotations) {
    if (!a.material_sha256) continue;
    const at = Date.parse(a.created_at);
    const sizeDiffers = size !== undefined && a.material_size !== undefined && a.material_size !== size;
    if (sizeDiffers) continue;
    if (a.material_mtime !== undefined ? Date.parse(a.material_mtime) !== now : stamped || !(at >= mtimeMs)) continue;
    if (!best || at > best.at) best = { at, sha: a.material_sha256.toLowerCase() };
  }
  return best?.sha;
}

export interface Versions {
  /** Notes written on an earlier version (ids), and drawings made on one (from 1.3.0; their ids never clash with notes') */
  earlier: Set<string>;
  /**
   * The item's current fingerprint is needed to decide and was not given: earlier is a guess that it changed (it was modified after these
   * notes, which usually means it really did)
   */
  pending: boolean;
}

/**
 * Which notes of this item were written on an earlier version. nowSha = the item's current fingerprint (if not given, knownSha is tried
 * first, and if it is still unknown the result is pending); mtimeMs, size = the item file's modification time and size in bytes.
 * Folder comments have no versions
 */
export function earlierVersions(file: MaterialFile, mtimeMs: number, nowSha?: string, size?: number): Versions {
  const earlier = new Set<string>();
  if (file.material.kind === "folder") return { earlier, pending: false };
  const now = nowSha?.toLowerCase() ?? knownSha(file, mtimeMs, size);
  let pending = false;
  for (const a of [...file.annotations, ...(file.drawings ?? [])]) {
    const on = writtenOn(a, file, mtimeMs);
    if (on === undefined) continue;
    if (now === undefined) pending = true;
    if (now === undefined || on !== now) earlier.add(a.id);
  }
  return { earlier, pending };
}
