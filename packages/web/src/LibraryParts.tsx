import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useIntl, type IntlShape } from "react-intl";
import { pathSep } from "@sniptoss/core";
import { APP_VERSION, IS_BETA, shortTime, UI_BUILT, versionLabel } from "./brand";
import type { AppInfo } from "./host";
import type { FolderNote } from "./library";

// Small display parts of the library (split out of LibraryPanel): how paths and names are shortened when they don't fit, the gray line at
// the end of a folder, the version at the bottom left

/** How many extensions / folder names to list: at most 4, with "…" if there are more */
export const shortList = (intl: IntlShape, xs: string[]) =>
  xs.slice(0, 4).join(intl.formatMessage({ id: "list.sep" })) + (xs.length > 4 ? "…" : "");

let measurer: CanvasRenderingContext2D | null | undefined;

/**
 * When a path doesn't fit, whole segments are dropped from the start: "…\projects\examples". Projects often share a drive and a user
 * folder, so the beginnings look alike and the tail is what tells them apart; it also never cuts a folder name in half (a CSS
 * ellipsis cuts in the middle of a word). It is recomputed when the sidebar is resized; only when even the last segment doesn't fit is
 * it left to CSS to truncate at the end.
 */
export function TailPath(props: { path: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(props.path);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      measurer ??= document.createElement("canvas").getContext("2d");
      if (!measurer) return;
      const cs = getComputedStyle(el);
      measurer.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const room = el.clientWidth;
      const sep = pathSep(props.path);
      const parts = props.path.split(sep);
      let text = props.path;
      for (let i = 1; i < parts.length && measurer.measureText(text).width > room; i++) text = `…${sep}${parts.slice(i).join(sep)}`;
      setShown(text);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [props.path]);
  return (
    <span ref={ref} className="lib-sub">
      {shown}
    </span>
  );
}

/**
 * When a name doesn't fit, the middle is dropped and the end and extension are kept: "banner_home…mer_v1.png" (in a deep folder a column
 * of "banner_home…" can't be told apart). Cut by measured text width (like TailPath): a CSS ellipsis can only cut at whole characters, and
 * joining a front and a back part leaves a gap in the middle. The full name is in the row's hover tooltip
 */
export function MidName({ name }: { name: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(name);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      measurer ??= document.createElement("canvas").getContext("2d");
      if (!measurer) return;
      const cs = getComputedStyle(el);
      measurer.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const room = el.clientWidth;
      if (measurer.measureText(name).width <= room) return setShown(name);
      // Keep the extension + 6 characters before it at the end; by character (never cut an emoji in half)
      const chars = Array.from(name);
      const dot = name.lastIndexOf(".");
      const keep = Math.min(chars.length - 1, (dot > 0 ? Array.from(name.slice(dot)).length : 0) + 6);
      const tail = chars.slice(-keep).join("");
      const head = chars.slice(0, chars.length - keep);
      // How much of the front to keep: binary search for the longest piece that fits; if even "…" + the end doesn't fit, CSS truncates at the end
      let lo = 0;
      let hi = head.length;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (measurer.measureText(`${head.slice(0, mid).join("")}…${tail}`).width <= room) lo = mid;
        else hi = mid - 1;
      }
      setShown(`${head.slice(0, lo).join("")}…${tail}`);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [name]);
  return (
    <span ref={ref} className="lib-name">
      {shown}
    </span>
  );
}

/**
 * The gray line at the end of a folder entry: unsupported files and skipped folders (they used to be silently left out, with no hint
 * where they went)
 */
export function NoteLine({ note, depth }: { note: FolderNote; depth: number }) {
  const intl = useIntl();
  const list = (xs: string[]) => shortList(intl, xs);
  return (
    <div className="lib-note" style={{ "--depth": depth } as CSSProperties}>
      {note.others && (
        <span title={intl.formatMessage({ id: "library.note.othersTitle" })}>
          {intl.formatMessage({ id: "library.note.others" }, { count: note.others.count, exts: list(note.others.exts) })}
        </span>
      )}
      {note.moreOff && (
        <span title={intl.formatMessage({ id: "library.note.moreOffTitle" })}>
          {intl.formatMessage({ id: "library.note.moreOff" }, { count: note.moreOff.count, exts: list(note.moreOff.exts) })}
        </span>
      )}
      {note.skipped && (
        <span title={intl.formatMessage({ id: "library.note.skippedTitle" })}>
          {intl.formatMessage({ id: "library.note.skipped" }, { names: list(note.skipped) })}
        </span>
      )}
    </div>
  );
}

/**
 * The version at the bottom left: users check it to confirm they are on the latest build.
 * If the UI and the app itself are not from the same build (only the UI was swapped, or only the shell was compiled) it turns red,
 * and the tooltip says when each side was built
 */
export function VersionTag({ info }: { info?: AppInfo }) {
  const intl = useIntl();
  const mismatch = !!info && info.version !== APP_VERSION;
  const title = [
    `${intl.formatMessage({ id: "brand.name" })} ${versionLabel(APP_VERSION)}${IS_BETA ? intl.formatMessage({ id: "settings.about.beta" }) : ""} · ${intl.formatMessage({ id: "settings.about.version" }, { version: APP_VERSION })}`,
    intl.formatMessage({ id: "settings.about.uiBuilt" }, { time: shortTime(UI_BUILT) }),
    info ? intl.formatMessage({ id: "library.version.shell" }, { version: versionLabel(info.version), time: shortTime(info.built) }) : "",
    mismatch ? intl.formatMessage({ id: "app.version.mismatchHint" }) : "",
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <span className={`app-version${mismatch ? " is-mismatch" : ""}`} title={title}>
      {versionLabel(APP_VERSION)}
      {mismatch && intl.formatMessage({ id: "library.version.mismatch" }, { version: versionLabel(info.version) })}
    </span>
  );
}
