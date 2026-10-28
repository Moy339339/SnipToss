// Third-party license notices (shipped with the app, shown in Settings → About): for each piece of someone else's software the app
// includes, its name, version, license and full license text.
//   node scripts/build-notices.mjs           # regenerate THIRD-PARTY-NOTICES.txt in the repo root
//   node scripts/build-notices.mjs --check   # fail when it is out of date (scripts/publish.ps1 checks before a release: a dependency changed version or was added without regenerating)
// What is covered: the npm packages bundled into the UI (runtime dependencies of packages/web and their dependencies, without @types), the brand font
// (Noto Sans SC subset), NuGet packages (WebView2, MessageFormat) and the bundled .NET runtime (the release build is self-contained).
// The .NET runtime licenses are read from the runtime packs in the NuGet cache (present once a publish has run: dotnet publish -r win-x64); the newest 10.x in the cache is used.
// Where it is used: Settings → About → "Third-party notices" (the UI loads this file on demand and splits it into entries by title block:
// packages/web/src/notices.ts - change both together when the format changes); in the release package it sits next to the app (app/SnipToss.App.csproj).
// Names follow each component's own spelling, with no explanatory English sentences mixed in: this column is not translated in the UI,
// and something like "(subset used for …)" would be unreadable to non-English readers.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "THIRD-PARTY-NOTICES.txt");
const VENDORED = join(ROOT, "scripts", "notices");
const NUGET = process.env.NUGET_PACKAGES ?? join(homedir(), ".nuget", "packages");
const read = (path) => readFileSync(path, "utf8").replace(/\r\n?/g, "\n").trim();

/** The license file in a package folder (LICENSE, LICENCE, COPYING, with or without an extension) */
function licenseText(dir) {
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f));
  return file ? read(join(dir, file)) : undefined;
}

// ---------- npm: runtime dependencies of packages/web ----------
/** Resolve like Node does: look for node_modules/<name> in from, then in each parent folder */
function findPackage(name, from) {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    if (dirname(dir) === dir) throw new Error(`npm package ${name} not found (searched upward from ${from}): run npm install first`);
  }
}

const npm = new Map();
function collect(name, from) {
  if (name.startsWith("@types/") || name.startsWith("@sniptoss/")) return;
  const dir = findPackage(name, from);
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const key = `${pkg.name}@${pkg.version}`;
  if (npm.has(key)) return;
  const repo = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  npm.set(key, {
    name: pkg.name,
    version: pkg.version,
    license: typeof pkg.license === "string" ? pkg.license : (pkg.license?.type ?? "see text"),
    source: (pkg.homepage ?? repo ?? `https://www.npmjs.com/package/${pkg.name}`).replace(/^git\+/, "").replace(/\.git$/, ""),
    text: licenseText(dir),
  });
  for (const dep of Object.keys(pkg.dependencies ?? {})) collect(dep, dir);
}
const web = JSON.parse(readFileSync(join(ROOT, "packages", "web", "package.json"), "utf8"));
for (const dep of Object.keys(web.dependencies)) collect(dep, join(ROOT, "packages", "web"));
// core is bundled into the UI, so its runtime dependencies count too
const core = JSON.parse(readFileSync(join(ROOT, "packages", "core", "package.json"), "utf8"));
for (const dep of Object.keys(core.dependencies ?? {})) collect(dep, join(ROOT, "packages", "core"));

// ---------- NuGet: versions as written in the csproj ----------
const csproj = readFileSync(join(ROOT, "app", "SnipToss.App.csproj"), "utf8");
const nugetVersion = (id) => {
  const m = new RegExp(`<PackageReference Include="${id.replace(/\./g, "\\.")}" Version="([^"]+)"`).exec(csproj);
  if (!m) throw new Error(`The csproj has no ${id}`);
  return m[1];
};
const nugetDir = (id, version) => {
  const dir = join(NUGET, id.toLowerCase(), version);
  if (!existsSync(dir)) throw new Error(`The NuGet cache has no ${id} ${version} (${dir}): build the shell once first`);
  return dir;
};
const webview2 = nugetVersion("Microsoft.Web.WebView2");
const webview2Dir = nugetDir("Microsoft.Web.WebView2", webview2);
const messageFormat = nugetVersion("MessageFormat");

