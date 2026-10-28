import { describe, expect, it } from "vitest";
import * as core from "../src/index.js";
import { type Annotation, type HandoffMaterial } from "../src/index.js";
import { describeShape, describeWhere, en, renderHandoff, renderReview } from "./i18n.js";

const note = (id: string, body: string, extra: Partial<Annotation> = {}): Annotation => ({
  id,
  status: "open",
  category: "change",
  anchor: { shapes: [{ type: "rect", x: 0.1, y: 0.2, w: 0.3, h: 0.1 }] },
  body,
  author: "我",
  created_at: "2026-10-15T00:00:00Z",
  updated_at: "2026-10-15T00:00:00Z",
  replies: [],
  ...extra,
});

const video = (root: string, path: string, items: HandoffMaterial["items"]): HandoffMaterial => ({
  material: { path, kind: "video", sha256: "0", width: 1080, height: 1920, duration: 32.5 },
  root,
  items,
});

describe("renderHandoff", () => {
  it("one item: states where the project is, the file's location in the project (with the full path), the notes themselves and the snapshots", () => {
    const text = renderHandoff([
      video("F:\\EP003\\export", "片头/第1条.mp4", [
        { annotation: note("k3f9a2", "标题字太细了", { anchor: { time: { start: 12.5 } }, snapshot: "snapshots/k3f9a2.png" }), index: 1 },
        { annotation: note("ab12cd", "结尾黑屏太长"), index: 2 },
        { annotation: note("ee11ff", "整体节奏偏慢", { anchor: {} }), index: 1 },
      ]),
    ]);
    expect(text).toContain("请按以下 3 条批注修改这个视频。");
    expect(text).toContain("文件均位于项目文件夹「export」（当前路径：F:\\EP003\\export）。");
    expect(text).toContain("下文的文件和截图路径均相对于项目文件夹，文件路径后的括号内为完整路径；如项目文件夹已移动，按相对路径查找。");
    expect(text).toContain("文件：片头/第1条.mp4（完整路径：F:\\EP003\\export\\片头\\第1条.mp4）");
    // Notes on the canvas come first; timestamped comments (a time, no position) and overall comments (neither) each get their own section
    // with their own numbering, and since the heading already says which kind, the line does not repeat it (ADR-0008)
    expect(text).toContain("2. 修改 · 区域 画面左上（横 10%–40%、纵 20%–30%），x=108 y=384 宽=324 高=192 px");
    expect(text).toContain("### 时间点意见（针对视频的某一时刻或某一段，不指定位置）\n\n1. 修改 · 00:12.500\n标题字太细了");
    expect(text).toContain("### 整体意见（针对整个文件，不指定位置）\n\n1. 修改\n整体节奏偏慢");
    expect(text.indexOf("2. 修改 · 区域")).toBeLessThan(text.indexOf("### 时间点意见"));
    expect(text.indexOf("### 时间点意见")).toBeLessThan(text.indexOf("### 整体意见"));
    // Snapshots are written by their location in the project, so they are found even if the project moves
    expect(text).toContain("截图：.sniptoss/snapshots/k3f9a2.png");
  });

  it("does not tell the AI to run a command to mark notes Done afterwards, and does not write the 6-character id (the notes stay as a record)", () => {
    const text = renderHandoff([video("E:\\a", "1.mp4", [{ annotation: note("aaaaaa", "一"), index: 1 }])]);
    expect(text).not.toContain("resolve");
    expect(text).not.toContain("aaaaaa");
    expect(text).not.toContain("改完");
  });

  it("a single note, with the text from Settings appended", () => {
    const text = renderHandoff([video("E:\\a", "sub/x.mp4", [{ annotation: note("aaaaaa", "改色"), index: 2 }])], {
      extra: "改完重新导出一版",
    });
    expect(text.startsWith("请按以下批注修改素材。")).toBe(true);
    expect(text).toContain("E:\\a\\sub\\x.mp4");
    expect(text).not.toContain("请先查看截图");
    expect(text.endsWith("\n\n改完重新导出一版")).toBe(true);
  });

  it("several items in different projects: each project's location is listed and each file says which project it belongs to; items without notes are not listed", () => {
    const text = renderHandoff([
      video("E:\\a", "1.mp4", [{ annotation: note("aaaaaa", "一"), index: 1 }]),
      video("E:\\a", "2.mp4", []),
      video("E:\\b\\", "3.mp4", [{ annotation: note("bbbbbb", "三"), index: 1 }]),
    ]);
    expect(text).toContain("（2 个素材，共 2 条）");
    expect(text).not.toContain("2.mp4");
    expect(text).toContain("- 「a」：E:\\a\n- 「b」：E:\\b\n");
    expect(text).toContain("文件：项目「a」中的 1.mp4（完整路径：E:\\a\\1.mp4）");
    expect(text).toContain("文件：项目「b」中的 3.mp4（完整路径：E:\\b\\3.mp4）");
  });

  it("the separator of the full path follows the project folder: a network share uses backslashes, other systems (/Users/…) use forward slashes", () => {
    const text = renderHandoff([
      video("\\\\nas\\共享\\片子", "片头/1.mp4", [{ annotation: note("aaaaaa", "一"), index: 1 }]),
      video("/Users/alex/片子/", "片头/2.mp4", [{ annotation: note("bbbbbb", "二"), index: 1 }]),
    ]);
    expect(text).toContain("（完整路径：\\\\nas\\共享\\片子\\片头\\1.mp4）");
    expect(text).toContain("（完整路径：/Users/alex/片子/片头/2.mp4）");
  });

  it("checked notes that are already resolved are labeled as resolved, with a note that they need not be redone", () => {
    const root = "E:\\a";
    const mixed = renderHandoff([
      video(root, "1.mp4", [
        { annotation: note("aaaaaa", "一"), index: 1 },
        { annotation: note("bbbbbb", "二", { status: "resolved" }), index: 2 },
        { annotation: note("cccccc", "三", { status: "wontfix" }), index: 3 },
      ]),
    ]);
    expect(mixed).toContain("请按以下 3 条批注修改这个视频。");
    expect(mixed).toContain("其中 2 条已处理（标有「已处理」），仅供对照；除非用户另有说明，无需重新修改。");
    expect(mixed).toContain("1. 修改");
    expect(mixed).toContain("2.（已处理：已改） 修改");
    expect(mixed).toContain("3.（已处理：不改） 修改");

    const allDone = renderHandoff([video(root, "1.mp4", [{ annotation: note("bbbbbb", "二", { status: "resolved" }), index: 2 }])]);
    expect(allDone.startsWith("以下批注已处理")).toBe(true);
    expect(allDone).not.toContain("请按以下");
  });

  it("category explanation: covers only the categories used, says a question needs an answer rather than a change to the item, and is omitted when every note is Change", () => {
    const q = renderHandoff([
      video("E:\\a", "1.mp4", [{ annotation: note("aaaaaa", "这是什么字？", { category: "question" }), index: 1 }]),
    ]);
    expect(q).toContain("类别说明：「疑问」是提问，只需回答，无需修改素材。");
    expect(q).toContain("1. 疑问 · ");
    const mixed = renderHandoff([
      video("E:\\a", "1.mp4", [
        { annotation: note("aaaaaa", "改色"), index: 1 },
        { annotation: note("bbbbbb", "去掉水印", { category: "remove" }), index: 2 },
      ]),
    ]);
    expect(mixed).toContain("类别说明：「修改」按说明修改标出的内容；「删除」去掉标出的内容。");
    const none = renderHandoff([video("E:\\a", "1.mp4", [{ annotation: note("aaaaaa", "改色"), index: 1 }])]);
    expect(none).not.toContain("疑问");
    expect(none).not.toContain("类别说明");
  });

  it("a missing item is flagged; notes on earlier versions get a section of their own that says the snapshot is authoritative, numbered from 1 on its own (ADR-0008)", () => {
    const text = renderHandoff([
      { ...video("E:\\a", "1.mp4", [{ annotation: note("aaaaaa", "改色"), index: 1 }]), missing: true },
      video("E:\\a", "2.mp4", [
        { annotation: note("bbbbbb", "旧的"), index: 1, section: "earlier" },
        { annotation: note("dddddd", "旧的整体意见", { anchor: {} }), index: 2, section: "earlier" },
        { annotation: note("cccccc", "新的"), index: 1 },
      ]),
    ]);
    expect(text).toContain("注意：未找到该文件：可能已被删除、重命名或移动，请先确认其当前位置。");
    const earlier = text.indexOf("### 写在旧版本上的批注（这个文件在写下它们之后被替换过：位置对应当时的画面，请以截图为准）");
    expect(earlier).toBeGreaterThan(text.indexOf("1. 修改 · 区域"));
    expect(text.slice(earlier)).toContain("1. 修改 · 区域");
    // An overall comment on an earlier version still says it is an overall comment (the section heading does not)
    expect(text.slice(earlier)).toContain("2. 修改 · 整体意见\n旧的整体意见");
    expect(text).not.toContain("写于素材修改之前");
  });

  it("the two kinds of video notes without a position are kept apart: with a time it is a timestamped comment (one moment or a range), without one an overall comment", () => {
    const m = video("E:\\a", "1.mp4", []).material;
    const at = note("t00001", "", { anchor: { time: { start: 2.104 } } });
    const span = note("t00002", "", { anchor: { time: { start: 1, end: 3.5 } } });
    const whole = note("w00001", "", { anchor: {} });
    expect([at, span, whole, note("m00001", "")].map((a) => core.sectionOf(a))).toEqual(["timed", "timed", "overall", "marked"]);
    // REVIEW.md and Copy as Images have no sections, so the line says which kind it is
    expect(describeWhere(at, m)).toBe("00:02.104 · 时间点意见");
    expect(describeWhere(span, m)).toBe("00:01.000–00:03.500 · 时间点意见");
    expect(describeWhere(whole, m)).toBe("整体意见");
    expect(renderReview([{ material: m, annotations: [at] }])).toContain("### [t00001] 修改 · 00:02.104 · 时间点意见");
  });

  it("whole-folder comments are not split into sections (the group heading already says it is the whole folder)", () => {
    const text = renderHandoff([
      {
        material: { path: ".", kind: "folder" },
        root: "E:\\a",
        items: [{ annotation: note("ffffff", "统一加水印", { anchor: {} }), index: 1, section: "overall" }],
      },
    ]);
    expect(text).not.toContain("###");
    expect(text).toContain("1. 修改 · 整个文件夹");
  });

  it("snapshots: only says every note has one when every note does; folder comments have no snapshot", () => {
    const shot = (id: string) => ({ annotation: note(id, id, { snapshot: `snapshots/${id}.png` }), index: 1 });
    const all = renderHandoff([video("E:\\a", "1.mp4", [shot("aaaaaa"), shot("bbbbbb")])]);
    expect(all).toContain("每条批注均附有截图，截图中已用标记标出位置，请先查看截图再处理。");
    const one = renderHandoff([video("E:\\a", "1.mp4", [shot("aaaaaa")])]);
    expect(one).toContain("批注附有截图，截图中已用标记标出位置");
    const some = renderHandoff([
      video("E:\\a", "1.mp4", [shot("aaaaaa")]),
      {
        material: { path: ".", kind: "folder" },
        root: "E:\\a",
        items: [{ annotation: note("ffffff", "统一加水印", { anchor: {} }), index: 1 }],
      },
    ]);
    expect(some).not.toContain("每条批注均附有截图");
    expect(some).toContain("附有「截图」的批注，请先查看截图");
    expect(some).toContain("文件夹：项目文件夹本身（完整路径：E:\\a）");
  });

  it("wording matches the UI: this image / this video", () => {
    const image = (items: HandoffMaterial["items"]): HandoffMaterial => ({
      material: { path: "a.png", kind: "image", sha256: "0", width: 100, height: 100 },
      root: "E:\\a",
      items,
    });
    expect(
      renderHandoff([
        image([
          { annotation: note("aaaaaa", "一"), index: 1 },
          { annotation: note("bbbbbb", "二"), index: 2 },
        ]),
      ]),
    ).toContain("请按以下 2 条批注修改这张图片。");
  });

  it("folder comments: the opening sentence varies with one folder (and how many notes), several folders, and folders plus items; folders come before items", () => {
    const folder = (path: string, ...ids: string[]): HandoffMaterial => ({
      material: { path, kind: "folder" },
      root: "E:\\a",
      items: ids.map((id, i) => ({ annotation: note(id, `${path} 的意见 ${i + 1}`, { anchor: {} }), index: i + 1 })),
    });
    expect(renderHandoff([folder("assets", "aaaaaa")]).startsWith("请按以下批注修改这个文件夹内的素材。")).toBe(true);
    const two = renderHandoff([folder("assets", "aaaaaa", "bbbbbb")]);
    expect(two.startsWith("请按以下 2 条批注修改这个文件夹内的素材。")).toBe(true);
    expect(two).toContain("标为「整个文件夹」的批注适用于该文件夹内的全部素材（含子文件夹），而非其中某一个文件。");
    expect(two).toContain("文件夹：assets/（完整路径：E:\\a\\assets）");
    expect(renderHandoff([folder("assets", "aaaaaa"), folder("video", "bbbbbb")])).toContain(
      "请按以下批注修改素材（2 个文件夹，共 2 条）。",
    );
    const mixed = renderHandoff([
      video("E:\\a", "video/1.mp4", [{ annotation: note("cccccc", "改色"), index: 1 }]),
      folder("assets", "aaaaaa"),
    ]);
    expect(mixed).toContain("请按以下批注修改素材（1 个文件夹、1 个素材，共 2 条）。");
    expect(mixed.indexOf("## 整个文件夹 assets")).toBeLessThan(mixed.indexOf("## 1.mp4"));
  });
});

