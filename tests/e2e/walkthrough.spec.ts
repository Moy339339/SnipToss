// A set of UI behaviors: remembering the previous note's category, bulk status changes and the D key,
// the Copied tag on cards, the Help menu, the tidied Settings pages, the narrow-window toolbar collapsing into "⋯";
// overall comments on a video carry no time, marks linger a little when playback stops;
// the Library explaining what it doesn't list, deep folders and projects with the same name, showing only items with open notes

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, test, type App } from "./harness";
import { VERSION } from "./mock-host";

const card = (app: App, id: string) => app.page.locator(`[data-annot$="|${id}"]`);
const toast = (app: App) => app.page.locator(".toast");
const menuItem = (app: App, name: string | RegExp) => app.page.getByRole("menuitem", { name });
const focusStage = (app: App) => app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
const status = (app: App, file: string, id: string) => app.annotations(file).find((a) => a.id === id)?.status;
/** One note from a notes file, including the optional fields */
const raw = (app: App, file: string, id: string) =>
  (
    JSON.parse(readFileSync(join(app.project, ".sniptoss", "annotations", file), "utf8")).annotations as {
      id: string;
      updated_at: string;
      handed_off_at?: string;
    }[]
  ).find((a) => a.id === id);
const HERO = "assets__hero.png.json";
const CLIP = "video__clip.mp4.json";

test.beforeEach(({ app }) => {
  app.host.expanded = [join(app.project, "assets"), join(app.project, "video")];
});

test("bulk status change: checking one note from each of two items, Mark as Done at the bottom changes both at once with a single toast; one Ctrl+Z reverts them all", async ({ app }) => {
  await app.open();
  const bar = app.page.locator(".panel-batch");
  await expect(bar).toHaveCount(0);
  await card(app, "k3f9a2").locator(".card-check").click();
  await card(app, "p0c7xe").locator(".card-check").click();
  // The checked notes are all open: there is no Reopen; Delete comes last (icon only)
  await expect(bar.getByRole("button", { name: /^标记为|^重新打开/ })).toHaveText(["标记为已改", "标记为不改"]);
  await expect(bar.getByRole("button", { name: "删除" })).toBeVisible();
  await bar.getByRole("button", { name: "标记为已改" }).click();
  await expect(toast(app)).toContainText("已将 2 条批注标记为已改");
  await expect.poll(() => status(app, HERO, "k3f9a2")).toBe("resolved");
  await expect.poll(() => status(app, CLIP, "p0c7xe")).toBe("resolved");
  // The notes panel doesn't list resolved notes: both are gone, and the checks and that bar go with them
  await expect(card(app, "k3f9a2")).toHaveCount(0);
  await expect(bar).toHaveCount(0);
  await focusStage(app);
  await app.page.keyboard.press("Control+z");
  await expect(toast(app)).toContainText("已撤销：更改状态");
  await expect.poll(() => status(app, HERO, "k3f9a2")).toBe("open");
  await expect.poll(() => status(app, CLIP, "p0c7xe")).toBe("open");
});

test("D / Shift+D: with nothing checked they change the selected note and pressing again reopens it; with notes checked they act on the checked ones", async ({ app }) => {
  app.host.prefs = { panelResolved: true };
  await app.open();
  await card(app, "k3f9a2").click();
  await app.page.keyboard.press("d");
  await expect.poll(() => status(app, HERO, "k3f9a2")).toBe("resolved");
  await app.page.keyboard.press("d");
  await expect.poll(() => status(app, HERO, "k3f9a2")).toBe("open");
  await app.page.keyboard.press("Shift+D");
  await expect.poll(() => status(app, HERO, "k3f9a2")).toBe("wontfix");
  // Another note is checked: D acts on the checked one and the selected one is untouched
  await card(app, "p0c7xe").locator(".card-check").click();
  await app.page.keyboard.press("d");
  await expect.poll(() => status(app, CLIP, "p0c7xe")).toBe("resolved");
  expect(status(app, HERO, "k3f9a2")).toBe("wontfix");
  // The Annotate menu says it applies to the checked notes
  await app.page.locator(".menubar button", { hasText: "批注" }).click();
  await expect(menuItem(app, /重新打开勾选的 1 条/)).toBeEnabled();
  await expect(menuItem(app, /将勾选的 1 条标记为已改/)).toBeDisabled();
});

