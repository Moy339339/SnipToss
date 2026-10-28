// The library list: adding, removing, and startup selection.
// The shell side (merging in Library.Add, Covers, Tidy) is tested in tests/AppTests/LibraryTests.cs;
// here we test that the UI displays the results correctly.

import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./harness";

const fileRows = (app: { page: import("@playwright/test").Page }, name: string) =>
  app.page.locator(".lib-row", { has: app.page.locator(".lib-name", { hasText: new RegExp(`^${name.replace(".", "\\.")}$`) }) });

test("Adding a subfolder and then its parent folder yields a single project, and the same item is listed only once", async ({ app }) => {
  app.host.entries = [{ path: join(app.project, "assets"), pinned: false }];
  app.host.expanded = [join(app.project, "assets"), join(app.project, "video")];
  await app.open();
  app.host.nextPickFolder = app.project;
  await app.page.keyboard.press("Control+Shift+O");
  await expect(fileRows(app, "clip.mp4")).toHaveCount(1); // the parent folder has been scanned in
  await expect(app.page.locator(".lib-row.is-project")).toHaveCount(1);
  await expect(fileRows(app, "hero.png")).toHaveCount(1);
  expect(app.host.entries.map((e) => e.path)).toEqual([app.project]);
});

test("An image the scan skipped (inside dist) that is added shows up in the list and opens, and the app does not claim it is already in the list", async ({ app }) => {
  mkdirSync(join(app.project, "dist"));
  const built = join(app.project, "dist", "out.png");
  copyFileSync(join(app.project, "assets", "hero.png"), built);
  await app.open();
  await expect(app.page).toHaveTitle("hero.png");
  app.host.nextPickFiles = [built];
  await app.page.keyboard.press("Control+O");
  await expect(app.page).toHaveTitle("out.png");
  await expect(fileRows(app, "out.png")).toHaveCount(1);
  await expect(app.page.locator(".lib-row.is-project")).toHaveCount(1); // it sits together with the project's other items
  await expect(app.page.getByText("该项已在列表中")).toHaveCount(0);
});

test("Adding an image the folder scan already finds does not duplicate it; it is selected and the toast explains", async ({ app }) => {
  await app.open();
  await expect(app.page).toHaveTitle("hero.png");
  app.host.nextPickFiles = [join(app.project, "video", "clip.mp4")];
  await app.page.keyboard.press("Control+O");
  await expect(app.page).toHaveTitle("clip.mp4");
  await expect(app.page.locator(".toast")).toContainText("该项已在列表中，已定位到它");
  await expect(fileRows(app, "clip.mp4")).toHaveCount(1);
});

test("A snapshot from the notes folder that is added is not treated as an item, and the toast gives the reason", async ({ app }) => {
  mkdirSync(join(app.project, ".sniptoss", "snapshots"), { recursive: true });
  const shot = join(app.project, ".sniptoss", "snapshots", "a.png");
  copyFileSync(join(app.project, "assets", "hero.png"), shot);
  await app.open();
  app.host.nextPickFiles = [shot];
  await app.page.keyboard.press("Control+O");
  await expect(app.page.locator(".toast")).toContainText("批注数据");
  expect(app.host.entries).toHaveLength(1);
});

test("When a folder has more items than the limit, the project row says how many were listed (the excess must not silently disappear)", async ({ app }) => {
  app.host.scanLimit = 2;
  await app.open();
  await expect(app.page.locator(".lib-row.is-project")).toContainText("仅列出前 2 个");
});

