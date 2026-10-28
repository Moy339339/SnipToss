// Full-UI screenshots in every language plus pseudo-localization: for each of them, at the minimum window size (960 × 600, where truncation and wrapping
// show up most easily), one screenshot of every screen of the UI (screens.ts) and of the welcome page, to be reviewed one by one by a person:
// untranslated text, tofu glyphs, wrong fonts, important text cut off by ellipses, odd wrapping - automated checks cannot find these.
// Not run normally; to take them: $env:SNIPTOSS_I18N_SHOTS = '<folder>'; npx playwright test tests/e2e/i18n-shots.spec.ts
// Output goes to <folder>/<locale>/<number> <screen name>.png

import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, ROOT, test, type App } from "./harness";
import { prepare, usePseudo, walkScreens, welcome } from "./screens";

const OUT = process.env.SNIPTOSS_I18N_SHOTS;
const LOCALES = [
  ...readdirSync(join(ROOT, "i18n", "locales"))
    .filter((n) => n.endsWith(".json"))
    .map((n) => n.replace(/\.json$/, "")),
  "pseudo",
];

test.skip(!OUT, "Only takes screenshots when SNIPTOSS_I18N_SHOTS is set");

const shooter = (app: App, dir: string) => {
  let n = 0;
  return async (screen: string) => {
    await app.page.waitForTimeout(150); // wait for the appearing animation to finish
    await app.page.screenshot({ path: join(dir, `${String(++n).padStart(2, "0")} ${screen}.png`) });
  };
};

for (const locale of LOCALES) {
  test(`${locale}: full-UI screenshots`, async ({ app }) => {
    test.setTimeout(120_000);
    const dir = join(OUT!, locale);
    mkdirSync(dir, { recursive: true });
    if (locale === "pseudo") await usePseudo(app);
    prepare(app, locale === "pseudo" ? "en" : locale);
    await app.page.setViewportSize({ width: 960, height: 600 });
    await app.open();
    await expect(app.page.locator("html")).toHaveAttribute("lang", locale === "pseudo" ? "en" : locale);
    await walkScreens(app, shooter(app, dir));
  });

  test(`${locale}: welcome page screenshot`, async ({ app }) => {
    const dir = join(OUT!, locale);
    mkdirSync(dir, { recursive: true });
    if (locale === "pseudo") await usePseudo(app);
    prepare(app, locale === "pseudo" ? "en" : locale);
    await app.page.setViewportSize({ width: 960, height: 600 });
    await welcome(app, async (screen) => {
      await app.page.waitForTimeout(150);
      await app.page.screenshot({ path: join(dir, `00 ${screen}.png`) });
    });
  });
}
