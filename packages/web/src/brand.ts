// The product name follows the UI language: wherever users see it, use the message brand.name (Chinese "超级批注"; other languages use the
// English name SnipToss, for a worldwide audience). The technical name is the English name SnipToss (the .sniptoss/ folder, the sniptoss
// command, SnipToss.exe, code identifiers; it replaced the earlier pinyin name pizhu, docs/adr/0007-rename.md). After changing the
// Chinese name, rerun node scripts/build-brand-font.mjs: the font used for the logo at the top of the library contains only those
// characters
/** The English name (technical name), used in diagnostic info, issue reports, and before the messages have loaded (the outermost error page) */
export const APP_NAME_EN = "SnipToss";
/** Author credit and license; when changing, change the root LICENSE, package.json and csproj together */
export const AUTHOR = "MoyGoldenAge";
export const LICENSE_NAME = "MIT";
/** Project homepage, full license text, reporting issues (GitHub Issues) */
export const HOMEPAGE = "https://github.com/Moy339339/SnipToss";
export const LICENSE_URL = `${HOMEPAGE}/blob/main/LICENSE`;
export const ISSUES_URL = `${HOMEPAGE}/issues/new`;

declare const __APP_VERSION__: string;
declare const __UI_BUILT__: string;

/** Version of the UI (written in from the root package.json at build time). The shell's version is in appInfo.version, and the two should match */
export const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
/** When the UI was built (ISO) */
export const UI_BUILT = typeof __UI_BUILT__ === "string" ? __UI_BUILT__ : "";

/**
 * How a version is written for people. During testing it is labelled as a beta series, and a release version is used once it is mature:
 * the version is 1.0.0-beta.N (the Nth beta before the 1.0 release) and is shown as "Beta N"; once mature it becomes a release version
 * from 1.0.0 on, shown as "v1.0.0"
 */
export function versionLabel(v: string): string {
  const beta = /^\d+\.\d+\.\d+-beta\.(\d+)$/.exec(v);
  return beta ? `Beta ${beta[1]}` : `v${v}`;
}
/** Whether this is a beta */
export const IS_BETA = /-beta\.\d+$/.test(APP_VERSION);

/**
 * The version as the "Version …" line of Settings → About writes it. A Mac package also has a build number (appInfo.build), and the
 * version is then written the Mac way, as Finder's Get Info does: x.y.z (build), e.g. "1.0.0 (44)"; otherwise the whole version
 */
export function versionWithBuild(v: string, build?: string): string {
  return build ? `${v.replace(/-.*$/, "")} (${build})` : v;
}

/** Stored as UTC (2026-10-16T00:42:00Z) and shown as local time (e.g. 10-16 01:42 at UTC+1) */
export function shortTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
