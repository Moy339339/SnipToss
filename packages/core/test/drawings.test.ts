// Drawings without notes (from 1.3.0): reading, merging, the store helpers and the sentence in the text for agents
import { describe, expect, it } from "vitest";
import {
  mergeMaterialFiles,
  parseMaterialFile,
  removeDrawing,
  SCHEMA,
  serializeMaterialFile,
  takenIds,
  upsertDrawing,
  type Annotation,
  type Drawing,
  type MaterialFile,
} from "../src/index.js";
import { renderHandoff, renderReview } from "./i18n.js";

const note = (id: string, extra: Partial<Annotation> = {}): Annotation => ({
  id,
  status: "open",
  category: "change",
  body: "改一下",
  anchor: { shapes: [{ type: "rect", x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] },
  author: "user",
  created_at: "2026-11-09T00:00:00Z",
  updated_at: "2026-11-09T00:00:00Z",
  replies: [],
  ...extra,
});
const drawing = (id: string, extra: Partial<Drawing> = {}): Drawing => ({
  id,
  shape: { type: "arrow", from: [0.6, 0.8], to: [0.5, 0.6] },
  created_at: "2026-11-09T00:00:00Z",
  ...extra,
});
const file = (annotations: Annotation[], drawings?: Drawing[]): MaterialFile => ({
  schema: SCHEMA,
  material: { path: "a.png", kind: "image", width: 1000, height: 500 },
  annotations,
  ...(drawings ? { drawings } : {}),
});
const parse = (data: unknown) => parseMaterialFile(JSON.stringify(data), "x.json");

describe("reading drawings", () => {
  it("valid drawings are read and written back as they were; an empty list counts as absent", () => {
    const f = file(
      [note("aaaaaa")],
      [
        drawing("dddddd", {
          shape: {
            type: "path",
            points: [
              [0.1, 0.1],
              [0.2, 0.2],
            ],
            color: "#ffc233",
          },
          time: { start: 1.5 },
        }),
      ],
    );
    expect(JSON.parse(serializeMaterialFile(parse(f)))).toEqual(f);
    expect(parse({ ...file([note("aaaaaa")]), drawings: [] }).drawings).toBeUndefined();
  });
  it("a missing created_at is filled in; a malformed material_sha256 or color counts as not recorded", () => {
    const d = parse(
      file([], [{ id: "dddddd", shape: { type: "rect", x: 0, y: 0, w: 1, h: 1, color: "red" }, material_sha256: 7 } as unknown as Drawing]),
    ).drawings![0];
    expect(d).toEqual({ id: "dddddd", shape: { type: "rect", x: 0, y: 0, w: 1, h: 1 }, created_at: "" });
  });
  it("a broken drawing makes the file unreadable with the field named: no shape, bad time, repeated id, not a list", () => {
    const bad = (drawings: unknown) => {
      try {
        parse({ ...file([]), drawings });
      } catch (e) {
        return (e as Error).message;
      }
      return "read";
    };
    expect(bad([{ id: "d1", created_at: "" }])).toContain("drawings[0].shape");
    expect(bad([drawing("d1", { time: { start: "1" as unknown as number } })])).toContain("drawings[0].time");
    expect(bad([drawing("d1"), drawing("d1")])).toContain("drawings[1].id");
    expect(bad({})).toContain("drawings");
  });
});

describe("store helpers", () => {
  it("upsert replaces by id or appends; removing the last one drops the field; taken ids cover notes and drawings", () => {
    let f = upsertDrawing(file([note("aaaaaa")]), drawing("d1"));
    f = upsertDrawing(f, drawing("d2"));
    f = upsertDrawing(f, drawing("d1", { time: { start: 2 } }));
    expect(f.drawings!.map((d) => [d.id, d.time?.start])).toEqual([
      ["d1", 2],
      ["d2", undefined],
    ]);
    expect([...takenIds(f)].sort()).toEqual(["aaaaaa", "d1", "d2"]);
    f = removeDrawing(removeDrawing(f, "d1"), "d2");
    expect("drawings" in f).toBe(false);
  });
});

describe("merging drawings (the UI and an agent changed the file at the same time; undo)", () => {
  it("added on either side are both kept; deleted on one side and untouched on the other is deleted", () => {
    const base = file([note("aaaaaa")], [drawing("d1"), drawing("d2")]);
    const mine = file([note("aaaaaa")], [drawing("d1"), drawing("d3")]); // removed d2, added d3
    const theirs = file([note("aaaaaa"), note("bbbbbb")], [drawing("d1"), drawing("d2"), drawing("d4")]); // added a note and d4
    const { file: merged, conflicts } = mergeMaterialFiles(base, mine, theirs);
    expect(merged.drawings!.map((d) => d.id)).toEqual(["d1", "d3", "d4"]);
    expect(merged.annotations.map((a) => a.id)).toEqual(["aaaaaa", "bbbbbb"]);
    expect(conflicts).toEqual([]);
  });
  it("changed only on their side: theirs; changed on both: mine, recorded as a conflict; all gone: no field", () => {
    const base = file([], [drawing("d1"), drawing("d2")]);
    const moved = (id: string, x: number) => drawing(id, { shape: { type: "arrow", from: [x, 0.8], to: [0.5, 0.6] } });
    const { file: merged, conflicts } = mergeMaterialFiles(
      base,
      file([], [drawing("d1"), moved("d2", 0.1)]),
      file([], [moved("d1", 0.2), moved("d2", 0.3)]),
    );
    expect(merged.drawings).toEqual([moved("d1", 0.2), moved("d2", 0.1)]);
    expect(conflicts).toEqual(["drawing d2"]);
    expect("drawings" in mergeMaterialFiles(base, file([]), file([], [drawing("d1"), drawing("d2")])).file).toBe(false);
  });
});

describe("the text for agents", () => {
  const shot = (id: string) => note(id, { snapshot: `snapshots/${id}.png` });
  it("Copy as Text adds one sentence when the snapshots show drawings, and lists nothing about them otherwise", () => {
    const g = { material: file([]).material, root: "E:\\a", items: [{ annotation: shot("aaaaaa"), index: 1 }] };
    const hint = "截图上没有编号的线条、箭头和框是用户另外画的，帮助说明意见，不是素材本身的内容。";
    expect(renderHandoff([{ ...g, drawings: true }])).toContain(hint);
    expect(renderHandoff([g])).not.toContain(hint);
    // Without snapshots the drawings are nowhere to be seen, so nothing is said
    expect(renderHandoff([{ ...g, drawings: true, items: [{ annotation: note("aaaaaa"), index: 1 }] }])).not.toContain(hint);
  });
  it("REVIEW.md likewise, for the files that have drawings", () => {
    expect(renderReview([file([shot("aaaaaa")], [drawing("d1")])])).toContain("截图上没有编号的线条");
    expect(renderReview([file([shot("aaaaaa")])])).not.toContain("截图上没有编号的线条");
  });
});
