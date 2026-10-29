// Puts the built Mac shell into SnipToss.app and zips it: a package for trying the app on a Mac, not a release. It is signed with the
// project's self-signed certificate when the build has it (see below), otherwise ad hoc.
// Runs on macOS after `swift build -c release`, `npm run build` and build-resources.mjs:
//   node app-mac/scripts/package-app.mjs <output folder> [build number]
// Writes <output folder>/SnipToss.app and <output folder>/SnipToss-mac-<version>-<build>.zip

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const out = resolve(process.argv[2] ?? join(root, "app-mac", ".build", "package"));
const build = process.argv[3] ?? "0";
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;

/** The identifier macOS knows the app by (the screen recording permission is kept under it): never change it */
const BUNDLE_ID = "io.github.moy339339.sniptoss";
const NAME = "SnipToss";

const sources = {
  binary: join(root, "app-mac", ".build", "release", NAME),
  ui: join(root, "packages", "web", "dist"),
  resources: join(root, "app-mac", ".build", "resources"),
  icon: join(root, "design", "icon", "sniptoss-1024.png"),
};
for (const [what, path] of Object.entries(sources)) {
  if (!existsSync(path)) throw new Error(`missing ${what}: ${path}`);
}

const run = (command, args) => execFileSync(command, args, { stdio: ["ignore", "inherit", "inherit"] });

const app = join(out, `${NAME}.app`);
rmSync(app, { recursive: true, force: true });
const contents = join(app, "Contents");
mkdirSync(join(contents, "MacOS"), { recursive: true });
mkdirSync(join(contents, "Resources"), { recursive: true });

cpSync(sources.binary, join(contents, "MacOS", NAME));
// The UI in Resources/ui (uiDirectory in AppDelegate.swift); the formatter and catalogs at the top of Resources (AppResources)
cpSync(sources.ui, join(contents, "Resources", "ui"), { recursive: true });
cpSync(sources.resources, join(contents, "Resources"), { recursive: true });

// The icon: every size the system asks for, made from the 1024 master
const iconset = join(out, `${NAME}.iconset`);
rmSync(iconset, { recursive: true, force: true });
mkdirSync(iconset);
for (const size of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    const pixels = String(size * scale);
    const name = scale === 1 ? `icon_${size}x${size}.png` : `icon_${size}x${size}@2x.png`;
    run("sips", ["-z", pixels, pixels, sources.icon, "--out", join(iconset, name)]);
  }
}
run("iconutil", ["-c", "icns", iconset, "-o", join(contents, "Resources", `${NAME}.icns`)]);
rmSync(iconset, { recursive: true, force: true });

const escape = (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const entry = (key, value) =>
  typeof value === "boolean" ? `  <key>${key}</key>\n  <${value}/>` : `  <key>${key}</key>\n  <string>${escape(value)}</string>`;
const info = {
  CFBundleDevelopmentRegion: "en",
  CFBundleExecutable: NAME,
  CFBundleIdentifier: BUNDLE_ID,
  CFBundleName: NAME,
  CFBundleDisplayName: NAME,
  CFBundlePackageType: "APPL",
  CFBundleShortVersionString: version,
  CFBundleVersion: build,
  CFBundleIconFile: NAME,
  LSMinimumSystemVersion: "14.0",
  LSApplicationCategoryType: "public.app-category.productivity",
  NSHighResolutionCapable: true,
  NSPrincipalClass: "NSApplication",
  NSHumanReadableCopyright: "© 2026 MoyGoldenAge",
  // The name shown in Finder, the Dock, the menu bar and System Settings follows the system language (the strings below)
  LSHasLocalizedDisplayName: true,
};
/** The product name by system language, the same as the Windows installer's shortcuts and the message brand.name; SnipToss elsewhere */
const LOCALIZED_NAMES = { en: NAME, "zh-Hans": "超级批注", "zh-Hant": "超級批註" };
writeFileSync(
  join(contents, "Info.plist"),
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
    '<plist version="1.0">\n<dict>\n' +
    Object.entries(info)
      .map(([key, value]) => entry(key, value))
      .join("\n") +
    "\n</dict>\n</plist>\n",
);
writeFileSync(join(contents, "PkgInfo"), "APPL????");
run("plutil", ["-lint", join(contents, "Info.plist")]);
for (const [language, name] of Object.entries(LOCALIZED_NAMES)) {
  const dir = join(contents, "Resources", `${language}.lproj`);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "InfoPlist.strings");
  writeFileSync(file, `"CFBundleDisplayName" = "${name}";\n"CFBundleName" = "${name}";\n`);
  run("plutil", ["-lint", file]);
}

// Signed with the project's own certificate when the build has it (SNIPTOSS_SIGN_IDENTITY: its SHA-1, SNIPTOSS_SIGN_KEYCHAIN: the keychain
// it was imported into, see mac.yml). Then the designated requirement names the certificate, not this build's code hash, and macOS keeps
// the Screen Recording permission when a new build replaces the old one. Without it, ad hoc ("-"): an Apple silicon Mac runs only signed
// code, and the bundle changed after the linker signed the binary
const identity = process.env.SNIPTOSS_SIGN_IDENTITY;
const keychain = process.env.SNIPTOSS_SIGN_KEYCHAIN;
run("codesign", [
  "--force",
  "--sign",
  identity || "-",
  ...(identity && keychain ? ["--keychain", keychain] : []),
  "--identifier",
  BUNDLE_ID,
  app,
]);
run("codesign", ["--verify", "--strict", "--verbose=2", app]);
const requirement = execFileSync("codesign", ["-d", "-r-", app], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
console.log(`designated requirement: ${requirement.trim()}`);
if (identity && !/certificate leaf = H"/.test(requirement))
  throw new Error("signed with the certificate, but the requirement does not name it");

// ditto keeps what a plain zip would lose (the executable bit, the signature's extended attributes)
const zip = join(out, `${NAME}-mac-${version}-${build}.zip`);
rmSync(zip, { force: true });
run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, zip]);
console.log(`packaged ${app} (${BUNDLE_ID} ${version} build ${build}) and ${zip}`);
