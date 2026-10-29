import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { versionLabel, versionWithBuild } from "../src/brand";

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
  it("the version tag: a beta as Beta N, a release with a v", () => {
    expect(versionLabel("1.0.0-beta.44")).toBe("Beta 44");
    expect(versionLabel("1.0.0")).toBe("v1.0.0");
  });

  it("the About page's Version line: on a Mac package x.y.z and the build number, otherwise the whole version", () => {
    expect(versionWithBuild("1.0.0-beta.44", "44")).toBe("1.0.0 (44)");
    expect(versionWithBuild("1.1.0", "57")).toBe("1.1.0 (57)");
    expect(versionWithBuild("1.0.0-beta.44")).toBe("1.0.0-beta.44");
    expect(versionWithBuild("1.0.0", "")).toBe("1.0.0");
  });
});
