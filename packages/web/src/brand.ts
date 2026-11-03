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
declare const __RELEASED__: string;

/** Version of the UI (written in from the root package.json at build time). The shell's version is in appInfo.version, and the two should match */
export const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
/** The release date of this build, "2026-11-03" (vite.config.ts: the day in US Pacific time, no time of day) */
export const RELEASED = typeof __RELEASED__ === "string" ? __RELEASED__ : "";

/**
 * How a version is written for people (semantic versioning): every release x.y.z is preceded by its own beta series x.y.z-beta.N, N counting
 * from 1 for each version, shown as "v1.1.0 Beta 2"; the release itself is shown as "v1.1.0"
 */
export function versionLabel(v: string): string {
  const beta = /^(\d+\.\d+\.\d+)-beta\.(\d+)$/.exec(v);
  return beta ? `v${beta[1]} Beta ${beta[2]}` : `v${v}`;
}
/** Whether this is a beta */
export const IS_BETA = /-beta\.\d+$/.test(APP_VERSION);

/** The version as the "Version …" line of Settings → About writes it: versionLabel without the "v" ("1.1.0 Beta 2", "1.1.0") */
export const versionText = (v: string) => versionLabel(v).slice(1);

/** A release date ("2026-11-03") as people read it, "Nov 3, 2026", the same in every language; "" when there is none */
export function releaseDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(d);
}