test("a new note starts with the category of the previous note on this item, and switching to another item returns to the default category", async ({ app }) => {
  await app.open();
  await focusStage(app);
  const on = app.page.locator(".composer .seg.is-on");
  await app.page.keyboard.press("n");
  await expect(on).toHaveText("修改");
  await app.page.locator(".composer").getByRole("button", { name: "删除" }).click();
  await app.page.locator(".composer-text").fill("右上角的角标去掉");
  await app.page.keyboard.press("Control+Enter");
  await expect(app.page.locator(".composer")).toHaveCount(0);
  await focusStage(app);
  await app.page.keyboard.press("n");
  await expect(on).toHaveText("删除");
  await app.page.keyboard.press("Escape");
  // Switch to another item: it starts from the default category in Settings
  await app.page.keyboard.press("Control+ArrowDown");
  await focusStage(app);
  await app.page.keyboard.press("n");
  await expect(on).toHaveText("修改");
});

test("copying records a time: the card shows a Copied tag and the copy doesn't count as an edit; copying the same batch again says it was copied before", async ({ app }) => {
  await app.open();
  const before = raw(app, HERO, "k3f9a2")!;
  expect(before.handed_off_at).toBeUndefined();
  await expect(card(app, "k3f9a2").locator(".card-handed")).toHaveCount(0);
  await focusStage(app);
  await app.page.keyboard.press("Control+Shift+a");
  await expect(toast(app)).toContainText("已复制");
  await expect(toast(app)).not.toContainText("复制过");
  await expect.poll(() => raw(app, HERO, "k3f9a2")?.handed_off_at).toBeTruthy();
  await expect.poll(() => raw(app, CLIP, "p0c7xe")?.handed_off_at).toBeTruthy();
  expect(raw(app, HERO, "k3f9a2")!.updated_at).toBe(before.updated_at);
  await expect(card(app, "k3f9a2").locator(".card-handed")).toHaveText(/^已复制 \d\d:\d\d$/);
  // Copying isn't an editing step: there is nothing to undo
  await app.page.locator(".menubar button", { hasText: "编辑" }).click();
  await expect(menuItem(app, /^撤销/)).toBeDisabled();
  await app.page.keyboard.press("Escape");
  await focusStage(app);
  await app.page.keyboard.press("Control+Shift+i");
  await expect(toast(app)).toContainText(/这些批注均已于 \d\d:\d\d 复制过/);
});

test("Help menu: Getting Started, Open Log Folder, Copy Diagnostic Info (without paths), Report an Issue (a new GitHub issue with the diagnostic info filled in)", async ({ app }) => {
  await app.open();
  const help = () => app.page.locator(".menubar button", { hasText: "帮助" }).click();
  await help();
  await menuItem(app, "入门").click();
  const intro = app.page.getByRole("dialog", { name: "入门" });
  await expect(intro).toContainText("添加文件");
  await app.page.keyboard.press("Escape");
  await expect(intro).toHaveCount(0);

  await help();
  await menuItem(app, "打开日志文件夹").click();
  expect(app.host.revealed.at(-1)).toBe("@logs");

  await help();
  await menuItem(app, "复制诊断信息").click();
  await expect(toast(app)).toContainText("已复制诊断信息");
  const text = (await app.clipboard())!;
  expect(text).toContain(`SnipToss ${VERSION}`);
  expect(text).toContain("OS: e2e (X64)");
  expect(text).not.toContain(app.temp);

  await help();
  await menuItem(app, "报告问题…").click();
  const url = new URL(app.host.opened.at(-1)!);
  expect(url.origin + url.pathname).toBe("https://github.com/Moy339339/SnipToss/issues/new");
  // The issue form (.github/ISSUE_TEMPLATE/bug_report.yml): the diagnostics field is prefilled by its id
  expect(url.searchParams.get("template")).toBe("bug_report.yml");
  expect(url.searchParams.get("diagnostics")).toContain("OS: e2e (X64)");
  expect(url.searchParams.get("diagnostics")).not.toContain(app.temp);
});