// Verbatim golden files for the whole text (ADR-0004 layer 2): the cases above each cover one sentence; these cover the overall order,
// blank lines and punctuation.
// They fail when the wording or layout changes: check that the change in the golden files shown by git diff is right, then update with npx vitest -u
describe("renderHandoff whole-text golden files", () => {
  const image = (root: string, path: string, items: HandoffMaterial["items"]): HandoffMaterial => ({
    material: { path, kind: "image", sha256: "0", width: 1920, height: 1080 },
    root,
    items,
  });

  const twoProjects = (): HandoffMaterial[] => [
    {
      material: { path: "assets", kind: "folder" },
      root: "E:\\work\\EP003",
      items: [{ annotation: note("f00001", "这个文件夹里的图统一换成暖色调", { anchor: {} }), index: 1 }],
    },
    {
      ...video("E:\\work\\EP003", "片头/第1条.mp4", [
        {
          annotation: note("v00001", "标题字太细了", { anchor: { time: { start: 12.5 } }, snapshot: "snapshots/v00001.png" }),
          index: 1,
        },
        {
          annotation: note("v00002", "这段水印去掉", {
            category: "remove",
            anchor: { shapes: [{ type: "rect", x: 0.7, y: 0.85, w: 0.25, h: 0.1 }], time: { start: 65.25, end: 70 } },
            snapshot: "snapshots/v00002.png",
          }),
          index: 1,
          section: "earlier",
        },
        { annotation: note("v00003", "这里是不是少了字幕？", { category: "question", status: "resolved" }), index: 1 },
        { annotation: note("v00004", "整体节奏偏慢，配乐换轻快一点", { anchor: {} }), index: 1 },
      ]),
    },
    image("\\\\nas\\share\\poster", "海报/主视觉.png", [
      {
        annotation: note("i00001", "箭头指的按钮改成品牌蓝", {
          anchor: { shapes: [{ type: "arrow", from: [0.2, 0.3], to: [0.45, 0.5] }] },
        }),
        index: 1,
      },
      {
        annotation: note("i00002", "这里加一行副标题", {
          category: "add",
          anchor: {
            shapes: [
              {
                type: "path",
                points: [
                  [0.1, 0.6],
                  [0.3, 0.65],
                  [0.5, 0.62],
                ],
              },
            ],
          },
        }),
        index: 2,
      },
      {
        annotation: note("i00003", "不用改", {
          category: "change",
          status: "wontfix",
          anchor: { shapes: [{ type: "point", x: 0.9, y: 0.1 }] },
        }),
        index: 3,
      },
      {
        // A note with several places (ADR-0009): "2 places: …; …", and the intro gains the sentence that the comment applies to every place
        annotation: note("i00004", "这几个按钮都改成圆角", {
          anchor: {
            shapes: [
              { type: "rect", x: 0.1, y: 0.8, w: 0.2, h: 0.08 },
              { type: "rect", x: 0.4, y: 0.8, w: 0.2, h: 0.08 },
              { type: "point", x: 0.85, y: 0.85 },
            ],
          },
        }),
        index: 4,
      },
    ]),
  ];
  const oneImage = (): HandoffMaterial[] => [
    image("E:\\a", "海报.png", [
      { annotation: note("aaaaaa", "标题字太细了", { snapshot: "snapshots/aaaaaa.png" }), index: 1 },
      { annotation: note("bbbbbb", "右下角的图标去掉", { category: "remove", snapshot: "snapshots/bbbbbb.png" }), index: 2 },
    ]),
  ];

  it("two projects: folder comments, a video and an image; four categories, resolved and won't-fix notes, some with snapshots and some without, overall and earlier-version sections, and the text from Settings appended", async () => {
    const text = renderHandoff(twoProjects(), { extra: "改完重新导出一版，文件名不变" });
    await expect(text).toMatchFileSnapshot("../../../tests/golden/handoff/two-projects.zh-CN.txt");
  });

  it("one item with two notes: the opening sentence, the project location and the category explanation are written in their minimal form", async () => {
    await expect(renderHandoff(oneImage())).toMatchFileSnapshot("../../../tests/golden/handoff/one-image.zh-CN.txt");
  });

  // The text handed over when the UI is in English: for the same input, the explanation, categories, positions and statuses are in English
  // and the notes' own text is unchanged
  it("English: two projects", async () => {
    const text = core.renderHandoff(twoProjects(), en, { extra: "Re-export after the changes; keep the file names" });
    await expect(text).toMatchFileSnapshot("../../../tests/golden/handoff/two-projects.en.txt");
  });

  it("English: one item with two notes", async () => {
    await expect(core.renderHandoff(oneImage(), en)).toMatchFileSnapshot("../../../tests/golden/handoff/one-image.en.txt");
  });
});

