// Checks the UI CSS for values outside the tables in the design rules (docs/design-rules.md):
//   node scripts/check-design.mjs
// Font sizes and line heights may only use tokens; font weight is only 400 / 600; spacing only from the S3 table; radii only tokens;
// hex colors may only be written in :root (turn them into a token and use that); opacity is only 0 / 1 / --disabled / --dim. Exits with code 1 on problems.
// Not covered: alignment (has to be measured in the UI) and the role of translucent overlay colors (rgba). Review those region by region in screenshots.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const files = ["packages/web/src/styles.css", "packages/web/src/workspace.css"];

const SPACE = new Set([0, 1, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48]); // S3 (1 is only for strokes; allowed here as 1px spacing is rare)
const SPACE_PROPS = /^(padding|margin)(-(top|right|bottom|left|inline|block))?$|^(row-|column-)?gap$/;
/** Radii: tokens, pill 999px, circle 50%, and 2px for small parts under 8px */
const RADIUS_OK = /^(var\(--r-[a-z]+\)|999px|50%|2px|0)$/;
/** Exceptions with a stated reason: selector -> the one declaration allowed */
const EXCEPTIONS = [
  { selector: ".annot-badge.is-pin", prop: "border-radius", why: "pin: three corners are 24-high semicircles, the point is 2px" },
  { selector: "::-webkit-scrollbar-thumb", prop: "border-radius", why: "scrollbar: looks like the system control" },
  { selector: ".scope-switch .seg", prop: "padding", why: "track padding 2 + 8 = 10: first segment's text lands on content line 20 (S5)" },
];

const problems = [];
for (const file of files) {
  const lines = readFileSync(join(root, file), "utf8").split(/\r?\n/);
  const stack = [];
  let pending = "";
  lines.forEach((raw, i) => {
    const line = raw.replace(/\/\*.*?\*\//g, "").trim();
    if (!line) return;
    if (line.endsWith("{")) {
      stack.push((pending + " " + line.slice(0, -1)).trim());
      pending = "";
      return;
    }
    if (line === "}") {
      stack.pop();
      return;
    }
    if (line.endsWith(",") && !line.includes(":")) {
      pending += " " + line;
      return;
    }
    const m = /^([a-z-]+)\s*:\s*(.+?);?$/.exec(line);
    if (!m) return;
    const [, prop, value] = m;
    const selector = stack.at(-1) ?? "";
    const inRoot = stack.includes(":root");
    if (stack.some((s) => s.startsWith("@keyframes"))) return;
    const where = `${file}:${i + 1}  ${selector}`;
    const report = (why) => {
      if (EXCEPTIONS.some((e) => selector.includes(e.selector) && e.prop === prop)) return;
      problems.push(`${where}\n    ${prop}: ${value}  ← ${why}`);
    };

    if (prop === "font-size" && !/^var\(--fs-[a-z]+\)$|^inherit$/.test(value)) report("font size only uses --fs-* (S2)");
    if (prop === "line-height" && !/^var\(--(lh|h)-[a-z]+\)$|^1$/.test(value)) report("line height only uses --lh-* / --h-* (S2)");
    if (prop === "font-weight" && !/^(400|600)$/.test(value)) report("font weight is only 400 / 600 (S2)");
    if (prop === "font" && !/var\(--fs-[a-z]+\)|^inherit$/.test(value)) report("the size in a font shorthand must also use --fs-* (S2)");
    if (SPACE_PROPS.test(prop)) {
      for (const n of value.matchAll(/(-?\d+(?:\.\d+)?)px/g)) {
        if (!SPACE.has(Math.abs(Number(n[1])))) report(`${n[1]}px is not in the spacing table (S3: ${[...SPACE].join(" ")})`);
      }
    }
    if (prop === "border-radius" || /^border-.*-radius$/.test(prop)) {
      for (const part of value.split(/\s+/)) if (!RADIUS_OK.test(part)) report("radius only uses --r-* / 999px / 50% (S6)");
    }
    if (!inRoot && /#[0-9a-f]{3,8}\b/i.test(value) && !/#fff\b/i.test(value)) report("write the color as a token and use that (Sy1)");
    if (prop === "opacity" && selector.includes(":disabled") && value !== "var(--disabled)")
      report("disabled state is always var(--disabled) (one treatment for one thing)");
    // Always-visible things don't get an overall opacity (G1: text falls back to grayscale anti-aliasing); fade with color instead.
    // Allowed: appearing / disappearing (0, 1), disabled, marks that are not at this moment on the canvas
    else if (prop === "opacity" && !/^(0|1|var\(--disabled\)|var\(--dim\))$/.test(value))
      report("opacity only uses 0 / 1 / var(--disabled) / var(--dim); to make something fainter, change the color (G1)");
  });
}

if (problems.length) {
  console.log(`Design rules check: ${problems.length} value(s) outside the tables\n`);
  console.log(problems.join("\n"));
  process.exit(1);
}
console.log("Design rules check: no values outside the tables");
