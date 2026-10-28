// The published JSON Schema (docs/schema/sniptoss-5.schema.json, ADR-0006 item 6): every file the app writes must pass it;
// it matches the reading rules (validate.ts): what the Schema rejects, the app rejects when reading too (except the few items that can be
// filled in while reading).

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import {
  checkMaterialFile,
  emptyMaterialFile,
  parseMaterialFile,
  SCHEMA,
  serializeMaterialFile,
  upsertAnnotation,
  type Annotation,
} from "../src/index.js";

const SCHEMA_FILE = fileURLToPath(new URL(`../../../docs/schema/${SCHEMA.replace("/", "-")}.schema.json`, import.meta.url));
const FORMATS = fileURLToPath(new URL("../../../tests/golden/formats/", import.meta.url));

const validate = new Ajv2020({ allErrors: true, strict: true }).compile(JSON.parse(readFileSync(SCHEMA_FILE, "utf8")));
const errors = (data: unknown) => (validate(data) ? [] : (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`));

const note = (id: string, extra: Partial<Annotation> = {}): Annotation => ({
  id,
  status: "open",
  category: "change",
  body: "改一下",
  anchor: {},
  author: "user",
  created_at: "2026-10-18T00:00:00.000Z",
  updated_at: "2026-10-18T00:00:00.000Z",
  replies: [],
  ...extra,
});

describe("JSON Schema (docs/schema)", () => {
  it("the Schema file name follows the format version: one is published per major version", () => {
    expect(SCHEMA_FILE.endsWith("sniptoss-5.schema.json")).toBe(true);
  });

  it("files the app writes pass: every shape, notes with several places, video times, replies, snapshots and folder comments", () => {
    let file = emptyMaterialFile({ path: "video/intro.mp4", kind: "video", sha256: "ab12", width: 1920, height: 1080, duration: 63.2 });
    const shapes: Annotation["anchor"][] = [
      { shapes: [{ type: "rect", x: 0.1, y: 0.2, w: 0.3, h: 0.1 }], time: { start: 1.5 } },
      { shapes: [{ type: "point", x: 0.5, y: 0.5 }], time: { start: 2, end: 3.25 } },
      { shapes: [{ type: "arrow", from: [0, 0], to: [1, 1] }] },
      {
        shapes: [
          {
            type: "path",
            points: [
              [0.1, 0.1],
              [0.2, 0.15],
              [0.3, 0.1],
            ],
            breaks: [2],
          },
        ],
      },
      {
        shapes: [
          { type: "rect", x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
          { type: "point", x: 0.9, y: 0.9 },
        ],
        time: { start: 4 },
      },
      {},
    ];
    shapes.forEach((anchor, i) => {
      file = upsertAnnotation(file, note(`a0000${i}`, { anchor, snapshot: `snapshots/a0000${i}.png` }));
    });
    file = upsertAnnotation(
      file,
      note("done01", { status: "resolved", replies: [{ author: "codex", body: "改好了", at: "2026-10-18T01:00:00Z" }] }),
    );
    expect(errors(JSON.parse(serializeMaterialFile(file)))).toEqual([]);

    const folder = upsertAnnotation(emptyMaterialFile({ path: ".", kind: "folder" }), note("fold01"));
    expect(errors(JSON.parse(serializeMaterialFile(folder)))).toEqual([]);
  });

  it("the samples of every version, read and written back (upgraded to the current version), all pass", () => {
    for (const name of readdirSync(FORMATS).filter((n) => n.endsWith(".json"))) {
      const written = serializeMaterialFile(parseMaterialFile(readFileSync(FORMATS + name, "utf8"), name));
      expect(errors(JSON.parse(written)), name).toEqual([]);
    }
  });

  it("unknown fields are allowed (the app keeps them when reading and writing), and unknown shapes are not an error", () => {
    const file = { ...emptyMaterialFile({ path: "a.png", kind: "image" }), plugin: { x: 1 } };
    const a = { ...note("abc123", { anchor: { shapes: [{ type: "star" } as never] } }), mood: "😀" };
    expect(errors({ ...file, annotations: [a] })).toEqual([]);
  });

  // Each case: the Schema rejects it, and so do the reading rules
  const bad: [string, (f: Record<string, any>) => void][] = [
    ["no material.path", (f) => delete f.material.path],
    ["material.kind is empty", (f) => (f.material.kind = "")],
    ["width is not a number", (f) => (f.material.width = "1920")],
    ["annotations is not an array", (f) => (f.annotations = {})],
    ["wrong status", (f) => (f.annotations[0].status = "done")],
    ["wrong category", (f) => (f.annotations[0].category = "fix")],
    ["body is not a string", (f) => (f.annotations[0].body = 3)],
    ["page counted from 0", (f) => (f.annotations[0].anchor.page = 0)],
    ["time without start", (f) => (f.annotations[0].anchor.time = { end: 2 })],
    [
      "rectangle without h",
      (f) =>
        (f.annotations[0].anchor.shapes = [
          { type: "point", x: 0, y: 0 },
          { type: "rect", x: 0, y: 0, w: 1 },
        ]),
    ],
    ["an arrow point that is not two numbers", (f) => (f.annotations[0].anchor.shapes = [{ type: "arrow", from: [0], to: [1, 1] }])],
    [
      "freehand breaks that are not integers",
      (f) => (f.annotations[0].anchor.shapes = [{ type: "path", points: [[0, 0]], breaks: [1.5] }]),
    ],
    ["shapes is not an array", (f) => (f.annotations[0].anchor.shapes = { type: "point", x: 0, y: 0 })],
    ["shapes contains a non-object", (f) => (f.annotations[0].anchor.shapes = ["point"])],
    ["a reply's body is not a string", (f) => (f.annotations[0].replies = [{ author: "a", body: null, at: "" }])],
  ];
  it.each(bad)("%s: rejected by both the Schema and the reading rules", (_, mutate) => {
    const f = JSON.parse(serializeMaterialFile(upsertAnnotation(emptyMaterialFile({ path: "a.png", kind: "image" }), note("abc123"))));
    mutate(f);
    expect(errors(f).length).toBeGreaterThan(0);
    expect(checkMaterialFile(structuredClone(f)).length).toBeGreaterThan(0);
  });

  it("what can be filled in while reading (missing anchor, replies, author, times): the reading rules allow it and the Schema does not, since the app always writes them", () => {
    const f = JSON.parse(serializeMaterialFile(upsertAnnotation(emptyMaterialFile({ path: "a.png", kind: "image" }), note("abc123"))));
    for (const k of ["anchor", "replies", "author", "created_at", "updated_at"]) delete f.annotations[0][k];
    expect(checkMaterialFile(structuredClone(f))).toEqual([]);
    expect(errors(f).length).toBeGreaterThan(0);
  });

  it("an empty shapes: read as no position, and the Schema does not allow it, since the app never writes an empty array (ADR-0009)", () => {
    const f = JSON.parse(serializeMaterialFile(upsertAnnotation(emptyMaterialFile({ path: "a.png", kind: "image" }), note("abc123"))));
    f.annotations[0].anchor.shapes = [];
    expect(checkMaterialFile(structuredClone(f))).toEqual([]);
    expect(errors(f).length).toBeGreaterThan(0);
  });
});
