// The dates a package shows (Finder's Get Info, the entries of the zip, the items on the disk image) are the release day at 12:00 UTC,
// not the moment of the build, which would only tell when and where it was made. The release day is the one the UI shows (__RELEASED__ in
// packages/web/vite.config.ts): the date in US Pacific time. Used by package-app.mjs (after signing: the signature covers the files'
// contents, not their dates) and package-dmg.mjs
import { execFileSync } from "node:child_process";
import { lstatSync, lutimesSync, readdirSync, utimesSync } from "node:fs";
import { join } from "node:path";

/** The release day at 12:00 UTC */
export function releaseNoon(now = new Date()) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(now);
  return new Date(`${day}T12:00:00Z`);
}

/** The path and everything under it, symbolic links themselves (not what they point to) */
function walk(path, found = []) {
  const stat = lstatSync(path);
  found.push({ path, link: stat.isSymbolicLink() });
  if (stat.isDirectory()) for (const name of readdirSync(path)) walk(join(path, name), found);
  return found;
}

/**
 * Sets the creation, modification and access dates of the path and everything under it to `when`. The creation date (shown by Finder,
 * kept by a copy) has no call in Node: SetFile sets it, in the time zone of its environment, so TZ is UTC for it. Then the modification
 * and access dates; setting a file's dates doesn't change its folder's
 */
export function pinTimes(root, when = releaseNoon()) {
  const items = walk(root);
  const pad = (n) => String(n).padStart(2, "0");
  const setFileDate = `${pad(when.getUTCMonth() + 1)}/${pad(when.getUTCDate())}/${when.getUTCFullYear()} ${pad(when.getUTCHours())}:${pad(when.getUTCMinutes())}:${pad(when.getUTCSeconds())}`;
  const env = { ...process.env, TZ: "UTC" };
  for (const link of [false, true]) {
    const paths = items.filter((i) => i.link === link).map((i) => i.path);
    // In batches, to stay under the length of a command line
    for (let at = 0; at < paths.length; at += 200)
      execFileSync("/usr/bin/SetFile", [...(link ? ["-P"] : []), "-d", setFileDate, ...paths.slice(at, at + 200)], {
        env,
        stdio: "inherit",
      });
  }
  for (const { path, link } of items) (link ? lutimesSync : utimesSync)(path, when, when);
  return items.length;
}
