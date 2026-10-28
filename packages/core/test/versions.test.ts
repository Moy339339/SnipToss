import { describe, expect, it } from "vitest";
import { earlierVersions, knownSha, writtenOn, type Annotation, type MaterialFile } from "../src/index.js";

// Which version of an item a note was written on (docs/adr/0008-earlier-versions.md): the UI, the CLI and REVIEW.md share this one set of rules

const V1 = "a".repeat(64);
const V2 = "b".repeat(64);
const T = (h: number) => `2026-10-23T${String(h).padStart(2, "0")}:00:00.000Z`;
const at = (h: number) => Date.parse(T(h));

const note = (id: string, created: number, extra: Partial<Annotation> = {}): Annotation => ({
  id,
  status: "open",
  category: "change",
  body: id,
  anchor: { shapes: [{ type: "point", x: 0.5, y: 0.5 }] },
  author: "user",
  created_at: T(created),
  updated_at: T(created),
  replies: [],
  ...extra,
});
const file = (annotations: Annotation[], sha256: string | undefined = V1): MaterialFile => ({
  schema: "sniptoss/4",
  material: { path: "a.png", kind: "image", ...(sha256 ? { sha256 } : {}), width: 100, height: 100 },
  annotations,
});

describe("writtenOn: which version a note was written on", () => {
  it("a recorded material_sha256 is the answer (case-insensitive)", () => {
    expect(writtenOn(note("a", 10, { material_sha256: V2.toUpperCase() }), file([]), at(12))).toBe(V2);
  });
  it("an old note without one: written after the item's last modification = the current version (undefined); earlier ones use the file's sha256", () => {
    expect(writtenOn(note("a", 12), file([]), at(10))).toBeUndefined();
    expect(writtenOn(note("a", 9), file([]), at(10))).toBe(V1);
  });
  it("an unparseable time or a file without a fingerprint: counts as the current version (when unsure, a note is not counted as earlier)", () => {
    expect(writtenOn(note("a", 9, { created_at: "" }), file([]), at(10))).toBeUndefined();
    expect(writtenOn(note("a", 9), file([], ""), at(10))).toBeUndefined();
  });
});

describe("earlierVersions: which notes were written on an earlier version", () => {
  it("the item has not changed since the notes were written: none is, and no fingerprint is needed", () => {
    expect(earlierVersions(file([note("a", 10), note("b", 11, { material_sha256: V1 })]), at(9))).toEqual({
      earlier: new Set(),
      pending: false,
    });
  });

  it("the item changed later and the current fingerprint is unknown: assumed changed for now (pending)", () => {
    const v = earlierVersions(file([note("a", 9), note("b", 9, { material_sha256: V1 })]), at(10));
    expect(v.pending).toBe(true);
    expect([...v.earlier].sort()).toEqual(["a", "b"]);
  });

  it("the computed fingerprint is unchanged (only the modification time was touched, e.g. by git checkout): none is", () => {
    expect(earlierVersions(file([note("a", 9), note("b", 9, { material_sha256: V1 })]), at(10), V1)).toEqual({
      earlier: new Set(),
      pending: false,
    });
  });

  it("new notes written after an overwrite: they record the new fingerprint, so the current version is known without reading the file, and the old ones belong to the earlier version", () => {
    const f = file([note("old1", 9), note("old2", 9, { material_sha256: V1 }), note("new", 11, { material_sha256: V2 })]);
    expect(knownSha(f, at(10))).toBe(V2);
    expect(earlierVersions(f, at(10))).toEqual({ earlier: new Set(["old1", "old2"]), pending: false });
  });

  it("an old note whose text or status was edited (updated_at is newer) is still on the earlier version (going by updated_at would draw it back onto the new image after any edit)", () => {
    const f = file([note("old", 9, { updated_at: T(15), status: "resolved" })]);
    expect(earlierVersions(f, at(10), V2).earlier).toEqual(new Set(["old"]));
  });

  it("old notes (no fingerprint) written after an overwrite but before this version: recognized by the file's sha256; after another overwrite, both groups belong to earlier versions", () => {
    // Overwritten for the first time at 10:00 (V1 → V2), mid is written on V2 at 11:00 (older versions did not record a fingerprint per
    // note), and overwritten again as V3 at 13:00
    const f = file([note("first", 9), note("mid", 11)]);
    expect(earlierVersions(f, at(10), V2).earlier).toEqual(new Set(["first"])); // still V2 now: mid was written after the modification, so it is on this version
    expect(earlierVersions(f, at(13), "c".repeat(64)).earlier).toEqual(new Set(["first", "mid"]));
  });

  it("the item was switched back to an older version: notes that recorded that version's fingerprint belong to the current version again", () => {
    const f = file([note("v1", 9, { material_sha256: V1 }), note("v2", 11, { material_sha256: V2 })]);
    expect(earlierVersions(f, at(12), V1).earlier).toEqual(new Set(["v2"]));
  });

  it("folder comments have no versions", () => {
    const f: MaterialFile = { schema: "sniptoss/4", material: { path: ".", kind: "folder" }, annotations: [note("a", 1, { anchor: {} })] };
    expect(earlierVersions(f, at(10))).toEqual({ earlier: new Set(), pending: false });
  });
});
