// The two images in the installer wizard (WizardSmallImageFile and WizardImageFile in installer/SnipToss.iss), generated from the icon master
// design/icon/sniptoss.svg to replace Inno Setup's default box-and-disc artwork. Rerun after changing the icon (scripts/build-icon.mjs): node scripts/build-wizard-images.mjs
//   wizard-small-<pixels>.png  small image at the top right: 58×58 (its size at Inno 6.7 standard DPI), transparent background, icon only
//   wizard-large-<width>.png   large image on the left of the finish page: 164×314, the app window's background color (--bg in styles.css) + icon
// One image per scale from 100% to 250%; Inno picks the best fit for the current DPI
import { Resvg } from "@resvg/resvg-js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "installer", "images");
const SCALES = [1, 1.25, 1.5, 1.75, 2, 2.5];
/** Same as --bg in styles.css and Bg in MainWindow.cs */
const BG = "#141416";

const master = readFileSync(join(ROOT, "design", "icon", "sniptoss.svg"), "utf8");
const inner = /<svg[^>]*viewBox="0 0 256 256"[^>]*>([\s\S]*)<\/svg>/.exec(master)?.[1];
if (!inner) throw new Error("design/icon/sniptoss.svg is not a master with viewBox 0 0 256 256");

const png = (svg) => new Resvg(svg).render().asPng();
mkdirSync(OUT, { recursive: true });
const small = [];
const large = [];
for (const s of SCALES) {
  const n = Math.round(58 * s);
  writeFileSync(
    join(OUT, `wizard-small-${n}.png`),
    png(`<svg xmlns="http://www.w3.org/2000/svg" width="${n}" height="${n}" viewBox="0 0 256 256">${inner}</svg>`),
  );
  small.push(`images\\wizard-small-${n}.png`);

  // Icon 96 wide, centered horizontally and placed toward the top (the finish page's title is at the upper right)
  const [w, h, icon] = [164, 314, 96];
  const ww = Math.round(w * s);
  writeFileSync(
    join(OUT, `wizard-large-${ww}.png`),
    png(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${ww}" height="${Math.round(h * s)}" viewBox="0 0 ${w} ${h}">` +
        `<rect width="${w}" height="${h}" fill="${BG}"/>` +
        `<g transform="translate(${(w - icon) / 2} ${Math.round(h * 0.38 - icon / 2)}) scale(${icon / 256})">${inner}</g></svg>`,
    ),
  );
  large.push(`images\\wizard-large-${ww}.png`);
}
console.log(`installer/images:\nWizardSmallImageFile=${small.join(",")}\nWizardImageFile=${large.join(",")}`);
