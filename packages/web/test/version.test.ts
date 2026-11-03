import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { releaseDate, versionLabel, versionText } from "../src/brand";

// The version has a single source: version in the root package.json, which build-app.ps1 syncs to the csproj when it installs.
// When the two disagree the version in the library's bottom right corner turns red; this test catches a hand edit of only one side without
// building the app
const root = new URL("../../../", import.meta.url);

describe("version: package.json and the app itself (csproj) agree", () => {
  it("the csproj <Version> = the version in package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8")).version as string;
    const csproj = /<Version>([^<]+)<\/Version>/.exec(readFileSync(new URL("app/SnipToss.App.csproj", root), "utf8"))?.[1];
    expect(csproj).toBe(pkg);
  });
});

describe("how a version is written", () => {
  it("the version tag: a beta names the version its series leads to, a release has just the version", () => {
    expect(versionLabel("1.0.0-beta.44")).toBe("v1.0.0 Beta 44");
    expect(versionLabel("1.1.0-beta.2")).toBe("v1.1.0 Beta 2");
    expect(versionLabel("1.1.0")).toBe("v1.1.0");
  });

  it("the About page's Version line: the version tag without the v, the same on every platform", () => {
    expect(versionText("1.0.0-beta.44")).toBe("1.0.0 Beta 44");
    expect(versionText("1.2.2")).toBe("1.2.2");
  });

  it("the release date: day only, written Nov 3, 2026 in every language and time zone; nothing for a missing or malformed date", () => {
    expect(releaseDate("2026-11-03")).toBe("Nov 3, 2026");
    expect(releaseDate("2026-01-31")).toBe("Jan 31, 2026");
    expect(releaseDate("")).toBe("");
    expect(releaseDate("2026-11-03T10:00:00Z")).toBe("");
  });
});
