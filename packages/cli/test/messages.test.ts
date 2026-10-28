import { describe, expect, it } from "vitest";
import { LOCALES } from "@sniptoss/core";
import { translator } from "../src/i18n.js";

// The CLI's own messages (cli.*): every language formats them, all placeholders are filled, and none falls back to the bare message id
const SAMPLES: Record<string, Record<string, string | number>> = {
  "cli.help": { app: "SnipToss" },
  "cli.skipUnreadable": { file: "a.json", reason: "x" },
  "cli.reviewWritten": { path: "REVIEW.md", open: 2 },
  "cli.noNotes": {},
  "cli.wholeFolder": {},
  "cli.usageStatus": { command: "resolve" },
  "cli.notFound": { id: "abc123", unreadable: "yes" },
  "cli.readonly": { id: "abc123", file: "a.json", schema: "sniptoss/5", app: "SnipToss" },
  "cli.statusDone": { id: "abc123", status: "resolved", open: 1 },
  "cli.unknownCommand": { command: "frob" },
};

describe("CLI messages: 11 languages", () => {
  for (const locale of LOCALES) {
    it(locale, () => {
      const t = translator(locale);
      for (const [id, values] of Object.entries(SAMPLES)) {
        const text = t(id, values);
        expect(text, id).not.toBe(id);
        expect(text, id).not.toMatch(/[{}]/);
        for (const v of Object.values(values)) if (typeof v === "string" && v.length > 3) expect(text, id).toContain(v);
      }
      // Plurals follow the count (Chinese, Japanese and Korean have none, but the number is still written in)
      expect(t("cli.reviewWritten", { path: "R", open: 1 })).toContain("1");
      expect(t("cli.reviewWritten", { path: "R", open: 5 })).toContain("5");
    });
  }

  it("the help lists every command and option", () => {
    const help = translator("en")("cli.help", { app: "SnipToss" });
    for (const word of [
      "list",
      "review",
      "resolve ID",
      "wontfix ID",
      "--root DIR",
      "--all",
      "--json",
      "-m, --message TEXT",
      "--author NAME",
      "--help",
      "--version",
    ])
      expect(help).toContain(word);
  });
});
