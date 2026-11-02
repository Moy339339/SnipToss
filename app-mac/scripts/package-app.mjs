// Puts the built Mac shell into SnipToss.app and zips it: a package for trying the app on a Mac, not a release. It is signed with the
// project's self-signed certificate when the build has it (see below), otherwise ad hoc.
// Runs on macOS after `swift build -c release`, `npm run build` and build-resources.mjs:
//   node app-mac/scripts/package-app.mjs <output folder> [build number]
// Writes <output folder>/SnipToss.app and <output folder>/SnipToss-<version>-mac-<universal or the one architecture>.zip (named like the
// Windows packages, see package-dmg.mjs).
// The version is the one the UI was built with: SNIPTOSS_UI_VERSION when set (a trial package: <package.json version>-beta.<build>, shown
// as "v<x.y.z> Beta <build>"), otherwise the root package.json's. The bundle keeps it whole in SnipTossVersion (what appInfo reports, so the UI
// finds its own version there); CFBundleShortVersionString is its x.y.z part and CFBundleVersion the build number, which macOS shows as
// "1.0.0 (44)"

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const out = resolve(process.argv[2] ?? join(root, "app-mac", ".build", "package"));
const build = process.argv[3] ?? "0";
const version = process.env.SNIPTOSS_UI_VERSION || JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
/** The x.y.z part: macOS expects only numbers in CFBundleShortVersionString */
const shortVersion = version.replace(/-.*$/, "");

/** The identifier macOS knows the app by (the screen recording permission is kept under it): never change it */
const BUNDLE_ID = "io.github.moy339339.sniptoss";
const NAME = "SnipToss";

const sources = {
  // The shell: SNIPTOSS_SHELL_BIN when set (the CI's build for both Apple silicon and Intel, `swift build --arch arm64 --arch x86_64`),
  // otherwise the native release build
  binary: process.env.SNIPTOSS_SHELL_BIN || join(root, "app-mac", ".build", "release", NAME),
  ui: join(root, "packages", "web", "dist"),
  resources: join(root, "app-mac", ".build", "resources"),
  icon: join(root, "design", "icon", "sniptoss-1024.png"),
};
for (const [what, path] of Object.entries(sources)) {
  if (!existsSync(path)) throw new Error(`missing ${what}: ${path}`);
}

const run = (command, args) => execFileSync(command, args, { stdio: ["ignore", "inherit", "inherit"] });

/**
 * The root THIRD-PARTY-NOTICES.txt (scripts/build-notices.mjs) without the components only the Windows app ships: their header says
 * "Only in: Windows" (the same rule as noticesFor in packages/web/src/notices.ts). Their sections go, and their lines in the list at the top
 */
function macNotices(text) {
  const RULE = "=".repeat(78);
  const lines = text.split("\n");
  const heads = [];
  for (let i = 0; i + 4 < lines.length; i++) {
    if (lines[i] !== RULE || !lines[i + 2].startsWith("License: ") || !lines[i + 3].startsWith("Source: ")) continue;
    if (lines[i + 4] === RULE) heads.push({ at: i, only: undefined });
    else if (lines[i + 4].startsWith("Only in: ") && lines[i + 5] === RULE) heads.push({ at: i, only: lines[i + 4].slice(9).split(", ") });
  }
  if (heads.length === 0) throw new Error("THIRD-PARTY-NOTICES.txt has no sections: has its format changed?");
  const leftOut = (h) => h.only && !h.only.includes("macOS");
  // The list at the top says "- <name version> (<license>)"
  const listed = new Set(heads.filter(leftOut).map((h) => `- ${lines[h.at + 1]} (${lines[h.at + 2].slice("License: ".length)})`));
  const kept = lines.slice(0, heads[0].at).filter((line) => !listed.has(line));
  // A section runs from its header to the next one (the blank line between them is its last line)
  heads.forEach((h, k) => {
    if (!leftOut(h)) kept.push(...lines.slice(h.at, heads[k + 1]?.at ?? lines.length));
  });
  return kept.join("\n");
}

const app = join(out, `${NAME}.app`);
rmSync(app, { recursive: true, force: true });
const contents = join(app, "Contents");
mkdirSync(join(contents, "MacOS"), { recursive: true });
mkdirSync(join(contents, "Resources"), { recursive: true });

