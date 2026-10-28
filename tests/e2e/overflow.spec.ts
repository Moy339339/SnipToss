// Text overflow check (docs/adr/0001-i18n.md item 12): for every language that has messages, shrink the window to its minimum (960 × 600),
// open every screen of the UI (screens.ts) and the welcome page with an empty library, and look for text that is cut off or pushes out of its box:
// content wider than its box (scrollWidth > clientWidth) that is not truncated on purpose (ellipsis via text-overflow: ellipsis, or scrollable).
// Long languages such as German and Russian are the most likely to fail; Chinese and English run here too

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, ROOT, test, type App } from "./harness";
import { prepare, walkScreens, welcome } from "./screens";

const LOCALES = readdirSync(join(ROOT, "i18n", "locales"))
  .filter((n) => n.endsWith(".json"))
  .map((n) => n.replace(/\.json$/, ""));

/** The overflowing text on this screen: only the innermost element is reported (outer boxes that widen along with it are not reported again) */
function overflowing(app: App, where: string) {
  return app.page.evaluate((screen) => {
    const found: HTMLElement[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      if (el.closest("[aria-hidden='true'], .tooltip, svg, video, img, canvas, textarea, input")) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || el.clientWidth === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.textOverflow === "ellipsis" || ["auto", "scroll"].includes(cs.overflowX)) continue;
      if (!el.innerText?.trim()) continue;
      // The play bar deliberately extends 8 px to each side (design-rules S5), so the video block's scrollWidth is always 8 px wider; the play bar itself is still checked
      if (el.classList.contains("video-player")) continue;
      // The canvas area (the item and the mark layer above it, clipped by design when zoomed in): numbers and readouts are placed in item coordinates and scale with the canvas,
      // so sticking out is normal (not truncated text); the zoom bar overlaid on the canvas is still checked
      if (el.closest(".zoom-view") && !el.closest(".zoom-control")) continue;
      // The confirm dialog's title row: the × extends 8 px to the right by design (.confirm-close); the title text itself (.confirm-title) is still checked
      if (el.classList.contains("confirm-head")) continue;
      if (el.scrollWidth > el.clientWidth + 1) found.push(el);
    }
    return found
      .filter((el) => !found.some((other) => other !== el && el.contains(other)))
      .map((el) => `${screen}: <${el.tagName.toLowerCase()} class="${el.className}">“${el.innerText.trim().replace(/\s+/g, " ").slice(0, 50)}” width ${el.scrollWidth} > box ${el.clientWidth}`);
  }, where);
}

test("the detection itself works: a long unwrapped label in a narrow box is reported, one with an ellipsis is not", async ({ app }) => {
  await app.open();
  await app.page.evaluate(() => {
    const add = (style: string) => {
      const d = document.createElement("div");
      d.setAttribute("style", `position:fixed;left:0;top:0;width:40px;white-space:nowrap;${style}`);
      d.textContent = "A very long label that does not fit";
      document.body.append(d);
    };
    add("");
    add("overflow:hidden;text-overflow:ellipsis");
  });
  const found = await overflowing(app, "自检");
  expect(found).toHaveLength(1);
  expect(found[0]).toContain("A very long label");
});

for (const locale of LOCALES) {
  test(`${locale}: at the minimum window size, no text on any UI screen (screens.ts: main UI, menus, context menus, note box, confirm dialogs, Settings pages, Keyboard Shortcuts, onboarding tour and hints) overflows its box`, async ({ app }) => {
    prepare(app, locale);
    await app.page.setViewportSize({ width: 960, height: 600 });
    await app.open();
    await expect(app.page.locator("html")).toHaveAttribute("lang", locale);
    const problems: string[] = [];
    await walkScreens(app, async (screen) => void problems.push(...(await overflowing(app, screen))));
    expect(problems, problems.join("\n")).toEqual([]);
  });

  test(`${locale}: at the minimum window size, the welcome page with an empty library doesn't overflow its box`, async ({ app }) => {
    prepare(app, locale);
    await app.page.setViewportSize({ width: 960, height: 600 });
    const problems: string[] = [];
    await welcome(app, async (screen) => void problems.push(...(await overflowing(app, screen))));
    expect(problems, problems.join("\n")).toEqual([]);
  });
}
