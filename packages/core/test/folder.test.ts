import { describe, expect, it } from "vitest";
import { annotationFileFor, slugFor, type Annotation, type Material } from "../src/index.js";
import { renderHandoff, renderReview } from "./i18n.js";

// Whole-folder comments (pizhu/3): one notes file per folder; in REVIEW.md and the text copied for AI they come first and say they cover
// every item inside

const note = (id: string, body: string, extra: Partial<Annotation> = {}): Annotation => ({
  id,
  status: "open",
  category: "change",
  anchor: {},
  body,
  author: "我",
  created_at: "2026-10-17T00:00:00Z",
  updated_at: "2026-10-17T00:00:00Z",
  replies: [],
  ...extra,
});
const folder = (path: string): Material => ({ path, kind: "folder" });
const image: Material = { path: "assets/hero.png", kind: "image", sha256: "0", width: 1000, height: 500 };

describe("notes files of folders", () => {
  it("file names: a__b@folder.json for a subfolder, @folder.json for the folder that holds .sniptoss, unchanged for items", () => {
    expect(slugFor("assets/ui", "folder")).toBe("assets__ui@folder.json");
    expect(slugFor(".", "folder")).toBe("@folder.json");
    expect(annotationFileFor(".", "folder")).toBe(".sniptoss/annotations/@folder.json");
    expect(slugFor("assets/hero.png", "image")).toBe("assets__hero.png.json");
    expect(slugFor("assets/hero.png")).toBe("assets__hero.png.json");
  });
});

describe("folder comments in REVIEW.md", () => {
  it("come before the items and say they cover the whole folder and every item inside", () => {
    const text = renderReview([
      { material: image, annotations: [note("img001", "标题换粗体", { anchor: { shapes: [{ type: "point", x: 0.5, y: 0.5 }] } })] },
      { material: folder("assets"), annotations: [note("fld001", "这一批整体偏暗，全部提亮")] },
      { material: folder("."), annotations: [note("root01", "所有图统一加水印")] },
    ]);
    expect(text).toContain("# 待处理批注（3 条）");
    expect(text).toContain("标为「整个文件夹」的批注适用于该文件夹内的全部素材");
    const root = text.indexOf("## ./  ·  文件夹意见，适用于文件夹内的全部素材（含子文件夹）");
    const sub = text.indexOf("## assets/  ·  文件夹意见");
    const file = text.indexOf("## assets/hero.png");
    expect(root).toBeGreaterThan(0);
    expect(sub).toBeGreaterThan(root);
    expect(file).toBeGreaterThan(sub);
    expect(text).toContain("### [fld001] 修改 · 整个文件夹\n这一批整体偏暗，全部提亮");
  });

  it("without folder comments the extra explanation is left out", () => {
    const text = renderReview([{ material: image, annotations: [note("img001", "x")] }]);
    expect(text).not.toContain("整个文件夹");
  });
});

describe("folder comments in the text copied for AI", () => {
  it("a single folder: says to change the items in this folder, and gives its location in the project and its full path", () => {
    const text = renderHandoff([
      { material: folder("assets/ui"), root: "F:\\proj", items: [{ annotation: note("fld001", "按钮统一圆角"), index: 1 }] },
    ]);
    expect(text).toContain("请按以下批注修改这个文件夹内的素材。");
    expect(text).toContain(
      "## 整个文件夹 ui  ·  文件夹意见，适用于文件夹内的全部素材（含子文件夹）\n文件夹：assets/ui/（完整路径：F:\\proj\\assets\\ui）",
    );
    expect(text).toContain("1. 修改 · 整个文件夹\n按钮统一圆角");
  });

  it("the folder that holds .sniptoss itself: named after the folder, with the notes folder as its path", () => {
    const text = renderHandoff([
      { material: folder("."), root: "F:\\EP003\\export\\", items: [{ annotation: note("root01", "统一加水印"), index: 1 }] },
    ]);
    expect(text).toContain("## 整个文件夹 export  ·  ");
    expect(text).toContain("文件夹：项目文件夹本身（完整路径：F:\\EP003\\export）");
  });

  it("folders and items together: folders first, and the intro says how many folders and items", () => {
    const text = renderHandoff([
      { material: image, root: "F:\\proj", items: [{ annotation: note("img001", "标题换粗体"), index: 1 }] },
      { material: folder("."), root: "F:\\proj", items: [{ annotation: note("root01", "统一加水印"), index: 1 }] },
    ]);
    expect(text).toContain("（1 个文件夹、1 个素材，共 2 条）");
    expect(text).toContain("标为「整个文件夹」的批注适用于该文件夹内的全部素材");
    expect(text.indexOf("## 整个文件夹 proj")).toBeLessThan(text.indexOf("## hero.png"));
  });
});
