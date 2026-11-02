// The disk image people download: SnipToss.app (made by package-app.mjs), a link to Applications and the two read-me files, laid out over
// the background in app-mac/packaging (dmg-settings.py). Runs on macOS after package-app.mjs, with dmgbuild (pip install dmgbuild; its
// path in SNIPTOSS_DMGBUILD, otherwise the one on PATH):
//   node app-mac/scripts/package-dmg.mjs <package folder> [build number]
// Writes <package folder>/SnipToss-<version>-mac-<universal or the one architecture>.dmg, named like the Windows packages
// (SnipToss-<version>-win-x64-setup.exe): the update check of each app tells its own packages by -mac- / -win-. The version is the one the UI was built with, as in package-app.mjs; a trial package
// (a beta) is called "Beta <build>" in the volume's name and the read-me files, a release by its x.y.z
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const packaging = join(root, "app-mac", "packaging");
const out = resolve(process.argv[2] ?? join(root, "app-mac", ".build", "package"));
const build = process.argv[3] ?? "0";
const version = process.env.SNIPTOSS_UI_VERSION || JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const label = version.includes("-") ? `Beta ${build}` : version;
// Finder shows the volume's name as the window's title. It can't follow the reader's language, so it is the name used everywhere; the app
// inside still shows its name in the system's language
const volume = `SnipToss ${label}`;

const app = join(out, "SnipToss.app");
if (!existsSync(app)) throw new Error(`missing ${app}: run package-app.mjs first`);
const architectures = execFileSync("lipo", ["-archs", join(app, "Contents", "MacOS", "SnipToss")], { encoding: "utf8" }).trim().split(/\s+/);
const platform = `mac-${architectures.length > 1 ? "universal" : architectures[0]}`;

const run = (command, args) => execFileSync(command, args, { stdio: ["ignore", "inherit", "inherit"] });
const work = mkdtempSync(join(tmpdir(), "sniptoss-dmg-"));
try {
  // The read-me files with the version filled in
  for (const language of ["en", "zh-CN"]) {
    const text = readFileSync(join(packaging, `ReadMe.${language}.txt`), "utf8").replaceAll("{version}", label);
    writeFileSync(join(work, `ReadMe.${language}.txt`), text);
  }
  // One TIFF with the 1x and 2x pictures: Finder picks the one for the screen
  const background = join(work, "background.tiff");
  run("tiffutil", ["-cathidpicheck", join(packaging, "dmg-background.png"), join(packaging, "dmg-background@2x.png"), "-out", background]);

  const dmg = join(out, `SnipToss-${version}-${platform}.dmg`);
  rmSync(dmg, { force: true });
  run(process.env.SNIPTOSS_DMGBUILD || "dmgbuild", [
    "-s",
    join(packaging, "dmg-settings.py"),
    "-D",
    `app=${app}`,
    "-D",
    `readme_en=${join(work, "ReadMe.en.txt")}`,
    "-D",
    `readme_zh=${join(work, "ReadMe.zh-CN.txt")}`,
    "-D",
    `background=${background}`,
    "-D",
    `icon=${join(app, "Contents", "Resources", "SnipToss.icns")}`,
    volume,
    dmg,
  ]);
  run("hdiutil", ["verify", dmg]);
  console.log(`made ${dmg} (volume "${volume}")`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