test("Settings: eight pages, the tray and start-at-login options on General, expert options on Advanced, and no more option to generate a snapshot for every note; the About page has the author, license and homepage", async ({
  app,
}) => {
  await app.open();
  await focusStage(app);
  await app.page.keyboard.press("Control+,");
  const tabs = app.page.locator(".settings-tab");
  await expect(tabs).toHaveText(["常规", "批注", "截图批注", "复制批注", "系统集成", "快捷键", "高级", "关于"]);
  const body = app.page.locator(".settings-body");
  await expect(body).toContainText("关闭窗口时保留在托盘");
  await expect(body).toContainText("登录 Windows 时启动");
  await tabs.filter({ hasText: "高级" }).click();
  for (const label of ["批注署名", "长按切换工具", "跳过的文件夹", "REVIEW.md 中包含已处理的批注", "截图尺寸", "恢复默认设置"])
    await expect(body.locator(".set-label", { hasText: label })).toHaveCount(1);
  await expect(body).not.toContainText("每条批注生成截图");
  await tabs.filter({ hasText: "关于" }).click();
  await expect(body).toContainText("MoyGoldenAge");
  await expect(body).toContainText("MIT 许可证");
  // The description of Third-party notices also contains the word License: identify this row by its label
  await body
    .locator(".set-row")
    .filter({ has: app.page.locator(".set-label", { hasText: /^许可证$/ }) })
    .getByRole("button", { name: "查看" })
    .click();
  expect(app.host.opened.at(-1)).toBe("https://github.com/Moy339339/SnipToss/blob/main/LICENSE");
});

test("narrow window (944 wide with both side panels open): undo, redo, Settings and Keyboard Shortcuts collapse into the ⋯ menu, and the buttons on the right aren't covered by the tool group", async ({ app }) => {
  await app.page.setViewportSize({ width: 944, height: 700 });
  await app.open();
  const header = app.page.locator(".stage-header");
  await expect(header.locator(".hdr-more")).toBeVisible();
  await expect(header.locator(".hdr-wide").first()).toBeHidden();
  // The center point of every button on the right hits the button itself (the ? button used to be covered by the tool group)
  for (const btn of await header.locator(".hdr-right button:visible").all()) {
    const hit = await btn.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    });
    expect(hit).toBe(true);
  }
  await header.locator(".hdr-more button").click();
  await menuItem(app, /^设置/).click();
  await expect(app.page.locator(".settings")).toBeVisible();
  // Wide window: the ⋯ menu doesn't appear and all the buttons are there
  await app.page.keyboard.press("Escape");
  await app.page.setViewportSize({ width: 1600, height: 900 });
  await expect(header.locator(".hdr-more")).toBeHidden();
  await expect(header.locator(".hdr-wide").first()).toBeVisible();
});

/** Opens clip.mp4 (3 seconds) and waits until it can seek */
async function openClip(app: App) {
  await app.page.locator(".lib-row", { hasText: "clip.mp4" }).click();
  await expect(app.page).toHaveTitle("clip.mp4");
  await expect.poll(() => app.page.evaluate(() => document.querySelector("video")?.readyState ?? 0)).toBeGreaterThanOrEqual(2);
}
/** Finds a note on clip.mp4 by its exact text and returns its time; undefined = not saved yet; null = saved without a time */
const timeOf = (app: App, body: string) => {
  const list = JSON.parse(readFileSync(join(app.project, ".sniptoss", "annotations", CLIP), "utf8")).annotations as {
    body: string;
    anchor: { time?: { start: number; end?: number } };
  }[];
  const a = list.find((x) => x.body === body);
  return a && (a.anchor.time ?? null);
};
const seek = (app: App, t: number) =>
  app.page.evaluate((seconds) => {
    document.querySelector("video")!.currentTime = seconds;
  }, t);

