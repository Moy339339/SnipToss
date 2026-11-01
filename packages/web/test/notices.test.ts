import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { noticesFor, parseNotices } from "../src/notices";

const RULE = "=".repeat(78);

describe("parseNotices: splits the third-party notices into entries (Settings → About → Third-Party Notices)", () => {
  it("name, version, license, source and text; a name with spaces and parentheses, and a divider line inside the text does not start a new entry", () => {
    const file = [
      "THIRD-PARTY SOFTWARE NOTICES",
      "",
      "- A Thing (with parens) 1.2.3 (MIT)",
      "",
      RULE,
      "A Thing (with parens) 1.2.3",
      "License: MIT",
      "Source: https://a.example, https://b.example",
      RULE,
      "",
      "Line one",
      "------",
      "",
      "Line two",
      "",
      RULE,
      "b 0.1.0-rc.1",
      "License: BSD-3-Clause",
      "Source: https://c.example",
      RULE,
      "",
      "Only text",
      "",
    ].join("\r\n");
    expect(parseNotices(file)).toEqual([
      {
        name: "A Thing (with parens)",
        version: "1.2.3",
        license: "MIT",
        sources: ["https://a.example", "https://b.example"],
        text: "Line one\n------\n\nLine two",
      },
      { name: "b", version: "0.1.0-rc.1", license: "BSD-3-Clause", sources: ["https://c.example"], text: "Only text" },
    ]);
  });

  it("the one in the repository: every entry listed at the top can be split out, each with its text and URLs (this fails first if the generating script changes the format)", () => {
    const file = readFileSync(fileURLToPath(new URL("../../../THIRD-PARTY-NOTICES.txt", import.meta.url)), "utf8");
    const listed = file
      .slice(0, file.indexOf(RULE))
      .split("\n")
      .filter((l) => l.startsWith("- "))
      .map((l) => l.slice(2));
    const notices = parseNotices(file);
    expect(notices.map((n) => `${n.name} ${n.version} (${n.license})`)).toEqual(listed);
    for (const n of notices) {
      expect(n.text.length).toBeGreaterThan(100);
      for (const url of n.sources) expect(url).toMatch(/^https:\/\/\S+$/);
    }
    expect(notices[0].text).toMatch(/^The MIT License/);
  });

  it("an Only in: line belongs to the header, not the text; the Mac app leaves out what only the Windows app ships", () => {
    const file = [
      RULE,
      "Runtime 10.0.1",
      "License: MIT",
      "Source: https://r.example",
      "Only in: Windows",
      RULE,
      "",
      "Runtime text",
      "",
      RULE,
      "shared 1.0.0",
      "License: MIT",
      "Source: https://s.example",
      RULE,
      "",
      "Shared text",
    ].join("\n");
    const notices = parseNotices(file);
    expect(notices.map((n) => [n.name, n.only, n.text])).toEqual([
      ["Runtime", ["Windows"], "Runtime text"],
      ["shared", undefined, "Shared text"],
    ]);
    expect(noticesFor(notices, "windows").map((n) => n.name)).toEqual(["Runtime", "shared"]);
    expect(noticesFor(notices, "mac").map((n) => n.name)).toEqual(["shared"]);
  });

  it("the one in the repository: what only the Windows app ships is the .NET runtime, WebView2 and MessageFormat; everything else is in the Mac app too", () => {
    const file = readFileSync(fileURLToPath(new URL("../../../THIRD-PARTY-NOTICES.txt", import.meta.url)), "utf8");
    const notices = parseNotices(file);
    expect(notices.filter((n) => n.only).map((n) => `${n.name}: ${n.only?.join(", ")}`)).toEqual([
      ".NET Runtime: Windows",
      ".NET Windows Desktop Runtime (WPF, Windows Forms): Windows",
      "Microsoft.Web.WebView2: Windows",
      "MessageFormat (messageformat.net): Windows",
    ]);
    // Windows lists every one; the Mac has the UI's packages (the shell's message formatter is the same intl-messageformat) and the font
    expect(noticesFor(notices, "windows")).toHaveLength(notices.length);
    const mac = noticesFor(notices, "mac").map((n) => n.name);
    expect(mac).toContain("intl-messageformat");
    expect(mac).toContain("Noto Sans SC");
    expect(mac).toHaveLength(notices.length - 4);
  });
});
