// Code comments, test names and the public docs are written in English (the UI text lives in i18n/locales).
// Counts the lines that still contain Chinese: in comments, in test titles / C# test method names, and in the public docs.
// Some are meant to stay (a comment quoting the Chinese product name or a Chinese UI example), so this is a ratchet like
// check-i18n.mjs: exceeding the counts recorded in scripts/english-baseline.json fails; below them, a hint says to lower the baseline.
//   node scripts/check-english.mjs            # check
//   node scripts/check-english.mjs --update   # lower the baseline to the current counts
//   node scripts/check-english.mjs --lines    # list the lines (file:line: text)

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BASELINE = join(ROOT, "scripts", "english-baseline.json");
const CJK = /[㐀-鿿]/;

/** Not checked: translations, test data and golden files, and maintainer notes that are not published */
const SKIP = [
  /^i18n\//,
  /^installer\/languages\//,
  /^tests\/golden\//,
  /^tests\/e2e\/fixtures\//,
  /^docs\/(qa|release|proposals)\//,
  /^design\//,
  /^README\.zh-CN\.md$/,
  /^docs\/annotation-format\.zh-CN\.md$/,
  /^AGENTS/,
  /^CLAUDE\.md$/,
  /^scripts\/export-public/,
  /(^|\/)(node_modules|dist|bin|obj|\.app[^/]*|\.results|\.run|\.cache)\//,
  /[^ -~]/, // files with non-ASCII names are maintainer notes
];
const CODE = new Set([".ts", ".tsx", ".mts", ".mjs", ".js", ".cs", ".css", ".ps1"]);
const DOCS_DIRS = ["docs", "docs/adr"];
const DOCS_ROOT = ["README.md", "CONTRIBUTING.md", "ARCHITECTURE.md", "SECURITY.md", "CHANGELOG.md", "CODE_OF_CONDUCT.md"];

function walk(dir, out = []) {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = dir ? `${dir}/${name}` : name;
    if (name.startsWith(".") && name !== ".github") continue;
    if (SKIP.some((r) => r.test(rel + "/")) || SKIP.some((r) => r.test(rel))) continue;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (CODE.has(extname(name))) out.push(rel);
  }
  return out;
}

/** The comment text of a source file, as [line, text] pairs (strings are skipped; a rough state machine, good enough for counting) */
function comments(src, ext) {
  const out = [];
  const ps = ext === ".ps1";
  const cs = ext === ".cs";
  let line = 1;
  let state = "code";
  let quote = "";
  let buf = "";
  let start = 1;
  const flush = () => {
    if (buf.trim()) for (const [k, part] of buf.split("\n").entries()) if (part.trim()) out.push([start + k, part]);
    buf = "";
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    if (state === "code") {
      if ((!ps && c === "/" && n === "/") || (ps && c === "#" && src[i - 1] !== "<" && src[i - 1] !== "`")) {
        state = "line";
        start = line;
        if (!ps) i++;
      } else if ((!ps && c === "/" && n === "*") || (ps && c === "<" && n === "#")) {
        state = "block";
        start = line;
        i++;
      } else if (cs && src.startsWith('"""', i)) {
        const end = src.indexOf('"""', i + 3);
        const stop = end < 0 ? src.length : end + 3;
        line += src.slice(i, stop).split("\n").length - 1;
        i = stop - 1;
      } else if (c === '"' || c === "'" || (!cs && !ps && c === "`")) {
        state = "string";
        quote = c;
      }
    } else if (state === "line") {
      if (c === "\n") {
        flush();
        state = "code";
      } else buf += c;
    } else if (state === "block") {
      if ((!ps && c === "*" && n === "/") || (ps && c === "#" && n === ">")) {
        flush();
        state = "code";
        i++;
      } else buf += c;
    } else if (state === "string") {
      if (c === "\\" && !ps && !cs) i++;
      else if (c === quote) state = "code";
      else if (c === "\n" && quote !== "`" && !ps) state = "code";
    }
    if (src[i] === "\n") line++;
  }
  flush();
  return out;
}

const TS_TITLE = /\b(?:test|it|describe)(?:\.\w+)*(?:\([^)]*\))?\(\s*(["'`])((?:(?!\1).)*)\1/;
const CS_TEST = /\[(?:Fact|Theory)[^\]]*\][\s\S]{0,400}?\b(?:void|Task)\s+(\w+)\s*\(/g;

const found = { comments: [], titles: [], docs: [] };
for (const rel of walk("")) {
  const src = readFileSync(join(ROOT, rel), "utf8");
  const ext = extname(rel);
  for (const [n, text] of comments(src, ext)) if (CJK.test(text)) found.comments.push(`${rel}:${n}: ${text.trim()}`);
  if (/\.(spec|test)\.[mc]?tsx?$/.test(rel))
    src.split("\n").forEach((l, i) => {
      const m = TS_TITLE.exec(l);
      if (m && CJK.test(m[2])) found.titles.push(`${rel}:${i + 1}: ${m[2]}`);
    });
  if (ext === ".cs") for (const m of src.matchAll(CS_TEST)) if (CJK.test(m[1])) found.titles.push(`${rel}: ${m[1]}`);
}
const docs = [
  ...DOCS_ROOT,
  ...DOCS_DIRS.flatMap((d) =>
    readdirSync(join(ROOT, d))
      .filter((f) => f.endsWith(".md"))
      .map((f) => `${d}/${f}`),
  ),
];
for (const rel of docs) {
  if (SKIP.some((r) => r.test(rel))) continue;
  let text;
  try {
    text = readFileSync(join(ROOT, rel), "utf8");
  } catch {
    continue;
  }
  text.split("\n").forEach((l, i) => CJK.test(l) && found.docs.push(`${rel}:${i + 1}: ${l.trim()}`));
}

const counts = Object.fromEntries(Object.entries(found).map(([k, v]) => [k, v.length]));
const args = process.argv.slice(2);
if (args.includes("--lines")) for (const [k, v] of Object.entries(found)) for (const l of v) console.log(`[${k}] ${l.slice(0, 200)}`);
if (args.includes("--update")) {
  writeFileSync(BASELINE, JSON.stringify(counts, null, 2) + "\n");
  console.log(`Baseline updated: ${JSON.stringify(counts)}`);
  process.exit(0);
}
let baseline = {};
try {
  baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
} catch {
  console.error(`No baseline (${relative(ROOT, BASELINE)}): run with --update once`);
  process.exit(1);
}
const over = Object.keys(counts).filter((k) => counts[k] > (baseline[k] ?? 0));
const under = Object.keys(counts).filter((k) => counts[k] < (baseline[k] ?? 0));
console.log(`Lines with Chinese: comments ${counts.comments}, test names ${counts.titles}, public docs ${counts.docs} (may only go down)`);
if (over.length) {
  for (const k of over) {
    console.error(`${k}: ${counts[k]} > ${baseline[k] ?? 0}. Write comments, test names and docs in English; the new lines:`);
    for (const l of found[k].slice(-10)) console.error(`  ${l.slice(0, 200)}`);
  }
  console.error(
    "(If a line must quote Chinese — the product name, a Chinese UI example — raise the baseline with --update and say why in the commit.)",
  );
  process.exit(1);
}
if (under.length) console.log(`Below the baseline: run node scripts/check-english.mjs --update to lower it`);
