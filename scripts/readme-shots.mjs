// Pictures for the README: starts test instances of the real app (English and Chinese UI, and every other language for the language picture),
// draws marks and writes notes through the real UI (the snapshots and REVIEW.md are made by the app itself), and saves raw footage to a work folder.
// The footage is real: sample picture, clip and screen are rendered with headless Edge, the interface is the app's own. Nothing is drawn by hand.
//
//   pwsh -File scripts/build-app.ps1 -Out tests/shell/.app -TestHooks     the shell-test build (its test hooks draw the capture overlay to PNG; it looks the same as the installed app)
//   node scripts/readme-shots.mjs [SnipToss.exe] [--only hero,marking,stills,video,capture,languages] [--locales en,zh-CN] [--work <folder>]
//
// Scenes (default: all): hero = the main window with the second sample (a poster) at 2×; marking = animation frames of the four tools and one note on several places;
// stills = the main window at 2×, REVIEW.md, the images "Copy as Images" makes; video = animation frames of a note on a moment and another on a mark;
// capture = the capture overlay step by step, drawn to PNG; languages = the main window in every interface language.
// Footage goes to --work (default %TEMP%\sniptoss-readme-footage). Doesn't touch the everyday settings (SNIPTOSS_SETTINGS points to a temp folder) or the clipboard.
// Opens windows on screen and closes them when done

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT, PROJECTS } from "./readme-shots/common.mjs";
import { capture, hero, languages, marking, prepareProject, stills, video } from "./readme-shots/scenes.mjs";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? undefined : args.splice(i, 2)[1];
};
const only = flag("only")?.split(",") ?? ["hero", "marking", "stills", "video", "capture", "languages"];
const locales = flag("locales")?.split(",") ?? ["en", "zh-CN"];
const work = flag("work") ?? join(tmpdir(), "sniptoss-readme-footage");
const exe = args[0] ?? join(ROOT, "tests", "shell", ".app", "SnipToss.exe");
if (!existsSync(exe)) {
  console.error(
    "Usage: node scripts/readme-shots.mjs [SnipToss.exe] [--only ...] [--locales ...] [--work <folder>]\nBuild the shell-test build first: pwsh -File scripts/build-app.ps1 -Out tests/shell/.app -TestHooks",
  );
  process.exit(2);
}
mkdirSync(work, { recursive: true });
const ctx = { exe, work, root: ROOT, tmp: join(work, "instances") };

try {
  await prepareProject(work);
  const perLocale = { hero, marking, stills, video, capture };
  for (const name of only) {
    if (name === "languages") await languages(ctx);
    else if (perLocale[name]) for (const locale of locales) await perLocale[name](ctx, locale);
    else throw new Error(`Unknown scene: ${name}`);
  }
} finally {
  rmSync(PROJECTS, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  rmSync(ctx.tmp, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}