test("an overall comment on a video applies to the whole video by default, with no time; Set time adds the current moment and × removes it again", async ({ app }) => {
  await app.open();
  await openClip(app);
  await seek(app, 1);
  await focusStage(app);
  await app.page.keyboard.press("n");
  const composer = app.page.locator(".composer");
  await expect(composer.locator(".composer-title")).toHaveText("整体意见");
  await expect(composer.locator(".composer-time")).toContainText("整段视频");
  await expect(composer.locator(".time-chip")).toHaveCount(0);
  await app.page.locator(".composer-text").fill("整段的配乐换成轻快一些的");
  await app.page.keyboard.press("Control+Enter");
  await expect(composer).toHaveCount(0);
  await expect.poll(() => timeOf(app, "整段的配乐换成轻快一些的")).toBeNull();

  await focusStage(app);
  await app.page.keyboard.press("n");
  await composer.getByRole("button", { name: "指定时刻" }).click();
  await expect(composer.locator(".time-chip")).toHaveText("00:01.000");
  // Adding a time makes it a timestamped comment, and removing it with × makes it an overall comment again: the title follows
  await expect(composer.locator(".composer-title")).toHaveText("时间点意见");
  await composer.getByRole("button", { name: "改为整段视频" }).click();
  await expect(composer.locator(".composer-time")).toContainText("整段视频");
  await expect(composer.locator(".composer-title")).toHaveText("整体意见");
  await composer.getByRole("button", { name: "指定时刻" }).click();
  await app.page.locator(".composer-text").fill("这一刻的字幕有错字");
  await app.page.keyboard.press("Control+Enter");
  await expect.poll(() => timeOf(app, "这一刻的字幕有错字")).toEqual({ start: 1 });
});

test("a mark on a video at a single moment: while paused it is only drawn on its own frame; during playback it is lit for 1 second from that moment (it used to still be drawn when paused at 2 seconds)", async ({ app }) => {
  const file = join(app.project, ".sniptoss", "annotations", CLIP);
  const data = JSON.parse(readFileSync(file, "utf8"));
  data.annotations.push({
    id: "t1me00",
    status: "open",
    category: "change",
    body: "这一刻的标题偏左",
    anchor: { time: { start: 0.2 }, shape: { type: "point", x: 0.3, y: 0.3 } },
    author: "user",
    created_at: "2026-10-20T02:00:00Z",
    updated_at: "2026-10-20T02:00:00Z",
    replies: [],
  });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  await app.open();
  await openClip(app);
  const badge = app.page.locator('.annot-badge[data-id="t1me00"]');
  // Paused on that frame it is drawn; paused after 2.2 s it isn't (it used to linger for 3 seconds while paused)
  await seek(app, 0.2);
  await expect(badge).toHaveCount(1);
  await seek(app, 2.4);
  await expect(badge).toHaveCount(0);
  // Frame by frame (clip.mp4 is 15 fps): the next frame no longer draws it, and stepping back draws it again
  await seek(app, 0.2);
  await expect(badge).toHaveCount(1);
  await focusStage(app);
  await app.page.keyboard.press("ArrowRight");
  await expect(badge).toHaveCount(0);
  await app.page.keyboard.press("ArrowLeft");
  await expect(badge).toHaveCount(1);
  // Playback: lit while passing, not drawn after 1 second; pausing at that point doesn't draw it either (it isn't paused on its own frame)
  await app.page.keyboard.press("Space");
  await expect.poll(() => app.page.evaluate(() => document.querySelector("video")!.currentTime)).toBeGreaterThan(1.4);
  await expect(badge).toHaveCount(0);
  await app.page.keyboard.press("Space");
  await expect.poll(() => app.page.evaluate(() => document.querySelector("video")!.paused)).toBe(true);
  await expect(badge).toHaveCount(0);
  // Select it (click it in the notes panel): the video jumps back to that frame and it is drawn
  await card(app, "t1me00").click();
  await expect(badge).toHaveCount(1);
});

