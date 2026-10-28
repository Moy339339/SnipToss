import { describe, expect, it } from "vitest";
import { mergeMaterialFiles, same, SCHEMA, type Annotation, type MaterialFile } from "../src/index.js";

const T0 = "2026-10-17T00:00:00.000Z";
const T1 = "2026-10-17T00:01:00.000Z";
const T2 = "2026-10-17T00:02:00.000Z";

function note(id: string, extra: Partial<Annotation> = {}): Annotation {
  return {
    id,
    status: "open",
    category: "change",
    body: `意见 ${id}`,
    anchor: { shapes: [{ type: "point", x: 0.5, y: 0.5 }] },
    author: "我",
    created_at: T0,
    updated_at: T0,
    replies: [],
    ...extra,
  };
}

function file(...annotations: Annotation[]): MaterialFile {
  return { schema: SCHEMA, material: { path: "a.png", kind: "image", width: 100, height: 100 }, annotations };
}

/** An agent's write-back with resolve: changes the status, updates the time, adds a reply */
function resolved(a: Annotation, at = T2): Annotation {
  return { ...a, status: "resolved", updated_at: at, replies: [...a.replies, { author: "agent", body: "改好了", at }] };
}

describe("mergeMaterialFiles: an agent changed the file while the UI was saving", () => {
  it("I edited the comment and the agent marked it done: both are kept", () => {
    const base = file(note("a1"));
    const mine = file({ ...note("a1"), body: "改成粗体", updated_at: T1 });
    const theirs = file(resolved(note("a1")));
    const { file: out, conflicts } = mergeMaterialFiles(base, mine, theirs);
    const a = out.annotations[0];
    expect(a.body).toBe("改成粗体");
    expect(a.status).toBe("resolved");
    expect(a.replies).toHaveLength(1);
    expect(a.updated_at).toBe(T2);
    expect(conflicts).toEqual([]);
  });

  it("I added a note and the agent wrote back another: both are there, and my new note keeps its position", () => {
    const base = file(note("a1"), note("a2"));
    const mine = file(note("a1"), note("a2"), note("n1"));
    const theirs = file(note("a1"), resolved(note("a2")));
    const out = mergeMaterialFiles(base, mine, theirs).file;
    expect(out.annotations.map((a) => a.id)).toEqual(["a1", "a2", "n1"]);
    expect(out.annotations[1].status).toBe("resolved");
  });

  it("a note added on their side is kept too (placed after)", () => {
    const out = mergeMaterialFiles(file(note("a1")), file(note("a1")), file(note("a1"), note("t1"))).file;
    expect(out.annotations.map((a) => a.id)).toEqual(["a1", "t1"]);
  });

  it("I deleted a note and they did not touch it: deleted", () => {
    const out = mergeMaterialFiles(file(note("a1"), note("a2")), file(note("a2")), file(note("a1"), note("a2"))).file;
    expect(out.annotations.map((a) => a.id)).toEqual(["a2"]);
  });

  it("I deleted a note and they marked it done: still deleted (an explicit user action), and recorded as a conflict", () => {
    const { file: out, conflicts } = mergeMaterialFiles(file(note("a1")), file(), file(resolved(note("a1"))));
    expect(out.annotations).toEqual([]);
    expect(conflicts).toHaveLength(1);
  });

  it("they deleted a note and I did not touch it: deleted", () => {
    const out = mergeMaterialFiles(file(note("a1"), note("a2")), file(note("a1"), note("a2")), file(note("a2"))).file;
    expect(out.annotations.map((a) => a.id)).toEqual(["a2"]);
  });

  it("they deleted a note and I edited it: my edited copy is kept, and recorded as a conflict", () => {
    const { file: out, conflicts } = mergeMaterialFiles(file(note("a1")), file({ ...note("a1"), body: "新意见" }), file());
    expect(out.annotations[0].body).toBe("新意见");
    expect(conflicts).toHaveLength(1);
  });

  it("both sides edited the comment: mine wins, and it is recorded as a conflict", () => {
    const { file: out, conflicts } = mergeMaterialFiles(
      file(note("a1")),
      file({ ...note("a1"), body: "我的" }),
      file({ ...note("a1"), body: "对方的" }),
    );
    expect(out.annotations[0].body).toBe("我的");
    expect(conflicts).toEqual(["a1.body"]);
  });

  it("both sides changed the status: the newer updated_at wins", () => {
    const mineNewer = mergeMaterialFiles(
      file(note("a1")),
      file({ ...note("a1"), status: "wontfix", updated_at: "2026-10-17T00:09:00.000Z" }),
      file(resolved(note("a1"))),
    ).file;
    expect(mineNewer.annotations[0].status).toBe("wontfix");
    const theirsNewer = mergeMaterialFiles(
      file(note("a1")),
      file({ ...note("a1"), status: "wontfix", updated_at: T1 }),
      file(resolved(note("a1"))),
    ).file;
    expect(theirsNewer.annotations[0].status).toBe("resolved");
  });

  it("both sides recorded a copied-out time: the later one wins (compared as instants, so time zones work too), and it is not a conflict", () => {
    const { file: out, conflicts } = mergeMaterialFiles(
      file(note("a1")),
      file({ ...note("a1"), handed_off_at: "2026-10-20T02:00:00.000Z" }),
      // 21:30 the previous day at UTC-5 = 02:30 UTC, which is later than mine; comparing as strings would pick wrongly
      file({ ...note("a1"), handed_off_at: "2026-10-19T21:30:00-05:00" }),
    );
    expect(out.annotations[0].handed_off_at).toBe("2026-10-19T21:30:00-05:00");
    expect(conflicts).toEqual([]);
    const onlyMine = mergeMaterialFiles(file(note("a1")), file({ ...note("a1"), handed_off_at: T1 }), file(note("a1"))).file;
    expect(onlyMine.annotations[0].handed_off_at).toBe(T1);
  });

  it("both sides added replies: both are kept, ordered by time", () => {
    const base = file(note("a1"));
    const mine = file({ ...note("a1"), replies: [{ author: "我", body: "补充", at: T1 }] });
    const theirs = file(resolved(note("a1")));
    expect(mergeMaterialFiles(base, mine, theirs).file.annotations[0].replies.map((r) => r.body)).toEqual(["补充", "改好了"]);
  });

  it("item info: if only one side changed it, that side wins", () => {
    const base = file(note("a1"));
    const theirs = { ...file(note("a1")), material: { ...base.material, sha256: "abc" } };
    expect(mergeMaterialFiles(base, file(note("a1")), theirs).file.material.sha256).toBe("abc");
  });

  it("unknown fields (added by a later version) are kept from both sides", () => {
    const base = file(note("a1"));
    const theirs = { ...file({ ...note("a1"), extra: 1 } as Annotation), future: true } as MaterialFile;
    const out = mergeMaterialFiles(base, file(note("a1")), theirs).file as MaterialFile & { future?: boolean };
    expect(out.future).toBe(true);
    expect((out.annotations[0] as Annotation & { extra?: number }).extra).toBe(1);
  });

  it("no common starting point (a new file collided with one someone else also created): both sides are kept", () => {
    const out = mergeMaterialFiles(undefined, file(note("n1")), file(note("t1"))).file;
    expect(out.annotations.map((a) => a.id)).toEqual(["n1", "t1"]);
  });

  it("both sides identical: unchanged", () => {
    const f = file(note("a1"), note("a2"));
    const { file: out, conflicts } = mergeMaterialFiles(f, f, f);
    expect(same(out, f)).toBe(true);
    expect(conflicts).toEqual([]);
  });
});