cpSync(sources.binary, join(contents, "MacOS", NAME));
const architectures = execFileSync("lipo", ["-archs", join(contents, "MacOS", NAME)], { encoding: "utf8" }).trim();
// The UI in Resources/ui (uiDirectory in AppDelegate.swift); the formatter and catalogs at the top of Resources (AppResources)
cpSync(sources.ui, join(contents, "Resources", "ui"), { recursive: true });
cpSync(sources.resources, join(contents, "Resources"), { recursive: true });
// The third-party notices of what this package holds (the About page shows the same, filtered in the UI)
writeFileSync(
  join(contents, "Resources", "THIRD-PARTY-NOTICES.txt"),
  macNotices(readFileSync(join(root, "THIRD-PARTY-NOTICES.txt"), "utf8")),
);

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
/** A plist value: string, boolean, array or dictionary, indented by depth */
const plistValue = (value, depth) => {
  const pad = "  ".repeat(depth);
  if (typeof value === "boolean") return `${pad}<${value}/>`;
  if (typeof value === "string") return `${pad}<string>${escape(value)}</string>`;
  if (Array.isArray(value)) return `${pad}<array>\n${value.map((v) => plistValue(v, depth + 1)).join("\n")}\n${pad}</array>`;
  const body = Object.entries(value).map(([k, v]) => `${pad}  <key>${k}</key>\n${plistValue(v, depth + 1)}`);
  return `${pad}<dict>\n${body.join("\n")}\n${pad}</dict>`;
};
const entry = (key, value) => `  <key>${key}</key>\n${plistValue(value, 1)}`;
/**
 * The file types the app opens (MaterialKinds.swift) and folders: Finder lists the app under Open With, and files or folders dropped onto
 * its Dock icon reach application(_:open:). Rank Alternate: the app never becomes the default app for a type. APNG is public.png, the JPEG
 * spellings are public.jpeg; a type macOS does not declare (Matroska) is still matched by the extension
 */
const DOCUMENT_TYPES = [
  {
    CFBundleTypeName: "Image",
    CFBundleTypeRole: "Viewer",
    LSHandlerRank: "Alternate",
    LSItemContentTypes: [
      "public.png",
      "public.jpeg",
      "org.webmproject.webp",
      "com.compuserve.gif",
      "com.microsoft.bmp",
      "public.avif",
      "com.microsoft.ico",
      "public.svg-image",
      "public.tiff",
      "public.heic",
      "public.heif",
    ],
  },
  {
    CFBundleTypeName: "Video",
    CFBundleTypeRole: "Viewer",
    LSHandlerRank: "Alternate",
    LSItemContentTypes: ["public.mpeg-4", "org.webmproject.webm", "com.apple.quicktime-movie", "com.apple.m4v-video", "org.matroska.mkv"],
    CFBundleTypeExtensions: ["mkv"],
  },
  { CFBundleTypeName: "Folder", CFBundleTypeRole: "Viewer", LSHandlerRank: "Alternate", LSItemContentTypes: ["public.folder"] },
];
const info = {
  CFBundleDevelopmentRegion: "en",
  CFBundleExecutable: NAME,
  CFBundleIdentifier: BUNDLE_ID,
  CFBundleName: NAME,
  CFBundleDisplayName: NAME,
  CFBundlePackageType: "APPL",
  CFBundleShortVersionString: shortVersion,
  CFBundleVersion: build,
  SnipTossVersion: version,
  CFBundleIconFile: NAME,
  LSMinimumSystemVersion: "14.0",
  LSApplicationCategoryType: "public.app-category.productivity",
  NSHighResolutionCapable: true,
  NSPrincipalClass: "NSApplication",
  NSHumanReadableCopyright: "© 2026 MoyGoldenAge",
  // The name shown in Finder, the Dock, the menu bar and System Settings follows the system language (the strings below)
  LSHasLocalizedDisplayName: true,
  CFBundleDocumentTypes: DOCUMENT_TYPES,
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
const platform = `mac-${architectures.split(/\s+/).length > 1 ? "universal" : architectures}`;
const zip = join(out, `${NAME}-${version}-${platform}.zip`);
rmSync(zip, { force: true });
run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, zip]);
console.log(`packaged ${app} (${BUNDLE_ID} ${version} build ${build}, ${architectures}) and ${zip}`);