test("deleting hand-picked notes: after checking them, Delete at the bottom or the Delete key asks once and the deletion undoes in one step (cleanup doesn't depend on whether notes are resolved; the user picks by checking)", async ({ app }) => {
  await app.open();
  const ids = (file: string) => app.annotations(file).map((a) => a.id);
  await card(app, "k3f9a2").locator(".card-check").click();
  await card(app, "p0c7xe").locator(".card-check").click();
  await app.page.locator(".panel-batch").getByRole("button", { name: "删除" }).click();
  const dialog = app.page.getByRole("alertdialog");
  await expect(dialog).toContainText("删除勾选的 2 条批注？");
  await expect(dialog).toContainText("这 2 条批注（分属 2 份素材）将被删除。");
  await dialog.getByRole("button", { name: "删除" }).click();
  await expect(toast(app)).toContainText("已删除 2 条批注");
  await expect.poll(() => ids(HERO).includes("k3f9a2")).toBe(false);
  await expect.poll(() => ids(CLIP).includes("p0c7xe")).toBe(false);
  await expect(app.page.locator(".panel-batch")).toHaveCount(0); // The checks are cleared with them
  await focusStage(app);
  await app.page.keyboard.press("Control+z");
  await expect.poll(() => ids(HERO).includes("k3f9a2")).toBe(true);
  await expect.poll(() => ids(CLIP).includes("p0c7xe")).toBe(true);
  // The Delete key: with notes checked it deletes the checked ones, not the selected one
  await card(app, "k3f9a2").click();
  await card(app, "p0c7xe").locator(".card-check").click();
  await app.page.keyboard.press("Delete");
  await expect(dialog).toContainText("删除此批注？"); // Only one is checked: it asks about a single note
  await dialog.getByRole("button", { name: "删除" }).click();
  await expect.poll(() => ids(CLIP).includes("p0c7xe")).toBe(false);
  expect(ids(HERO)).toContain("k3f9a2");
});

test("after a note is written, .sniptoss contains a .gitignore that ignores only temporary files and locks, not the notes", async ({ app }) => {
  const ignore = join(app.project, ".sniptoss", ".gitignore");
  await app.open();
  await focusStage(app);
  await app.page.keyboard.press("n");
  await app.page.locator(".composer-text").fill("整体偏暗");
  await app.page.keyboard.press("Control+Enter");
  await expect.poll(() => app.annotations(HERO).some((a) => a.body === "整体偏暗")).toBe(true);
  const lines = readFileSync(ignore, "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"));
  expect(lines).toEqual(["*.tmp", "*.lock"]);
});

test("pasting an image with Ctrl+V: it is saved into the pasted-images folder as a project of its own in the library and opened right away; when the clipboard is empty a notice says so", async ({ app }) => {
  await app.open();
  await focusStage(app);
  await app.page.keyboard.press("Control+v");
  await expect(toast(app)).toContainText("剪贴板中没有图片或文件");
  app.host.clipboardImage = readFileSync(join(app.project, "assets", "hero.png"));
  await app.page.keyboard.press("Control+v");
  await expect(toast(app)).toContainText("已添加剪贴板中的图片，位于「粘贴的图片」");
  await expect(app.page).toHaveTitle("paste-001.png");
  await expect(app.page.locator(".lib-row.is-project", { hasText: "粘贴的图片" })).toHaveCount(1);
  // Paste another: one more image in the same project, without starting a new project
  await focusStage(app);
  await app.page.keyboard.press("Control+v");
  await expect(app.page).toHaveTitle("paste-002.png");
  await expect(app.page.locator(".lib-row.is-project", { hasText: "粘贴的图片" })).toHaveCount(1);
});

test("pasting files copied in File Explorer with Ctrl+V works like dropping them; File → Add from Clipboard does the same; Ctrl+V in the note box still pastes text as usual", async ({
  app,
}) => {
  const other = join(dirname(app.project), "其他", "cover.png");
  mkdirSync(dirname(other), { recursive: true });
  writeFileSync(other, readFileSync(join(app.project, "assets", "hero.png")));
  app.host.clipboardFiles = [other];
  await app.open();
  await app.page.locator(".menubar button", { hasText: "文件" }).click();
  await menuItem(app, /^从剪贴板添加/).click();
  await expect(app.page).toHaveTitle("cover.png");
  // While writing a note, Ctrl+V belongs to the text box
  await focusStage(app);
  await app.page.keyboard.press("n");
  const before = app.host.calls.filter((c) => c.method === "pasteClipboard").length;
  await app.page.locator(".composer-text").press("Control+v");
  await app.page.waitForTimeout(200);
  expect(app.host.calls.filter((c) => c.method === "pasteClipboard").length).toBe(before);
});

