// Font subset for the product name: only the glyphs of the name (Simplified "超级批注", Traditional "超級批註", and the English name SnipToss
// used by the other languages), a few KB, bundled into the UI.
//   node scripts/build-brand-font.mjs [font file]
// Font: Noto Sans SC (the same glyphs as Source Han Sans, SIL OFL 1.1; the reserved font name is "Source" - the subset carries no font name and
// is not called that, so it complies), variable font pinned at Medium (500).
// The copyright and license text are in the third-party notices (scripts/build-notices.mjs, license text scripts/notices/noto-cjk-LICENSE.txt).
// Output: packages/web/src/assets/brand-name.woff2; the font keeps its copyright and license notices (name table IDs 0, 13, 14).
// Why not a bitmap wordmark: a bitmap wordmark looks poor at small sizes such as 20px - the scaled-down bitmap is blurry and the strokes wobble;
// text rendered by the system is pixel-aligned at small sizes and stays sharp.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import subsetFont from "subset-font";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = process.argv[2] ?? "C:\\Windows\\Fonts\\NotoSansSC-VF.ttf";
// How the message brand.name is written in each language: rerun after changing any of them
const TEXT = "超级批注超級批註SnipToss";

const out = await subsetFont(readFileSync(SOURCE), TEXT, {
  targetFormat: "woff2",
  variationAxes: { wght: 500 },
  preserveNameIds: [0, 13, 14],
});
const file = join(ROOT, "packages/web/src/assets/brand-name.woff2");
writeFileSync(file, out);
console.log(`Generated ${file} (${out.length} bytes, glyphs: ${TEXT})`);
