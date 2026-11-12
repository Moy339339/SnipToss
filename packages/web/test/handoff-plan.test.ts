import { describe, expect, it } from "vitest";
import type { Annotation, HandoffMaterial, Material, NoteSection } from "@sniptoss/core";
import { NOTES_PER_IMAGE, gridColumns, planPages } from "../src/handoffPlan";

// Copy as Images: which notes share an image (handoffPlan.ts)

let seq = 0;
function note(section: NoteSection, opts: { time?: number; index?: number } = {}): HandoffMaterial["items"][number] {
  const marked = section === "marked" || section === "earlier";
  const annotation = {
    id: `n${++seq}`,
    status: "open",
    category: "change",
    body: `note ${seq}`,
    anchor: {
      ...(opts.time !== undefined ? { time: { start: opts.time } } : {}),
      ...(marked ? { shapes: [{ type: "point", x: 0.5, y: 0.5 }] } : {}),
    },
    snapshot: `snapshots/n${seq}.png`,
    author: "user",
    created_at: "2026-11-12T00:00:00Z",
    updated_at: "2026-11-12T00:00:00Z",
    replies: [],
  } as unknown as Annotation;
  return { annotation, index: opts.index ?? seq, section };
}
const group = (kind: string, path: string, items: HandoffMaterial["items"], more: Partial<HandoffMaterial> = {}): HandoffMaterial => ({
  material: { path, kind } as Material,
  root: "C:\\project",
  items,
  ...more,
});
const many = <T>(n: number, make: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => make(i));
const merged = { each: false, max: 10 };
const shape = (pages: ReturnType<typeof planPages>["pages"]) => pages.map((p) => p.map((u) => `${u.kind}:${u.notes.length}`).join(" "));