test("Pressing ↑ ↓ repeatedly in the list records the last viewed item in a coalesced way instead of writing the settings file on every switch", async ({ app }) => {
  app.host.expanded = [join(app.project, "assets")];
  await app.open();
  await app.page.locator(".lib-row", { hasText: "hero.png" }).click();
  await expect(app.page).toHaveTitle("hero.png");
  await new Promise((r) => setTimeout(r, 400)); // the write from startup has finished
  const count = () => app.host.calls.filter((c) => c.method === "librarySelect").length;
  const before = count();
  for (let i = 0; i < 4; i++) for (const key of ["ArrowDown", "ArrowUp"]) await app.page.keyboard.press(key); // 8 switches
  await app.page.keyboard.press("ArrowDown");
  await expect(app.page).toHaveTitle("poster.jpg");
  await expect.poll(() => app.host.selected).toBe(join(app.project, "assets", "poster.jpg"));
  expect(count() - before).toBeLessThanOrEqual(3);
});

test("Double-clicking a collapsed folder expands it (the first click must not expand it and the second collapse it again)", async ({ app }) => {
  await app.open();
  const video = app.page.locator(".lib-row", { has: app.page.locator(".lib-name", { hasText: /^video$/ }) });
  await expect(video).toHaveAttribute("aria-expanded", "false");
  await video.dblclick();
  await expect(video).toHaveAttribute("aria-expanded", "true");
  await expect(fileRows(app, "clip.mp4")).toHaveCount(1);
  await video.dblclick();
  await expect(video).toHaveAttribute("aria-expanded", "false");
});

test("Right-clicking a multi-selection of items shows a menu without two separators in a row", async ({ app }) => {
  app.host.expanded = [join(app.project, "assets")];
  await app.open();
  await fileRows(app, "hero.png").click();
  await fileRows(app, "poster.jpg").click({ modifiers: ["Control"] });
  await fileRows(app, "poster.jpg").click({ button: "right" });
  const menu = app.page.getByRole("menu");
  await expect(menu).toBeVisible();
  const classes = await menu.evaluate((m) => [...m.children].map((c) => c.className));
  expect(classes.some((c, i) => c.includes("menu-sep") && classes[i + 1]?.includes("menu-sep"))).toBe(false);
  expect(classes[0]).not.toContain("menu-sep");
  expect(classes.at(-1)).not.toContain("menu-sep");
});

test("Clear Library works per project: files added later inside a pinned project are kept too", async ({ app }) => {
  const other = join(app.temp, "别处");
  mkdirSync(other);
  copyFileSync(join(app.project, "assets", "hero.png"), join(other, "x.png"));
  // A pinned project (the project folder itself is one entry), a file added into it separately later
  // (inside dist, which the scan skips; not pinned), and another unpinned project
  mkdirSync(join(app.project, "dist"));
  copyFileSync(join(app.project, "assets", "hero.png"), join(app.project, "dist", "out.png"));
  app.host.entries = [
    { path: app.project, pinned: true },
    { path: join(app.project, "dist", "out.png"), pinned: false },
    { path: join(other, "x.png"), pinned: false },
  ];
  await app.open();
  await app.page.locator(".lib-list").click({ button: "right", position: { x: 20, y: 400 } });
  await app.page.getByRole("menuitem", { name: /清空列表/ }).click();
  await expect(app.page.getByRole("alertdialog")).toContainText("将移除 1 个项目，保留 1 个置顶项目");
  await app.page.getByRole("alertdialog").getByRole("button", { name: "清空", exact: true }).click();
  await expect.poll(() => app.host.entries.map((e) => e.path)).toEqual([app.project, join(app.project, "dist", "out.png")]);
});

test("An item selected while filtering stays selected in the tree after the filter is cleared (a collapsed folder expands), and the filter also matches the project name", async ({ app }) => {
  await app.open();
  const search = app.page.getByPlaceholder("筛选素材");
  await search.fill("project/video");
  await fileRows(app, "clip.mp4").click();
  await expect(app.page).toHaveTitle("clip.mp4");
  await app.page.getByTitle("清除", { exact: true }).click();
  await expect(fileRows(app, "clip.mp4")).toHaveAttribute("aria-selected", "true");
});