describe("describeShape: the position in the frame and percentages first, then pixels", () => {
  const size = { width: 1000, height: 500 };
  it("3×3 grid positions", () => {
    expect(describeShape({ type: "point", x: 0.1, y: 0.1 }, size)).toBe("位置 画面左上（横 10%、纵 10%），x=100 y=50 px");
    expect(describeShape({ type: "point", x: 0.5, y: 0.5 })).toBe("位置 画面中央（横 50%、纵 50%）");
    expect(describeShape({ type: "point", x: 0.9, y: 0.6 })).toBe("位置 画面右侧居中（横 90%、纵 60%）");
    expect(describeShape({ type: "point", x: 0.5, y: 0.95 })).toBe("位置 画面下方居中（横 50%、纵 95%）");
  });
  it("a very wide, tall or large region is described as spanning across / down / most of the frame", () => {
    expect(describeShape({ type: "rect", x: 0, y: 0.85, w: 1, h: 0.15 })).toBe("区域 横贯画面下部（横 0%–100%、纵 85%–100%）");
    expect(describeShape({ type: "rect", x: 0.05, y: 0, w: 0.2, h: 1 })).toBe("区域 纵贯画面左侧（横 5%–25%、纵 0%–100%）");
    expect(describeShape({ type: "rect", x: 0.1, y: 0.1, w: 0.8, h: 0.8 })).toBe("区域 覆盖画面大部分（横 10%–90%、纵 10%–90%）");
  });
  it("an arrow gives its start and end; a freehand mark gives its extent", () => {
    expect(describeShape({ type: "arrow", from: [0.1, 0.9], to: [0.5, 0.5] }, size)).toBe(
      "箭头 从画面左下（横 10%、纵 90%）指向画面中央（横 50%、纵 50%），从 (100, 450) 到 (500, 250) px",
    );
    expect(
      describeShape(
        {
          type: "path",
          points: [
            [0.7, 0.1],
            [0.9, 0.3],
          ],
        },
        size,
      ),
    ).toBe("画笔标记 画面右上（横 70%–90%、纵 10%–30%），x=700 y=50 宽=200 高=100 px");
  });
});