describe("planPages", () => {
  it("puts all notes of an image on one frame, overall comments included", () => {
    const g = group("image", "a.png", [...many(4, () => note("marked")), note("overall")]);
    const { pages, over } = planPages([g], merged);
    expect(shape(pages)).toEqual(["frame:5"]);
    expect(over).toBe(false);
  });

  it("gives a video one frame per moment, in time order, marks before timestamped comments; overall comments ride on the first", () => {
    const late = note("marked", { time: 4, index: 1 });
    const comment = note("timed", { time: 1.5, index: 1 });
    const early = note("marked", { time: 1.5, index: 2 });
    const overall = note("overall", { index: 1 });
    const { pages } = planPages([group("video", "v.mp4", [late, early, comment, overall])], merged);
    expect(pages.map((p) => p[0].time)).toEqual([1.5, 4]);
    expect(pages[0][0].notes).toEqual([early, comment, overall]);
    expect(pages[1][0].notes).toEqual([late]);
  });

  it("uses the stored snapshot for a video that only has overall comments, for notes on earlier versions and for items that are gone", () => {
    expect(shape(planPages([group("video", "v.mp4", [note("overall"), note("overall")])], merged).pages)).toEqual(["snapshot:2"]);
    const g = group("image", "a.png", [note("marked"), note("earlier"), note("earlier")]);
    expect(shape(planPages([g], merged).pages)).toEqual(["frame:1", "snapshot:1", "snapshot:1"]);
    const gone = group(
      "image",
      "gone.png",
      many(3, () => note("marked")),
      { missing: true },
    );
    expect(shape(planPages([gone], merged).pages)).toEqual(["snapshot:1", "snapshot:1", "snapshot:1"]);
  });

  it("keeps folder comments as text, all of one folder together", () => {
    expect(
      shape(
        planPages(
          [
            group(
              "folder",
              ".",
              many(3, () => note("overall")),
            ),
          ],
          merged,
        ).pages,
      ),
    ).toEqual(["text:3"]);
  });

  it("repeats a frame with more notes than fit, each time with an even share", () => {
    const { pages } = planPages(
      [
        group(
          "image",
          "a.png",
          many(20, () => note("marked")),
        ),
      ],
      merged,
    );
    expect(shape(pages)).toEqual(["frame:10", "frame:10"]);
    expect(
      shape(
        planPages(
          [
            group(
              "image",
              "a.png",
              many(NOTES_PER_IMAGE, () => note("marked")),
            ),
          ],
          merged,
        ).pages,
      ),
    ).toEqual(["frame:12"]);
    expect(
      shape(
        planPages(
          [
            group(
              "image",
              "a.png",
              many(25, () => note("marked")),
            ),
          ],
          merged,
        ).pages,
      ),
    ).toEqual(["frame:9", "frame:9", "frame:7"]);
  });

  it("lays frames out in the smallest grid that keeps the images within the limit", () => {
    const video = (n: number) =>
      group(
        "video",
        "v.mp4",
        many(n, (i) => note("marked", { time: i })),
      );
    expect(planPages([video(10)], merged).pages.every((p) => p.length === 1)).toBe(true);
    expect(planPages([video(11)], merged).pages.map((p) => p.length)).toEqual([2, 2, 2, 2, 2, 1]);
    expect(planPages([video(25)], merged).pages.map((p) => p.length)).toEqual([4, 4, 4, 4, 4, 4, 1]);
    expect(planPages([video(41)], merged).pages.map((p) => p.length)).toEqual([6, 6, 6, 6, 6, 6, 5]);
    expect(planPages([video(90)], merged).pages.length).toBe(10);
    expect(planPages([video(25)], { each: false, max: 20 }).pages.map((p) => p.length)).toEqual([...Array<number>(12).fill(2), 1]);
  });

  it("says so when even nine frames per image are not enough, and never groups when there is no limit", () => {
    const video = group(
      "video",
      "v.mp4",
      many(91, (i) => note("marked", { time: i })),
    );
    const plan = planPages([video], merged);
    expect(plan.over).toBe(true);
    expect(plan.pages.length).toBe(11);
    const free = planPages([video], { each: false, max: 0 });
    expect(free.over).toBe(false);
    expect(free.pages.length).toBe(91);
  });

  it("keeps a grid image within the notes limit when it can, and gives that up before going over the image limit", () => {
    // 12 frames with 5 notes each: 2 per image fits 12 notes and 6 images
    const five = (t: number) => many(5, () => note("marked", { time: t }));
    const some = group("video", "v.mp4", many(12, (i) => five(i)).flat());
    expect(shape(planPages([some], merged).pages)).toEqual(Array<string>(6).fill("frame:5 frame:5"));
    // 30 such frames: 2 per image would need 15 images, so 4 per image (20 notes each) it is
    const lots = group("video", "v.mp4", many(30, (i) => five(i)).flat());
    const plan = planPages([lots], merged);
    expect(plan.pages.length).toBe(8);
    expect(plan.over).toBe(false);
  });

  it("makes one image per note, from its snapshot, when set to separate images", () => {
    const g = group("image", "a.png", [...many(3, () => note("marked")), note("overall")]);
    const folder = group(
      "folder",
      ".",
      many(2, () => note("overall")),
    );
    expect(shape(planPages([g, folder], { each: true, max: 10 }).pages)).toEqual([
      "snapshot:1",
      "snapshot:1",
      "snapshot:1",
      "snapshot:1",
      "text:1",
      "text:1",
    ]);
    expect(
      planPages(
        [
          group(
            "image",
            "a.png",
            many(30, () => note("marked")),
          ),
        ],
        { each: true, max: 10 },
      ).pages.length,
    ).toBe(30);
  });

  it("mixes items on a grid image when frames must be grouped; text takes no cell", () => {
    const images = many(12, (i) => group("image", `${i}.png`, [note("marked")]));
    const folder = group("folder", ".", [note("overall")]);
    const { pages } = planPages([folder, ...images], merged);
    expect(shape(pages)[0]).toBe("text:1 frame:1 frame:1");
    expect(pages.length).toBe(6);
  });
});

describe("gridColumns", () => {
  it("is 1 for a single frame, 2 up to four frames, 3 beyond", () => {
    expect([1, 2, 3, 4, 5, 6, 9].map(gridColumns)).toEqual([1, 2, 2, 2, 3, 3, 3]);
  });
});
