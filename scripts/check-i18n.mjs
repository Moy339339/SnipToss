// How much UI text is still hard-coded in the source (not in the i18n/locales messages): the number of code lines containing Chinese, comments excluded.
// It may only go down, never up (a ratchet): exceeding the count recorded in scripts/i18n-baseline.json fails; below it, a hint says to lower the baseline (--update writes it back).
// When internationalization is complete, all three counts should be 0 (docs/adr/0001-i18n.md).
//   node scripts/check-i18n.mjs            # check
//   node scripts/check-i18n.mjs --update   # after moving a batch of text into messages, lower the baseline to the current counts
//   node scripts/check-i18n.mjs --list     # list how many lines each file still has
//   node scripts/check-i18n.mjs --lines    # list line by line (file:line: content)

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BASELINE = join(ROOT, "scripts", "i18n-baseline.json");
const CJK = /[　-〿㐀-鿿＀-￯]/;

/** What to count; skip = files that are meant to contain Chinese (each language's own name, etc.) */
const AREAS = {
  web: { dir: "packages/web/src", ext: [".ts", ".tsx"], skip: ["i18n.tsx"] },
  core: { dir: "packages/core/src", ext: [".ts"], skip: [] },
  shell: { dir: "app", ext: [".cs"], skip: [] },
};

/** Strip comments, keep strings and code (a rough state machine: TS ' " ` and C# " @" all count as "string", good enough for counting) */
function stripComments(src, cs) {
  let out = "";
  let i = 0;
  let state = "code";
  let quote = "";
  /** C# verbatim strings (@"…", $@"…", @$"…"): a backslash is not an escape, "" is a quote */
  let verbatim = false;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (state === "code") {
      if (c === "/" && n === "/") {
        state = "line";
        i += 2;
        continue;
      }
      if (c === "/" && n === "*") {
        state = "block";
        i += 2;
        continue;
      }
      // C# raw strings ("""…""", may span lines, a " inside is not a boundary): keep the whole span as is. Counting quotes as in an ordinary string
      // flipped the state for everything after the span, so comments were counted as code (as happened with the comment after the button template in NativeUi.cs)
      if (cs && src.startsWith('"""', i)) {
        const end = src.indexOf('"""', i + 3);
        const stop = end < 0 ? src.length : end + 3;
        out += src.slice(i, stop);
        i = stop;
        continue;
      }
      if (c === '"' || c === "'" || (!cs && c === "`")) {
        state = "string";
        quote = c;
        verbatim = cs && c === '"' && (src[i - 1] === "@" || (src[i - 1] === "$" && src[i - 2] === "@"));
        out += c;
        i++;
        continue;
      }
      out += c;
      i++;
      continue;
    }
    if (state === "line") {
      if (c === "\n") {
        state = "code";
        out += c;
      }
      i++;
      continue;
    }
    if (state === "block") {
      if (c === "*" && n === "/") {
        state = "code";
        i += 2;
        continue;
      }
      if (c === "\n") out += c;
      i++;
      continue;
    }
    // Inside a string
    out += c;
    if (verbatim && c === '"' && n === '"') {
      out += n;
      i += 2;
      continue;
    }
    if (c === "\\" && !verbatim) {
      out += n ?? "";
      i += 2;
      continue;
    }
    if (c === quote) state = "code";
    i++;
  }
  return out;
}

function files(dir, ext, skip) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!["bin", "obj", "node_modules", "dist"].includes(name)) out.push(...files(full, ext, skip));
    } else if (ext.includes(extname(name)) && !skip.includes(name)) out.push(full);
  }
  return out;
}

/**
 * Lines that write to the log don't count: the log is diagnostic information for maintainers and is not translated (otherwise logs from user reports
 * would vary with each user's system language and be hard to search). Performance records (Perf.Record, SNIPTOSS_PERF_LOG) are the same: the budget script reads them.
 * See "Logs" in docs/adr/0001-i18n.md
 */
const LOG_CALL = /(?<![\w.])(Log\.(Info|Warn|Error)|logError|Perf\.Record)\(/;

const counts = {};
const perFile = [];
for (const [area, { dir, ext, skip }] of Object.entries(AREAS)) {
  let total = 0;
  for (const file of files(join(ROOT, dir), ext, skip)) {
    const hits = stripComments(readFileSync(file, "utf8"), ext.includes(".cs"))
      .split("\n")
      .map((l, i) => [i + 1, l])
      .filter(([, l]) => CJK.test(l) && !LOG_CALL.test(l));
    const lines = hits.length;
    if (lines) perFile.push([relative(ROOT, file), lines]);
    if (process.argv.includes("--lines")) for (const [n, l] of hits) console.log(`${relative(ROOT, file)}:${n}: ${l.trim()}`);
    total += lines;
  }
  counts[area] = total;
}

if (process.argv.includes("--list"))
  for (const [f, n] of perFile.sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(4)}  ${f}`);

if (process.argv.includes("--update")) {
  writeFileSync(BASELINE, JSON.stringify(counts, null, 2) + "\n");
  console.log("Baseline lowered to:", counts);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
let failed = false;
for (const [area, n] of Object.entries(counts)) {
  const max = baseline[area] ?? 0;
  if (n > max) {
    failed = true;
    console.error(
      `More hard-coded Chinese: ${area} now has ${n} lines, limit ${max}. Put new UI text in i18n/locales (see the top of packages/web/src/i18n.tsx)`,
    );
  } else if (n < max) {
    console.log(`${area}: ${n} lines (limit ${max}, ${max - n} fewer; run node scripts/check-i18n.mjs --update to lower the limit)`);
  }
}
if (failed) process.exit(1);
console.log(`Hard-coded Chinese: UI ${counts.web} lines, core ${counts.core} lines, shell ${counts.shell} lines (may only go down)`);
