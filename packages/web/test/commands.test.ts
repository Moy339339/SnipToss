import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { commandKeyMap, withShortcut } from "../src/commandKeys";
import {
  activeKeys,
  clashOf,
  COMMANDS,
  commandById,
  commandsFor,
  isChanged,
  keyHint,
  keysOf,
  menuKeyOf,
  scopeOf,
  shortcutHint,
  type Bindings,
} from "../src/commands";
import { holdableKeys, HOLD_TOOL_COMMANDS } from "../src/holdKeys";
import { parseHint, parseKeyName } from "../src/menuModel";

const catalog = (lang: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../../i18n/locales/${lang}.json`, import.meta.url)), "utf8")) as Record<string, string>;

describe("the command table", () => {
  it("ids are unique", () => {
    const ids = COMMANDS.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it.each(["zh-CN", "en"])("every name, group and key message exists in %s", (lang) => {
    const c = catalog(lang);
    const ids = [
      ...COMMANDS.map((x) => x.label),
      ...COMMANDS.flatMap((x) => (x.fixed?.shown ?? []).filter((k) => k.startsWith("key."))),
      ...new Set(COMMANDS.map((x) => `sc.group.${x.group}`)),
    ];
    expect(ids.filter((id) => !(id in c))).toEqual([]);
  });
  it.each([false, true])("no two commands take the same key where both act (mac: %s)", (mac) => {
    const commands = commandsFor(mac);
    const clashes = commands
      .filter((x) => !x.fixed)
      .flatMap((x) =>
        activeKeys(x, {}).flatMap((k) => (clashOf(x, k, {}, commands) ? [`${x.id} ${k} ${clashOf(x, k, {}, commands)!.id}`] : [])),
      );
    expect(clashes).toEqual([]);
  });
  it("the shell's capture overlay has the same changeable commands and default keys as the table (app/Capture/CaptureKeys.cs)", () => {
    const src = readFileSync(fileURLToPath(new URL("../../../app/Capture/CaptureKeys.cs", import.meta.url)), "utf8");
    const table = src.slice(src.indexOf("Defaults ="), src.indexOf("];", src.indexOf("Defaults =")));
    const shell = [...table.matchAll(/\("(capture\.\w+)", \[([^\]]*)\]\)/g)].map((m) => [
      m[1],
      [...m[2].matchAll(/"([^"]+)"/g)].map((k) => k[1]),
    ]);
    const web = COMMANDS.filter((x) => x.group === "capture" && !x.fixed && !x.global).map((x) => [x.id, x.keys]);
    expect(shell.length).toBeGreaterThan(5);
    expect(shell).toEqual(web);
  });
  it("the Mac shell's capture overlay has them too (app-mac/Sources/SnipToss/CaptureKeys.swift)", () => {
    const src = readFileSync(fileURLToPath(new URL("../../../app-mac/Sources/SnipToss/CaptureKeys.swift", import.meta.url)), "utf8");
    const start = src.indexOf("static let defaults");
    const table = src.slice(start, src.indexOf("\n    ]", start));
    const shell = [...table.matchAll(/\("(capture\.\w+)", \[([^\]]*)\]\)/g)].map((m) => [
      m[1],
      [...m[2].matchAll(/"([^"]+)"/g)].map((k) => k[1]),
    ]);
    const web = COMMANDS.filter((x) => x.group === "capture" && !x.fixed && !x.global).map((x) => [x.id, x.keys]);
    expect(shell.length).toBeGreaterThan(5);
    expect(shell).toEqual(web);
  });
  it("on the Mac the app menu's keys are taken everywhere, ⌘Q on the capture overlay too, and the overlay's ⌘W and ⌘. cancel", () => {
    const mac = commandsFor(true);
    expect(clashOf(commandById("file.addFiles"), "Ctrl+H", {}, mac)?.id).toBe("app.hide");
    expect(clashOf(commandById("file.addFiles"), "Ctrl+Alt+H", {}, mac)?.id).toBe("app.hideOthers");
    expect(clashOf(commandById("file.addFiles"), "Ctrl+Q", {}, mac)?.id).toBe("app.quit");
    expect(clashOf(commandById("capture.rect"), "Ctrl+Q", {}, mac)?.id).toBe("app.quit");
    // The overlay takes every ⌘ key itself but ⌘Q, so ⌘H is free there
    expect(clashOf(commandById("capture.rect"), "Ctrl+H", {}, mac)).toBeUndefined();
    expect(clashOf(commandById("capture.rect"), "Ctrl+W", {}, mac)?.id).toBe("capture.cancelMac");
    expect(clashOf(commandById("capture.rect"), "Ctrl+.", {}, mac)?.id).toBe("capture.cancelMac");
    expect(clashOf(commandById("capture.rect"), "Escape", {}, mac)?.id).toBe("capture.cancelMac");
    // Windows has none of these
    const windows = commandsFor(false);
    expect(windows.filter((x) => ["app.hide", "app.hideOthers", "app.quit", "capture.cancelMac"].includes(x.id))).toEqual([]);
    expect(clashOf(commandById("capture.rect"), "Ctrl+W", {}, windows)).toBeUndefined();
    expect(clashOf(commandById("file.addFiles"), "Ctrl+Q", {}, windows)).toBeUndefined();
    expect(clashOf(commandById("capture.rect"), "Escape", {}, windows)?.id).toBe("capture.cancel");
  });
  it("the capture overlay is its own window: its keys do not clash with the main window's", () => {
    expect(clashOf(commandById("capture.rect"), "R", {})).toBeUndefined();
    expect(scopeOf(commandById("capture.rect"))).toBe("capture");
  });
  it("keys used while writing a note clash with the main window's (both act then)", () => {
    // Ctrl+Enter saves the note: a main-window command cannot take it
    expect(clashOf(commandById("file.addFiles"), "Ctrl+Enter", {})?.id).toBe("note.save");
    // The range keys act in the composer, which is open over the main window
    expect(clashOf(commandById("play.rangeIn"), "V", {})?.id).toBe("tool.select");
  });
  it("a video key never clashes with an image key", () => {
    expect(clashOf(commandById("play.prevFrame"), "ArrowLeft", {})).toBeUndefined();
  });
  it("a changed key frees the old one and takes the new one", () => {
    const b: Bindings = { "tool.rect": ["Q"] };
    expect(clashOf(commandById("file.addFiles"), "R", b)).toBeUndefined();
    expect(clashOf(commandById("file.addFiles"), "Q", b)?.id).toBe("tool.rect");
  });
  it("aliases act while unchanged and go once the keys are changed", () => {
    const zoom = commandById("view.zoomIn");
    expect(activeKeys(zoom, {})).toEqual(["Ctrl++", "Ctrl+="]);
    expect(activeKeys(zoom, { "view.zoomIn": ["Ctrl+Shift+Z"] })).toEqual(["Ctrl+Shift+Z"]);
    expect(keysOf(zoom, {})).toEqual(["Ctrl++"]);
  });
  it("the same keys as the default in another order still count as changed; the same keys in the same order do not", () => {
    const redo = commandById("edit.redo");
    expect(isChanged(redo, { "edit.redo": ["Ctrl+Shift+Z", "Ctrl+Y"] })).toBe(false);
    expect(isChanged(redo, { "edit.redo": ["Ctrl+Y", "Ctrl+Shift+Z"] })).toBe(true);
  });
});

describe("keys of commands", () => {
  it("commandKeyMap maps every active key of a command to its handler", () => {
    const fit = () => {};
    const map = commandKeyMap({ "view.fit": fit }, {});
    expect(Object.keys(map).sort()).toEqual(["Ctrl+0", "Shift+1"]);
    expect(map["Shift+1"]).toBe(fit);
  });
  it("commandKeyMap follows changed keys; a command with no keys has none", () => {
    const map = commandKeyMap({ "view.fit": () => {}, "file.refresh": () => {} }, { "view.fit": ["F"], "file.refresh": [] });
    expect(Object.keys(map)).toEqual(["F"]);
  });
  it("menus write keys with spaces and arrows as symbols", () => {
    expect(keyHint("Ctrl+Shift+O")).toBe("Ctrl Shift O");
    expect(keyHint("Ctrl++")).toBe("Ctrl +");
    expect(keyHint("Shift+ArrowLeft")).toBe("Shift ←");
    expect(keyHint("Ctrl+\\")).toBe("Ctrl \\");
    expect(shortcutHint("file.addFolder", {})).toBe("Ctrl Shift O");
    expect(shortcutHint("file.addFolder", { "file.addFolder": [] })).toBeUndefined();
    expect(shortcutHint("file.addFolder", { "file.addFolder": ["Alt+F2"] })).toBe("Alt F2");
  });
  it("the hint of every command is one the Mac's native menu reads as a shortcut", () => {
    for (const cmd of COMMANDS.filter((x) => !x.fixed && x.keys.length)) {
      const hint = shortcutHint(cmd.id as Parameters<typeof shortcutHint>[0], {})!;
      // "?" is drawn as text on the right of the item rather than as a key equivalent
      if (hint === "?") continue;
      expect(parseHint(hint).shortcut, `${cmd.id}: ${hint}`).toBeDefined();
    }
  });
  it("the native menu gives zoom in ⌘= while it is unchanged, and the changed key after", () => {
    expect(menuKeyOf("view.zoomIn", {})).toBe("Ctrl+=");
    expect(parseKeyName(menuKeyOf("view.zoomIn", {})!)).toEqual({ key: "=", cmd: true, alt: false, shift: false });
    expect(menuKeyOf("view.zoomIn", { "view.zoomIn": ["Ctrl+I"] })).toBe("Ctrl+I");
    expect(menuKeyOf("view.zoomIn", { "view.zoomIn": [] })).toBeUndefined();
    expect(menuKeyOf("play.toggle", {})).toBe("Space");
  });
  it("tooltips put the keys after a fullwidth space, and leave them out when there are none", () => {
    expect(withShortcut("Settings", ["Ctrl ,"])).toBe(`Settings${String.fromCharCode(0x3000)}Ctrl ,`);
    expect(withShortcut("Speed", [",", "."])).toBe(`Speed${String.fromCharCode(0x3000)}, .`);
    expect(withShortcut("Speed", ["", "."])).toBe(`Speed${String.fromCharCode(0x3000)}.`);
    expect(withShortcut("Settings", [""])).toBe("Settings");
  });
  it("only keys without modifiers can be held", () => {
    expect(holdableKeys(HOLD_TOOL_COMMANDS, {})).toEqual(["C", "R", "B", "A"]);
    expect(holdableKeys(["tool.hand"], { "tool.hand": ["Ctrl+H", "G"] })).toEqual(["G"]);
    expect(holdableKeys(["tool.hand"], { "tool.hand": [] })).toEqual([]);
  });
});