describe("mergeMaterialFiles: undo reverts only that step's own change", () => {
  // Undo = mergeMaterialFiles(base: after that step, mine: before that step, theirs: now)
  it("undoing a comment edit: the comment goes back and the status an agent wrote in between stays", () => {
    const before = file(note("a1"));
    const after = file({ ...note("a1"), body: "改过的", updated_at: T1 });
    const now = file(resolved({ ...note("a1"), body: "改过的", updated_at: T1 }));
    const out = mergeMaterialFiles(after, before, now).file.annotations[0];
    expect(out.body).toBe("意见 a1");
    expect(out.status).toBe("resolved");
    expect(out.replies).toHaveLength(1);
  });

  it("undoing an addition: that note is removed and the others are untouched", () => {
    const before = file(note("a1"));
    const after = file(note("a1"), note("n1"));
    const now = file(resolved(note("a1")), note("n1"));
    const out = mergeMaterialFiles(after, before, now).file;
    expect(out.annotations.map((a) => a.id)).toEqual(["a1"]);
    expect(out.annotations[0].status).toBe("resolved");
  });

  it("undoing a deletion: that note comes back", () => {
    const before = file(note("a1"), note("a2"));
    const after = file(note("a2"));
    const out = mergeMaterialFiles(after, before, after).file;
    expect(out.annotations.map((a) => a.id).sort()).toEqual(["a1", "a2"]);
  });
});