test("files that appear in a folder after it was added to the library are tagged New: a collapsed folder shows New N, opening a file clears its tag; right-click Mark All as Seen", async ({ app }) => {
  await app.open();
  const since = () => (app.host.prefs?.fresh as { since?: Record<string, number> } | undefined)?.since ?? {};
  await expect.poll(() => Object.keys(since()).length).toBe(1); // Counting starts now for this folder
  // Files that were already there don't count as new
  await expect(app.page.locator(".lib-new")).toHaveCount(0);
  const hero = readFileSync(join(app.project, "assets", "hero.png"));
  for (const n of ["new-a.png", "new-b.png"]) writeFileSync(join(app.project, "assets", n), hero);
  await focusStage(app);
  await app.page.keyboard.press("F5");
  await expect(app.page.locator('.lib-row[title$="new-a.png"] .lib-new')).toHaveText("新");
  await expect(app.page.locator('.lib-row[title$="new-b.png"] .lib-new')).toHaveText("新");
  // Collapse assets: the folder row shows the total
  await app.page.locator(".lib-row", { has: app.page.locator(".lib-name", { hasText: /^assets$/ }) }).dblclick();
  await expect(
    app.page.locator(".lib-row", { has: app.page.locator(".lib-name", { hasText: /^assets$/ }) }).locator(".lib-new"),
  ).toHaveText("新 2");
  await app.page.locator(".lib-row", { has: app.page.locator(".lib-name", { hasText: /^assets$/ }) }).dblclick();
  // Open new-a: its tag is gone
  await app.page.locator('.lib-row[title$="new-a.png"]').click();
  await expect(app.page).toHaveTitle("new-a.png");
  await expect(app.page.locator('.lib-row[title$="new-a.png"] .lib-new')).toHaveCount(0);
  await expect.poll(() => (app.host.prefs?.fresh as { seen?: string[] } | undefined)?.seen?.length).toBe(1);
  // Right-click the project and choose Mark All as Seen
  await app.page.locator(".lib-row.is-project").click({ button: "right" });
  await menuItem(app, /全部标为已看/).click();
  await expect(app.page.locator(".lib-new")).toHaveCount(0);
});

test("writing a note: Enter saves and Shift+Enter inserts a new line, as in Screen Capture", async ({ app }) => {
  await app.open();
  await focusStage(app);
  await app.page.keyboard.press("n");
  await expect(app.page.locator(".composer")).toContainText("Enter 保存 · Shift Enter 换行");
  const text = app.page.locator(".composer-text");
  await text.pressSequentially("第一行");
  await text.press("Shift+Enter");
  await text.pressSequentially("第二行");
  await expect(app.page.locator(".composer")).toBeVisible(); // Shift+Enter only inserts a new line
  await text.press("Enter");
  await expect(app.page.locator(".composer")).toHaveCount(0);
  await expect.poll(() => app.annotations(HERO).some((a) => a.body === "第一行\n第二行")).toBe(true);
  // Enter on an empty box: nothing is saved and the note box stays
  await focusStage(app);
  await app.page.keyboard.press("n");
  await text.press("Enter");
  await expect(app.page.locator(".composer")).toBeVisible();
});

/** Puts a file into the test project (its content doesn't matter, the scan only looks at the extension) */
const touch = (app: App, rel: string) => {
  const full = join(app.project, ...rel.split("/"));
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, "x");
  return full;
};
const row = (app: App, name: string) => app.page.locator(".lib-row", { hasText: name });

test("unsupported files and skipped folders inside a folder are explained by a gray line at the end; PDFs aren't listed even with the setting on", async ({ app }) => {
  touch(app, "assets/封面.psd");
  touch(app, "assets/图标.ai");
  touch(app, "brief.pdf");
  touch(app, "dist/out.png");
  app.host.prefs = { kinds: { image: true, video: true, pdf: true, slides: true } };
  await app.open();
  await expect(row(app, "hero.png")).toBeVisible();
  await expect(row(app, "brief.pdf")).toHaveCount(0);
  await expect(row(app, "out.png")).toHaveCount(0);
  const note = app.page.locator(".lib-note");
  await expect(note).toHaveCount(1);
  await expect(note).toContainText("另有 3 个文件暂不支持：ai、pdf、psd");
  await expect(note).toContainText("已跳过文件夹：dist");
  // Settings no longer has toggles for PDF and PPT
  await focusStage(app);
  await app.page.keyboard.press("Control+,");
  await app.page.locator(".settings-tab", { hasText: "高级" }).click();
  await expect(app.page.locator(".set-row", { hasText: "图片" })).toBeVisible();
  await expect(app.page.locator(".set-row", { hasText: "PDF" })).toHaveCount(0);
});

