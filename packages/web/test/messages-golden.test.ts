import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, TYPE, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import { IntlMessageFormat } from "intl-messageformat";
import { describe, expect, it } from "vitest";

// The shell (C#, MessageFormat.NET) and the UI (intl-messageformat) read the same messages: for the groups of messages the shell uses, both
// sides must format them word for word the same (docs/adr/0001-i18n.md item 3). The expected values are computed here (intl-messageformat,
// the reference implementation) and saved as the
// golden file tests/golden/messages.json, which the shell's tests/AppTests/LocaleTests.cs compares against. After a message changes the
// golden file is stale and this fails:
// regenerate it with UPDATE_GOLDEN=1 npx vitest run packages/web/test/messages-golden.test.ts
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DIR = join(ROOT, "i18n", "locales");
const GOLDEN = join(ROOT, "tests", "golden", "messages.json");

/**
 * The message prefixes the shell uses (markColor: the color swatches of Screen Capture and the color names in text for AI; keycap: key
 * names of shortcuts in the tray and notifications)
 */
const SHELL_PREFIXES = ["brand.", "category.", "shell.", "capture.", "ai.", "markColor.", "keycap."];

/**
 * The counts to try for plurals: they cover the CLDR rule categories of the languages (Russian 1 / 2 / 5 / 21 / 22, and 0 is singular in
 * French). Under 1000: the shell's # adds no thousands separator
 */
const COUNTS = [0, 1, 2, 5, 21, 22, 101];

type Arg = { kind: "text" } | { kind: "plural" } | { kind: "select"; options: string[] };

function argsOf(els: MessageFormatElement[], out = new Map<string, Arg>()) {
  for (const el of els) {
    if (el.type === TYPE.argument || el.type === TYPE.number || el.type === TYPE.date || el.type === TYPE.time) {
      if (!out.has(el.value)) out.set(el.value, { kind: "text" });
    } else if (el.type === TYPE.plural) {
      out.set(el.value, { kind: "plural" });
      for (const o of Object.values(el.options)) argsOf(o.value, out);
    } else if (el.type === TYPE.select) {
      out.set(el.value, { kind: "select", options: Object.keys(el.options).filter((k) => k !== "other") });
      for (const o of Object.values(el.options)) argsOf(o.value, out);
    } else if (el.type === TYPE.tag) argsOf(el.children, out);
  }
  return out;
}

/** The sets of arguments to try for one message: every plural and select value is covered (cut off when there are too many combinations) */
function argSets(msg: string): Record<string, string | number>[] {
  let sets: Record<string, string | number>[] = [{}];
  for (const [name, arg] of argsOf(parse(msg))) {
    const values: (string | number)[] =
      arg.kind === "plural" ? COUNTS : arg.kind === "select" ? [...arg.options, "something-else"] : [`<${name}>`];
    sets = sets.flatMap((s) => values.map((v) => ({ ...s, [name]: v }))).slice(0, 64);
  }
  return sets;
}

function build() {
  const cases: { locale: string; key: string; args: Record<string, string | number>; text: string }[] = [];
  for (const file of readdirSync(DIR)
    .filter((n) => n.endsWith(".json"))
    .sort()) {
    const locale = file.replace(/\.json$/, "");
    const catalog = JSON.parse(readFileSync(join(DIR, file), "utf8")) as Record<string, string>;
    for (const [key, msg] of Object.entries(catalog)) {
      if (!SHELL_PREFIXES.some((p) => key.startsWith(p))) continue;
      for (const args of argSets(msg)) cases.push({ locale, key, args, text: String(new IntlMessageFormat(msg, locale).format(args)) });
    }
  }
  return cases;
}

describe("the shell and the UI format messages the same way (golden file tests/golden/messages.json)", () => {
  it("the golden file is computed from the current messages", () => {
    const cases = build();
    const golden = {
      _: "外壳用的词条（brand / category / shell / capture / ai / markColor / keycap）在各语言、各种参数下应格式化成的样子。由 packages/web/test/messages-golden.test.ts 生成，别手改；外壳的 LocaleTests 拿它比",
      cases,
    };
    const text = JSON.stringify(golden, null, 2) + "\n";
    if (process.env.UPDATE_GOLDEN === "1") writeFileSync(GOLDEN, text, "utf8");
    expect(readFileSync(GOLDEN, "utf8"), "messages changed: rerun this test with UPDATE_GOLDEN=1 to regenerate the golden file").toBe(text);
  });
});