describe('text for AI follows the design rules (6 · Copy): formal wording, never addresses the reader as 你 ("you"), never tells the AI to write a status back', () => {
  // Cover every case: folder + item, several projects, resolved, question, some with snapshots, an unreadable file, a missing item
  const folder: HandoffMaterial = {
    material: { path: ".", kind: "folder" },
    root: "E:\\a",
    items: [{ annotation: note("ffffff", "统一加水印", { anchor: {} }), index: 1 }],
  };
  const clip = video("E:\\b", "1.mp4", [
    { annotation: note("aaaaaa", "提亮", { snapshot: "snapshots/aaaaaa.png" }), index: 1 },
    { annotation: note("bbbbbb", "这是什么字", { category: "question" }), index: 2 },
    { annotation: note("cccccc", "去掉", { status: "resolved" }), index: 3 },
  ]);
  const texts = [
    renderHandoff([folder, clip]),
    renderHandoff([clip]),
    renderHandoff([video("E:\\b", "1.mp4", [{ annotation: note("cccccc", "去掉", { status: "wontfix" }), index: 3 }])]),
    renderReview(
      [
        { material: folder.material, annotations: [folder.items[0].annotation] },
        { material: clip.material, annotations: clip.items.map((i) => i.annotation) },
      ],
      { includeResolved: true, missing: ["1.mp4"], unreadable: [{ file: ".sniptoss/annotations/x.json", reason: "不是合法的 JSON" }] },
    ),
    renderReview([]),
  ];
  it.each(["你", "一下", "啦", "吧", "的话", "就行", "就好", "搞", "弄", "挪", "免得", "动手", "改完", "resolve", "回写", "！"])(
    'does not contain "%s"',
    (word) => {
      for (const t of texts) expect(t).not.toContain(word);
    },
  );
});
