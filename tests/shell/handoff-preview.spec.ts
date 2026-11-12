// The images Copy as Images makes, for a person to look at: the real shell draws them from a sample page and a sample clip with notes
// written straight into the notes files. Four cases: an image with 4 notes, a video with notes at 6 moments, a video with notes at
// 25 moments (more than 10 frames: several frames share an image), an image with 20 notes (more than fit on one image: two images).
// Not run normally; to make them:
//   node -e "import('./scripts/readme-shots/sample.mjs').then(async (m) => { await m.renderLanding('<folder>/material'); await m.renderClip('<folder>/material/clip.mp4'); })"
//   $env:SNIPTOSS_HANDOFF_PREVIEW = '<folder>'; npx playwright test -c playwright.shell.config.ts handoff-preview
// Output goes to <folder>/<case>/ (build tests/shell/.app first with npm run e2e:shell)

import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, waitFor, type Shell } from "./harness";

const OUT = process.env.SNIPTOSS_HANDOFF_PREVIEW;

test.skip(!OUT, "Only makes the images when SNIPTOSS_HANDOFF_PREVIEW is set");

type Shape =
  | { type: "rect"; x: number; y: number; w: number; h: number }
  | { type: "point"; x: number; y: number }
  | { type: "arrow"; from: [number, number]; to: [number, number] };
type Note = { body: string; category?: string; shape?: Shape; time?: number; color?: string };

const AT = "2026-11-12T03:00:00Z";

function notesFile(path: string, material: Record<string, unknown>, notes: Note[]) {
  return JSON.stringify(
    {
      schema: "sniptoss/5",
      material: { path, ...material },
      annotations: notes.map((n, i) => ({
        id: `n${String(i + 1).padStart(5, "0")}`,
        status: "open",
        category: n.category ?? "change",
        body: n.body,
        anchor: {
          ...(n.time !== undefined ? { time: { start: n.time } } : {}),
          ...(n.shape ? { shapes: [n.shape] } : {}),
        },
        author: "user",
        created_at: AT,
        updated_at: AT,
        ...(n.color ? { color: n.color } : {}),
        replies: [],
      })),
    },
    null,
    2,
  );
}

const rect = (x: number, y: number, w: number, h: number): Shape => ({ type: "rect", x, y, w, h });
const point = (x: number, y: number): Shape => ({ type: "point", x, y });
const arrow = (x1: number, y1: number, x2: number, y2: number): Shape => ({ type: "arrow", from: [x1, y1], to: [x2, y2] });

// The landing page (1600 × 1000): logo top left, three links top right, a two-line headline, a paragraph, a pink button, a watermark
const PAGE4: Note[] = [
  { body: "标题字重太细，改成 Bold", shape: rect(0.055, 0.24, 0.45, 0.21) },
  { body: "按钮颜色换成品牌棕 #6B3F25", shape: rect(0.057, 0.632, 0.215, 0.09) },
  { body: "去掉这个水印", category: "remove", shape: arrow(0.66, 0.4, 0.75, 0.27) },
  { body: "导航文字再大一号", shape: point(0.905, 0.06) },
];

const PAGE20: Note[] = [
  { body: "Logo 换成横版，左边留出 24 px", shape: rect(0.052, 0.035, 0.1, 0.05) },
  { body: "Beans 改成 Shop", shape: point(0.722, 0.06) },
  { body: "这一项加下划线表示当前页", shape: point(0.8, 0.06) },
  { body: "Visit us 后面加一个定位图标", category: "add", shape: point(0.905, 0.06) },
  { body: "导航整体下移 8 px", shape: rect(0.69, 0.035, 0.26, 0.05) },
  { body: "标题字重太细，改成 Bold", shape: rect(0.055, 0.24, 0.45, 0.21) },
  { body: "逗号后面换行，不要断在 brewed 中间", shape: point(0.33, 0.3) },
  { body: "slowly 用斜体强调", shape: arrow(0.44, 0.47, 0.33, 0.4) },
  { body: "正文字号 26 → 24，行距不变", shape: rect(0.058, 0.495, 0.38, 0.085) },
  { body: "「within the week」改成「in 3 days」", shape: point(0.2, 0.56) },
  { body: "按钮颜色换成品牌棕 #6B3F25", shape: rect(0.057, 0.632, 0.215, 0.09) },
  { body: "按钮文案改成 Subscribe", shape: point(0.165, 0.677) },
  { body: "这个链接和按钮垂直居中对齐", shape: arrow(0.33, 0.76, 0.3, 0.69) },
  { body: "箭头换成图标，不要用字符", shape: point(0.413, 0.677) },
  { body: "去掉这个水印", category: "remove", shape: arrow(0.66, 0.4, 0.75, 0.27) },
  { body: "水印下面这块高光压暗一点", shape: rect(0.74, 0.1, 0.2, 0.13) },
  { body: "咖啡壶的把手被裁掉了，往左挪", shape: point(0.93, 0.5) },
  { body: "杯口的蒸汽再明显一些", category: "add", shape: point(0.7, 0.55) },
  { body: "右下角加配送说明：每周一发货", category: "add", shape: rect(0.6, 0.86, 0.34, 0.09) },
  { body: "这里的背景是不是太黄了？", category: "question", shape: point(0.5, 0.9) },
];

