import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