test("For a project without notes yet, Open Notes Folder in the context menu is grayed out (it must not be clickable and fail with a raw \"not found\" error)", async ({ app }) => {
  const other = join(app.temp, "新项目");
  mkdirSync(other);
  copyFileSync(join(app.project, "assets", "hero.png"), join(other, "x.png"));
  app.host.entries.push({ path: other, pinned: false });
  await app.open();
  await app.page.locator(".lib-row.is-project", { hasText: "新项目" }).click({ button: "right" });
  await expect(app.page.getByRole("menuitem", { name: "打开批注文件夹（.sniptoss）" })).toBeDisabled();
  await app.page.keyboard.press("Escape");
  await app.page.locator(".lib-row.is-project", { hasText: "project" }).click({ button: "right" });
  await expect(app.page.getByRole("menuitem", { name: "打开批注文件夹（.sniptoss）" })).toBeEnabled();
});

test("Items passed from the command line or context menu that could not be added (queued by the shell) are reported once the UI has loaded", async ({ app }) => {
  app.host.pendingSkipped = ["找不到：E:\\没有这个.png"];
  await app.open();
  await expect(app.page.locator(".toast")).toContainText("找不到：E:\\没有这个.png");
});

test("Dropped content that is not on this computer (the shell gets no path) gets a toast instead of no reaction at all", async ({ app }) => {
  await app.open();
  await app.page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["x"], "网页里的图.png", { type: "image/png" }));
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await expect(app.page.locator(".toast")).toContainText("不是本机文件");
});

test("When the last viewed item is no longer in the list, startup opens the first item in the list instead of an empty canvas", async ({ app }) => {
  app.host.selected = join(app.temp, "早就移出去了.png");
  await app.open();
  await expect(app.page).toHaveTitle("hero.png");
});

/** n images of 1×1 pixels in one folder (for large lists) */
function manyImages(dir: string, n: number) {
  mkdirSync(dir, { recursive: true });
  const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
  for (let i = 0; i < n; i++) writeFileSync(join(dir, `img-${String(i).padStart(4, "0")}.png`), pixel);
}

test("A large list renders only the visible rows (virtual scrolling, performance budget): End and Home jump to the ends and scroll there", async ({ app }) => {
  const big = join(app.temp, "big");
  manyImages(big, 2000);
  app.host.entries = [{ path: big, pinned: false }];
  await app.open();
  expect(await app.page.locator(".lib-row").count()).toBeLessThan(200); // not 2000 rows
  await fileRows(app, "img-0000.png").click();
  await app.page.keyboard.press("End");
  await expect(fileRows(app, "img-1999.png")).toBeInViewport();
  await expect(fileRows(app, "img-1999.png")).toHaveClass(/is-selected/);
  await expect(app.page).toHaveTitle("img-1999.png");
  await app.page.keyboard.press("Home");
  await expect(app.page.locator(".lib-row.is-project")).toBeInViewport();
  await app.page.keyboard.press("ArrowDown");
  await expect(app.page).toHaveTitle("img-0000.png");
});

test("Dragging a marquee to the bottom edge of a large list scrolls it down automatically, and rows scrolled out of the viewport (not in the DOM) still count as selected", async ({ app }) => {
  // The list scrolls a step per frame: on a machine without a GPU (CI runners draw a few frames a second) three screens take well over ten seconds
  test.setTimeout(90_000);
  const big = join(app.temp, "big");
  manyImages(big, 2000);
  app.host.entries = [{ path: big, pinned: false }];
  await app.open();
  const list = (await app.page.locator(".lib-list").boundingBox())!;
  const first = (await fileRows(app, "img-0000.png").boundingBox())!;
  await app.page.mouse.move(first.x + 40, first.y + first.height / 2);
  await app.page.mouse.down();
  await app.page.mouse.move(first.x + 40, list.y + list.height - 4, { steps: 5 });
  // Hold at the bottom edge until it has scrolled three screens before releasing
  // (a fixed wait is not enough when frames render slowly; same as the marquee test in library-panel.spec.ts)
  const lib = app.page.locator(".lib-list");
  await expect.poll(() => lib.evaluate((el) => el.scrollTop), { timeout: 45_000 }).toBeGreaterThan(3 * list.height);
  await app.page.mouse.up();
  // The selected count is in the tooltip of the Selected scope at the top of the notes panel
  const picked = app.page.locator(".scope-switch .seg.is-on");
  await expect(picked).toHaveAttribute("title", /素材栏中选中的 \d+ 个素材/);
  const n = Number(/素材栏中选中的 (\d+) 个素材/.exec((await picked.getAttribute("title"))!)![1]);
  const inDom = await app.page.locator(".lib-row.is-selected").count();
  expect(n).toBeGreaterThan(inDom); // more are selected than rendered: rows scrolled out count too
});