// The clip (6 s, 1280 × 720): brand top left; the headline fades in at 2.0 s, the paragraph at 2.7 s, the button at 3.2 s
const CLIP6: Note[] = [
  { time: 0.5, body: "品牌名放大到 28 px", shape: rect(0.05, 0.04, 0.12, 0.06) },
  { time: 2.25, body: "标题淡入再慢一点，现在太急", shape: arrow(0.56, 0.52, 0.42, 0.42) },
  { time: 3.0, body: "这段文字太长，删到一行", category: "remove", shape: rect(0.06, 0.59, 0.37, 0.14) },
  { time: 3.75, body: "按钮出现时加一个轻微的弹跳", category: "add", shape: point(0.16, 0.79) },
  { time: 3.75, body: "这里的推镜头速度是不是可以再慢一些？", category: "question" },
  { time: 4.5, body: "画面右侧的咖啡壶过曝，压一下高光", shape: rect(0.6, 0.3, 0.3, 0.45) },
  { time: 4.5, body: "按钮和正文的间距拉大到 40 px", shape: arrow(0.3, 0.9, 0.2, 0.82) },
  { time: 5.5, body: "结尾定格 1 秒再结束", category: "add", shape: point(0.5, 0.5) },
];

const SPOTS: Shape[] = [
  rect(0.05, 0.04, 0.12, 0.06),
  point(0.7, 0.45),
  arrow(0.5, 0.3, 0.38, 0.4),
  rect(0.06, 0.31, 0.42, 0.24),
  point(0.16, 0.79),
  rect(0.6, 0.3, 0.3, 0.45),
  arrow(0.3, 0.92, 0.2, 0.82),
  point(0.85, 0.2),
];
const WORDS = [
  "这一帧的标题位置再往上 12 px",
  "推镜头在这里有一下卡顿",
  "这里的颜色偏黄，往冷调一点",
  "文字出现得太早，延后 4 帧",
  "把这个元素放大 10%",
  "这一帧的对比度太高",
  "这里加一个转场",
  "背景再虚化一些",
];
const CLIP25: Note[] = Array.from({ length: 25 }, (_, i) => ({
  time: Math.round((0.25 + i * 0.22) * 24) / 24,
  body: WORDS[i % WORDS.length],
  category: i % 9 === 4 ? "question" : i % 7 === 3 ? "remove" : "change",
  shape: SPOTS[(i * 3) % SPOTS.length],
}));

const CASES = [
  { name: "1-image-4-notes", file: "assets/page-4.png", from: "hero.png", kind: "image", notes: PAGE4 },
  { name: "2-video-6-moments", file: "video/clip-6.mp4", from: "clip.mp4", kind: "video", notes: CLIP6 },
  { name: "3-video-25-moments", file: "video/clip-25.mp4", from: "clip.mp4", kind: "video", notes: CLIP25 },
  { name: "4-image-20-notes", file: "assets/page-20.png", from: "hero.png", kind: "image", notes: PAGE20 },
] as const;

/** The newest folder of saved images (several images are saved as files, HandoffImages.Folder) */
function newestHandoff(shell: Shell): string | undefined {
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const p = join(dir, e.name);
      if (e.name === "handoff") found.push(...readdirSync(p).map((n) => join(p, n)));
      else if (depth < 3 && e.name !== "WebView2") walk(p, depth + 1);
    }
  };
  walk(shell.temp, 0);
  return found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

test("the images Copy as Images makes for the four cases", async ({ shell }) => {
  test.setTimeout(300_000);
  const material = join(OUT!, "material");
  for (const c of CASES) {
    copyFileSync(join(material, c.from), join(shell.project, c.file));
    const size = c.kind === "image" ? { width: 1600, height: 1000 } : { width: 1280, height: 720, duration: 6, frame_rate: 24 };
    writeFileSync(
      join(shell.project, ".sniptoss", "annotations", `${c.file.replace("/", "__")}.json`),
      notesFile(c.file, { kind: c.kind, ...size }, [...c.notes]),
    );
  }
  await shell.launch();
  // Setting up the capture fakes also swaps the clipboard for a recorder: without this the images would land on the system clipboard
  await shell.ask("debugCaptureFake", { monitors: [{ x: -20000, y: -20000, width: 1280, height: 720, scale: 1 }], windows: [], cursor: null });
  const page = shell.page;
  const toast = page.locator(".toast");
  for (const c of CASES) {
    const out = join(OUT!, c.name);
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    const before = newestHandoff(shell);
    const name = c.file.split("/")[1];
    await page.locator(".lib-row", { hasText: name }).first().click({ button: "right" });
    await page.getByRole("menuitem", { name: /复制批注成图片|Copy Notes as Images/ }).click();
    await expect(toast.filter({ hasText: /图片|image/ })).toBeVisible({ timeout: 120_000 });
    const said = (await toast.first().innerText()).replace(/\s+/g, " ");
    const single = join(out, "01.png");
    const one = await shell.ask("debugClipboardPng", { path: single }).then(
      () => existsSync(single),
      () => false,
    );
    if (!one) {
      const dir = await waitFor("the images to be saved", async () => {
        const d = newestHandoff(shell);
        return d && d !== before ? d : undefined;
      }).catch((e: unknown) => {
        console.log(`${c.name}: ${said}\n${shell.log().slice(-12).join("\n")}`);
        throw e;
      });
      cpSync(dir, out, { recursive: true });
    }
    writeFileSync(join(out, "toast.txt"), said);
    // What was noted, for checking how an AI reads the images
    writeFileSync(join(out, "notes.json"), JSON.stringify(c.notes, null, 2));
    console.log(`${c.name}: ${readdirSync(out).filter((n) => n.endsWith(".png")).length} image(s) — ${said}`);
    await toast.first().getByRole("button").last().click({ timeout: 1500 }).catch(() => {});
    await expect(toast).toHaveCount(0, { timeout: 15_000 }).catch(() => {});
  }
});
