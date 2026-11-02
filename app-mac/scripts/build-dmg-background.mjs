// The disk image window's background, rendered from app-mac/packaging/dmg-background.svg at 1x and 2x (package-dmg.mjs joins the two into
// one TIFF for Finder). Rerun after changing the SVG: node app-mac/scripts/build-dmg-background.mjs
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "packaging");
const svg = readFileSync(join(DIR, "dmg-background.svg"), "utf8");
for (const [name, width] of [
  ["dmg-background.png", 640],
  ["dmg-background@2x.png", 1280],
]) {
  const png = new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();
  writeFileSync(join(DIR, name), png);
  console.log(`${name}: ${width} wide, ${png.length} bytes`);
}