test("deep folders: the first three levels indent by 20 and deeper ones by 8; long names are shortened in the middle, keeping the end and the extension", async ({ app }) => {
  touch(app, "assets/a/b/c/d/deep.png");
  touch(app, "assets/banner_home_campaign_summer_v1.png");
  app.host.expanded = ["assets", "assets/a", "assets/a/b", "assets/a/b/c", "assets/a/b/c/d", "video"].map((p) =>
    join(app.project, ...p.split("/")),
  );
  await app.open();
  // assets is level 1, a is level 2, ..., deep.png is level 6: 4 + 3 × 20 + 3 × 8
  await expect(row(app, "deep.png")).toHaveCSS("padding-left", "88px");
  await expect(row(app, "assets")).toHaveCSS("padding-left", "24px");
  // When it doesn't fit, the middle is elided: the beginning stays, and the last 6 characters + the extension are kept; the full name is in the hover tip (the row's title)
  const long = app.page.locator('.lib-row[title$="banner_home_campaign_summer_v1.png"] .lib-name');
  await expect(long).toHaveText(/^banner_.+…mer_v1\.png$/);
  // It is cut by measuring so it fits exactly, instead of leaving the elision to CSS
  expect(await long.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test("projects with the same name: the subtitle goes down to the level that tells them apart and isn't elided from the start", async ({ app }) => {
  const a = join(dirname(app.project), "clientA", "v1", "renders");
  const b = join(dirname(app.project), "clientB", "v1", "renders");
  for (const d of [a, b]) {
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "shot.png"), "x");
  }
  app.host.entries.push({ path: a, pinned: false }, { path: b, pinned: false });
  await app.open();
  const projects = app.page.locator(".lib-row.is-project", { hasText: "renders" });
  await expect(projects).toHaveCount(2);
  await expect(projects.locator(".lib-sub")).toHaveText(["clientA\\v1", "clientB\\v1"], { useInnerText: true });
});

test("showing only items with open notes: the funnel to the right of the search box and the same entry in the View menu; Ctrl+↓ also steps only through these", async ({ app }) => {
  await app.open();
  await expect(row(app, "poster.jpg")).toBeVisible();
  const filter = app.page.locator(".sidebar .search-filter");
  await filter.click();
  await expect(filter).toHaveAttribute("aria-pressed", "true");
  await expect(row(app, "poster.jpg")).toHaveCount(0);
  await expect(row(app, "hero.png")).toBeVisible();
  await expect(row(app, "clip.mp4")).toBeVisible();
  await expect.poll(() => app.host.prefs?.libraryPending).toBe(true);
  // Next Item skips poster.jpg (it has no notes and is not visible in the list)
  await row(app, "hero.png").click();
  await focusStage(app);
  await app.page.keyboard.press("Control+ArrowDown");
  await expect(app.page).toHaveTitle("clip.mp4");
  // It is checked in the menu, and clicking it restores everything
  await app.page.locator(".menubar button", { hasText: "视图" }).click();
  const item = app.page.getByRole("menuitemcheckbox", { name: /仅显示有待处理批注的素材/ });
  await expect(item).toHaveAttribute("aria-checked", "true");
  await item.click();
  await expect(row(app, "poster.jpg")).toBeVisible();
});

test("showing only items with open notes when there are none: it explains and offers Show All", async ({ app }) => {
  app.host.prefs = { libraryPending: true };
  for (const f of ["assets__hero.png.json", "video__clip.mp4.json"]) {
    const p = join(app.project, ".sniptoss", "annotations", f);
    const data = JSON.parse(readFileSync(p, "utf8"));
    for (const a of data.annotations) a.status = "resolved";
    writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`);
  }
  // app.open() waits for the first row of the library, and here there should be no rows at all
  await app.page.goto("https://app.sniptoss.example/index.html");
  const empty = app.page.locator(".lib-list .list-empty");
  await expect(empty).toContainText("没有含待处理批注的素材");
  await empty.getByRole("button", { name: "显示全部" }).click();
  await expect(row(app, "poster.jpg")).toBeVisible();
});