/** The newest 10.x runtime pack in the NuGet cache */
function runtimePack(id) {
  const base = join(NUGET, id);
  const versions = existsSync(base) ? readdirSync(base).filter((v) => /^10\.\d+\.\d+$/.test(v)) : [];
  if (!versions.length) throw new Error(`The NuGet cache has no ${id} 10.x: publish once first (pwsh -File scripts/publish.ps1)`);
  const latest = versions.sort((a, b) => a.localeCompare(b, "en", { numeric: true })).at(-1);
  return { version: latest, dir: join(base, latest) };
}
const netcore = runtimePack("microsoft.netcore.app.runtime.win-x64");
const desktop = runtimePack("microsoft.windowsdesktop.app.runtime.win-x64");

const entries = [
  {
    name: ".NET Runtime",
    version: netcore.version,
    license: "MIT",
    source: "https://github.com/dotnet/runtime",
    text: `${read(join(netcore.dir, "LICENSE.TXT"))}\n\n--- .NET runtime third-party notices ---\n\n${read(join(netcore.dir, "THIRD-PARTY-NOTICES.TXT"))}`,
  },
  {
    name: ".NET Windows Desktop Runtime (WPF, Windows Forms)",
    version: desktop.version,
    license: "MIT",
    source: "https://github.com/dotnet/wpf, https://github.com/dotnet/winforms",
    text: read(join(desktop.dir, "LICENSE")),
  },
  {
    name: "Microsoft.Web.WebView2",
    version: webview2,
    license: "BSD-3-Clause",
    source: "https://www.nuget.org/packages/Microsoft.Web.WebView2",
    text: `${read(join(webview2Dir, "LICENSE.txt"))}\n\n--- NOTICE ---\n\n${read(join(webview2Dir, "NOTICE.txt"))}`,
  },
  {
    name: "MessageFormat (messageformat.net)",
    version: messageFormat,
    license: "MIT",
    source: "https://github.com/jeffijoe/messageformat.net",
    text: read(join(VENDORED, "messageformat.net-LICENSE.txt")),
  },
  {
    // The glyphs of the product name (the subset cut by scripts/build-brand-font.mjs); the copyright line comes from the font's name table
    name: "Noto Sans SC",
    version: "2.04", // font name table ID 5: Version 2.04
    license: "OFL-1.1",
    source: "https://github.com/notofonts/noto-cjk",
    text: `© 2014-2021 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'.\n\n${read(join(VENDORED, "noto-cjk-LICENSE.txt"))}`,
  },
  ...[...npm.values()].sort((a, b) => a.name.localeCompare(b.name, "en")),
];

const missing = entries.filter((e) => !e.text);
if (missing.length)
  throw new Error(`No license text for: ${missing.map((e) => `${e.name}@${e.version}`).join(", ")} (add it to scripts/notices)`);

const rule = "=".repeat(78);
const text = [
  "THIRD-PARTY SOFTWARE NOTICES",
  "",
  "SnipToss (MIT License, Copyright (c) 2026 MoyGoldenAge) includes the third-party software listed below.",
  "Each component is provided under its own license, reproduced in full in its section.",
  "",
  "Generated by scripts/build-notices.mjs. Don't edit by hand.",
  "",
  ...entries.map((e) => `- ${e.name} ${e.version} (${e.license})`),
  ...entries.flatMap((e) => ["", rule, `${e.name} ${e.version}`, `License: ${e.license}`, `Source: ${e.source}`, rule, "", e.text]),
  "",
].join("\n");

if (process.argv.includes("--check")) {
  const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  if (current !== text) {
    console.error("THIRD-PARTY-NOTICES.txt is out of date (dependencies changed): run node scripts/build-notices.mjs and commit it");
    process.exit(1);
  }
  console.log(`THIRD-PARTY-NOTICES.txt is up to date (${entries.length} entries)`);
} else {
  writeFileSync(OUT, text, "utf8");
  console.log(`Generated ${OUT} (${entries.length} entries, ${Math.round(text.length / 1024)} KB)`);
}
