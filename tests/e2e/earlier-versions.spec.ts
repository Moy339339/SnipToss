// Notes written on an item that was later overwritten in place, and separate numbering for overall comments (docs/adr/0008-earlier-versions.md):
// notes on an earlier version are not drawn on the new canvas, they get a section of their own in the notes panel,
// and selecting one shows the snapshot from back then; the text copied for AI and REVIEW.md say to go by the snapshot;
// new notes record which version they were written on.
// Overall comments get a section of their own, are numbered from 1 by themselves, and their number does not look like a pin's

import { copyFileSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { expect, test, type App } from "./harness";

const HERO_NOTES = "assets__hero.png.json";
const heroPath = (app: App) => join(app.project, "assets", "hero.png");
const card = (app: App, id: string) => app.page.locator(`.card[data-annot$="|${id}"]`);
const focusStage = (app: App) => app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
type Note = { id: string; body: string; material_sha256?: string; snapshot?: string };
const notes = (app: App): Note[] => JSON.parse(readFileSync(join(app.project, ".sniptoss", "annotations", HERO_NOTES), "utf8")).annotations;

/**
 * Replaces hero.png with a different version (a few extra bytes after the end of the PNG: the picture is the same but the file is not);
 * its modified time is now
 */
const overwriteHero = (app: App) => writeFileSync(heroPath(app), Buffer.concat([readFileSync(heroPath(app)), Buffer.from("v2")]));

/** Gives k3f9a2 a snapshot "from back then" (the fixture has none for it) */
function giveSnapshot(app: App) {
  const file = join(app.project, ".sniptoss", "annotations", HERO_NOTES);
  const json = JSON.parse(readFileSync(file, "utf8"));
  json.annotations.find((a: Note) => a.id === "k3f9a2").snapshot = "snapshots/k3f9a2.png";
  writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
  mkdirSync(join(app.project, ".sniptoss", "snapshots"), { recursive: true });
  copyFileSync(heroPath(app), join(app.project, ".sniptoss", "snapshots", "k3f9a2.png"));
}

test.beforeEach(({ app }) => {
  app.host.expanded = [join(app.project, "assets"), join(app.project, "video")];
  app.host.prefs = { panelScope: "material" };
});

test("When an item is overwritten, old notes are not drawn on the canvas and move to the \"Notes on an earlier version\" section with a gray number; selecting one shows the snapshot from back then, and Esc or the button returns (ADR-0008)", async ({ app }) => {
  giveSnapshot(app);
  overwriteHero(app);
  await app.open();
  const k = card(app, "k3f9a2");
  await expect(k).toBeVisible();
  await expect(app.page.locator(".note-section.is-earlier .note-section-title")).toHaveText("旧版本上的批注");
  await expect(app.page.locator(".note-section-hint")).toContainText("画面上不再标出它们");
  await expect(k.locator(".card-num")).toHaveClass(/is-plain/);
  await expect(k.locator(".card-num")).toHaveText("1");
  await expect(app.page.locator('.annot-badge[data-id="k3f9a2"]')).toHaveCount(0);
  await expect(app.page.locator('.annot-shape[data-id="k3f9a2"]')).toHaveCount(0);
  // The yellow banner with its OK button is gone
  await expect(app.page.locator(".stale-hint")).toHaveCount(0);

  await k.click();
  const shot = app.page.locator(".earlier-shot");
  await expect(shot).toBeVisible();
  await expect(shot.locator(".earlier-title")).toHaveText("写这条批注时的画面");
  await expect(shot.locator(".earlier-img")).toHaveAttribute("src", /snapshots\/k3f9a2\.png$/);
  await expect.poll(() => shot.locator(".earlier-img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await app.page.keyboard.press("Escape");
  await expect(shot).toHaveCount(0);
  await k.click();
  await shot.getByRole("button", { name: "返回当前画面" }).click();
  await expect(shot).toHaveCount(0);
  await expect(k).not.toHaveClass(/is-selected/);
});

test("When an item is overwritten, Copy as Text gets a section of its own that says to go by the snapshot, REVIEW.md notes it on that line, and Copy as Images draws no number circle and names the file \"earlier version\"", async ({ app }) => {
  overwriteHero(app);
  await app.open();
  await expect(app.page.locator(".note-section.is-earlier")).toBeVisible();
  await focusStage(app);
  await app.page.keyboard.press("Control+Shift+a");
  const text = (await app.clipboard())!;
  expect(text).toContain("### 写在旧版本上的批注（这个文件在写下它们之后被替换过：位置对应当时的画面，请以截图为准）\n\n1. 修改 · 区域");
  await expect.poll(() => app.review()).toContain("（写在旧版本上，位置以截图为准）");

  await app.page.keyboard.press("Control+Shift+i");
  await expect.poll(() => app.host.copiedImages.length).toBe(1);
  const [item] = app.host.copiedImages[0];
  expect(item.number).toBe(0);
  expect(item.name).toBe("hero.png 旧版本 第1条");
  expect(item.where).toContain("（写在旧版本上，位置以截图为准）");
});

test("When an item is overwritten while the app is open, marks leave the canvas and the notes move to the earlier-version section; notes drawn afterwards are numbered from 1 and record the new fingerprint", async ({ app }) => {
  await app.open();
  await expect(app.page.locator('.annot-badge[data-id="k3f9a2"]')).toBeVisible();
  await expect(app.page.locator(".note-section.is-earlier")).toHaveCount(0);
  overwriteHero(app);
  await expect(app.page.locator('.annot-badge[data-id="k3f9a2"]')).toHaveCount(0);
  await expect(app.page.locator(".note-section.is-earlier")).toBeVisible();

  await focusStage(app);
  await app.page.keyboard.press("c");
  const box = await app.media();
  await app.page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.6);
  await app.page.locator(".composer-text").fill("新版上的意见");
  await app.page.locator(".composer-text").press("Enter");
  await expect.poll(() => notes(app).find((a) => a.body === "新版上的意见")?.material_sha256).toBe(sha(heroPath(app)));
  const fresh = notes(app).find((a) => a.body === "新版上的意见")!;
  await expect(app.page.locator(`.annot-badge[data-id="${fresh.id}"]`)).toHaveText("1");
  await expect(card(app, fresh.id).locator(".card-num")).not.toHaveClass(/is-plain/);
  // The old note stays in the earlier-version section, below the new one
  const order = await app.page.locator(".panel-body .card").evaluateAll((els) => els.map((e) => e.getAttribute("data-annot")!.split("|").pop()));
  expect(order.indexOf(fresh.id)).toBeLessThan(order.indexOf("k3f9a2"));
});

test("An item whose modified time changed but whose content did not (for example touched by git checkout) is drawn on the canvas as usual and does not count as an earlier version", async ({ app }) => {
  const later = new Date(Date.now() + 60_000);
  utimesSync(heroPath(app), later, later);
  await app.open();
  await expect(app.page.locator('.annot-badge[data-id="k3f9a2"]')).toBeVisible();
  await expect(app.page.locator(".note-section.is-earlier")).toHaveCount(0);
  await expect(card(app, "k3f9a2").locator(".card-num")).not.toHaveClass(/is-plain/);
});

test("Overall comments get their own \"Overall comment\" section, are numbered from 1 by themselves with a gray square number; canvas numbers are unchanged; Copy as Text splits sections and Copy as Images draws no number circle", async ({ app }) => {
  await app.open();
  await focusStage(app);
  await app.page.keyboard.press("n");
  await app.page.locator(".composer-text").fill("这张图饱和度有点高");
  await app.page.locator(".composer-text").press("Enter");
  await expect.poll(() => notes(app).some((a) => a.body === "这张图饱和度有点高")).toBe(true);
  const whole = notes(app).find((a) => a.body === "这张图饱和度有点高")!;

  await expect(app.page.locator(".note-section.is-overall .note-section-title")).toHaveText("整体意见");
  // The fixture already has an overall comment (done01, done and not listed right now): numbering counts resolved notes
  // and does not jump with the show-resolved switch, so this one is 2
  const w = card(app, whole.id);
  await expect(w.locator(".card-num")).toHaveText("2");
  await expect(w.locator(".card-num")).toHaveClass(/is-plain/);
  // The section title already says "Overall comment", so the card does not repeat it
  await expect(w.locator(".tag", { hasText: "整体意见" })).toHaveCount(0);
  const k = card(app, "k3f9a2");
  await expect(k.locator(".card-num")).toHaveText("1");
  await expect(k.locator(".card-num")).not.toHaveClass(/is-plain/);
  await expect(app.page.locator('.annot-badge[data-id="k3f9a2"]')).toHaveText("1");
  // Order: canvas notes → overall comments
  const order = await app.page.locator(".panel-body .card").evaluateAll((els) => els.map((e) => e.getAttribute("data-annot")!.split("|").pop()));
  expect(order.indexOf("k3f9a2")).toBeLessThan(order.indexOf(whole.id));

  await focusStage(app);
  await app.page.keyboard.press("Control+Shift+a");
  const text = (await app.clipboard())!;
  expect(text).toContain("1. 修改 · 区域");
  expect(text).toContain("### 整体意见（针对整个文件，不指定位置）\n\n2. 修改\n这张图饱和度有点高");

  await app.page.keyboard.press("Control+Shift+i");
  await expect.poll(() => app.host.copiedImages.length).toBe(1);
  const items = app.host.copiedImages[0];
  expect(items.map((i) => [i.number, i.name])).toEqual([
    [1, "hero.png 第1条"],
    [0, "hero.png 整体意见 2"],
  ]);
});

test("Project scope: each item has its own sections; the whole-folder comment group has no sections and uses gray numbers", async ({ app }) => {
  app.host.prefs = { panelScope: "project", panelResolved: true };
  await app.open();
  await expect(card(app, "done01")).toBeVisible();
  // done01 is an overall comment on hero.png (done): it sits in the Overall comment section of the hero.png group
  const heroGroup = app.page.locator(".annot-group", { has: card(app, "done01") });
  await expect(heroGroup.locator(".note-section.is-overall")).toHaveCount(1);
  await expect(card(app, "done01").locator(".card-num")).toHaveClass(/is-plain/);
  // Write a whole-folder comment
  await focusStage(app);
  await app.page.keyboard.press("Shift+n");
  await app.page.locator(".composer-text").fill("这一批都提亮");
  await app.page.locator(".composer-text").press("Enter");
  const folderCard = app.page.locator(".card", { hasText: "这一批都提亮" });
  await expect(folderCard).toBeVisible();
  await expect(folderCard.locator(".card-num")).toHaveClass(/is-plain/);
  const folderGroup = app.page.locator(".annot-group", { has: folderCard });
  await expect(folderGroup.locator(".note-section")).toHaveCount(0);
});