test("Dragging a file from File Explorer into the window shows the \"Drop to add to the list\" hint while dragging, and releasing adds it to the list and selects it", async ({ app }) => {
  const other = join(app.temp, "拖进来的");
  mkdirSync(other);
  const file = join(other, "dropped.png");
  copyFileSync(join(app.project, "assets", "hero.png"), file);
  app.host.nextDrop = [file];
  await app.open();
  // The browser cannot get the path of a dropped file: build a same-named File in the page and put it in a DataTransfer,
  // which simulates the shell matching it by name against nextDrop
  const dt = await app.page.evaluateHandle(() => {
    const d = new DataTransfer();
    d.items.add(new File(["x"], "dropped.png", { type: "image/png" }));
    (window as unknown as { __e2eOnDisk: string[] }).__e2eOnDisk = ["dropped.png"]; // treat it as on disk (harness.ts's fake WebView2 only accepts those)
    return d;
  });
  await app.page.dispatchEvent(".stage", "dragenter", { dataTransfer: dt });
  await app.page.dispatchEvent(".stage", "dragover", { dataTransfer: dt });
  await expect(app.page.locator(".drop-overlay")).toContainText("松开以添加到列表");
  await app.page.dispatchEvent(".stage", "drop", { dataTransfer: dt });
  await expect(app.page.locator(".drop-overlay")).toHaveCount(0);
  await expect(app.page.locator(".lib-row", { hasText: "dropped.png" })).toBeVisible();
  await expect(app.page).toHaveTitle("dropped.png");
  expect(app.host.entries.map((e) => e.path)).toContain(file);
});

test("Ctrl+P finds items: a collapsed library expands first and the cursor goes to the filter box; Enter opens the first match; Esc first clears the keyword and then leaves; the menu has it too", async ({ app }) => {
  await app.open();
  const search = app.page.getByPlaceholder("筛选素材");
  await app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await app.page.keyboard.press("Control+b");
  await expect(app.page.locator(".layout")).toHaveClass(/left-collapsed/);
  await app.page.keyboard.press("Control+p");
  await expect(app.page.locator(".layout")).not.toHaveClass(/left-collapsed/);
  await expect(search).toBeFocused();
  await app.page.keyboard.type("poster");
  await app.page.keyboard.press("Enter");
  await expect(app.page).toHaveTitle("poster.jpg");
  await expect(search).not.toBeFocused();
  // Press again: the previous text is selected, Esc first clears it (the cursor stays), and another Esc leaves
  await app.page.keyboard.press("Control+p");
  await expect(search).toBeFocused();
  expect(await search.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, "poster".length]);
  await app.page.keyboard.press("Escape");
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  await app.page.keyboard.press("Escape");
  await expect(search).not.toBeFocused();
  // ↓ moves into the list, starting from the first row
  await app.page.keyboard.press("Control+p");
  await app.page.keyboard.type("clip");
  await app.page.keyboard.press("ArrowDown");
  await expect(app.page).toHaveTitle("clip.mp4");
  await expect(app.page.locator(".lib-list")).toBeFocused();
  // The File → Find Items… menu item
  await app.page.getByRole("menuitem", { name: "文件" }).click();
  await app.page.getByRole("menuitem", { name: /查找素材/ }).click();
  await expect(search).toBeFocused();
});
