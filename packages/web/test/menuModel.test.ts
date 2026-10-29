import { describe, expect, it, vi } from "vitest";
import type { MenuItem } from "../src/Menu";
import type { TopMenu } from "../src/MenuBar";
import { NativeMenuSync, parseHint, parseKeyName, serializeMenus, type SetMenus } from "../src/menuModel";

const top = (label: string, items: (MenuItem | "-")[]): TopMenu => ({ label, key: "", items: () => items });

describe("parseHint: the shortcut a menu item shows on its right", () => {
  it.each([
    ["Ctrl O", { key: "o", cmd: true, alt: false, shift: false }],
    ["Ctrl Shift O", { key: "o", cmd: true, alt: false, shift: true }],
    ["Ctrl Alt B", { key: "b", cmd: true, alt: true, shift: false }],
    ["Ctrl ,", { key: ",", cmd: true, alt: false, shift: false }],
    ["Ctrl +", { key: "+", cmd: true, alt: false, shift: false }],
    ["Ctrl -", { key: "-", cmd: true, alt: false, shift: false }],
    ["Ctrl \\", { key: "\\", cmd: true, alt: false, shift: false }],
    ["Ctrl ↑", { key: "ArrowUp", cmd: true, alt: false, shift: false }],
    ["Ctrl ↓", { key: "ArrowDown", cmd: true, alt: false, shift: false }],
    ["Shift 1", { key: "1", cmd: false, alt: false, shift: true }],
    ["Shift ←", { key: "ArrowLeft", cmd: false, alt: false, shift: true }],
    ["F5", { key: "F5", cmd: false, alt: false, shift: false }],
    ["Enter", { key: "Enter", cmd: false, alt: false, shift: false }],
    ["Delete", { key: "Delete", cmd: false, alt: false, shift: false }],
    ["[", { key: "[", cmd: false, alt: false, shift: false }],
    ["T", { key: "t", cmd: false, alt: false, shift: false }],
    ["Home", { key: "Home", cmd: false, alt: false, shift: false }],
  ])("%s", (hint, shortcut) => {
    expect(parseHint(hint)).toEqual({ shortcut });
  });

  it("text that is not one shortcut stays text", () => {
    expect(parseHint("? / F1")).toEqual({ hintText: "? / F1" });
    expect(parseHint("3 checked")).toEqual({ hintText: "3 checked" });
    expect(parseHint("Leertaste")).toEqual({ hintText: "Leertaste" });
    expect(parseHint("Ctrl")).toEqual({ hintText: "Ctrl" });
  });

  it("nothing to show", () => {
    expect(parseHint(undefined)).toEqual({});
    expect(parseHint("")).toEqual({});
  });
});

describe("parseKeyName: the key name an item presses (pressKey)", () => {
  it.each([
    ["Space", { key: "Space", cmd: false, alt: false, shift: false }],
    ["Shift+ArrowLeft", { key: "ArrowLeft", cmd: false, alt: false, shift: true }],
    ["Ctrl+=", { key: "=", cmd: true, alt: false, shift: false }],
    ["Ctrl+-", { key: "-", cmd: true, alt: false, shift: false }],
    ["Ctrl++", { key: "+", cmd: true, alt: false, shift: false }],
    ["J", { key: "j", cmd: false, alt: false, shift: false }],
    [",", { key: ",", cmd: false, alt: false, shift: false }],
  ])("%s", (name, shortcut) => {
    expect(parseKeyName(name)).toEqual(shortcut);
  });
});

describe("serializeMenus", () => {
  const sample = (calls: string[]): TopMenu[] => [
    top("File", [
      { label: "Add Files…", hint: "Ctrl O", onClick: () => calls.push("add") },
      { label: "Find", hint: "Ctrl P", title: "Filter the library", disabled: true, onClick: () => calls.push("find") },
      "-",
      { label: "Settings…", hint: "Ctrl ,", only: "windows", onClick: () => calls.push("settings") },
      { label: "Exit", only: "windows", onClick: () => calls.push("exit") },
    ]),
    top("Edit", [
      { label: "Undo", hint: "Ctrl Z", role: "undo", onClick: () => calls.push("undo"), disabled: false },
      { label: "Redo", hint: "Ctrl Shift Z", role: "redo", onClick: () => calls.push("redo"), disabled: true },
      { label: "Uncheck All", hint: "3 checked", onClick: () => calls.push("uncheck") },
    ]),
    top("View", [
      { label: "Zoom in", hint: "Ctrl +", keys: "Ctrl+=", onClick: () => calls.push("zoom") },
      { label: "Show marks", hint: "Shift H", checked: true, onClick: () => calls.push("marks") },
    ]),
    top("Annotate", [
      {
        label: "Mark color",
        onClick: () => calls.push("row"),
        swatches: [
          { color: "#e5484d", label: "Red", key: "1", checked: true, onClick: () => calls.push("red") },
          { color: "#3e63dd", label: "Blue", key: "2", checked: false, onClick: () => calls.push("blue") },
        ],
      },
    ]),
  ];

  it("everything in the model survives JSON: no functions, no React nodes", () => {
    const { model } = serializeMenus(sample([]), "mac");
    expect(JSON.parse(JSON.stringify(model))).toEqual(model);
  });

  it("the Mac gets the menus without the items that belong to Windows only; Windows keeps them", () => {
    const labels = (platform: "mac" | "windows") =>
      serializeMenus(sample([]), platform).model[0].items.map((i) => (i === "-" ? "-" : i.label));
    // The separator before the left-out items goes with them
    expect(labels("mac")).toEqual(["Add Files…", "Find"]);
    expect(labels("windows")).toEqual(["Add Files…", "Find", "-", "Settings…", "Exit"]);
  });

  it("ids are unique, and every id has an action that is the item's own onClick", () => {
    const calls: string[] = [];
    const { model, actions } = serializeMenus(sample(calls), "mac");
    const ids: string[] = [];
    for (const menu of model)
      for (const item of menu.items) {
        if (item === "-") continue;
        // The row of swatches has no action of its own: its choices do
        if (!item.swatches) ids.push(item.id);
        for (const s of item.swatches ?? []) ids.push(s.id);
      }
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(actions.has(id)).toBe(true);
    actions.get(model[0].items.filter((i) => i !== "-")[0].id as string)!();
    expect(calls).toEqual(["add"]);
  });

  it("state and text come across: disabled, checked, title, a shortcut or its text, the role", () => {
    const { model } = serializeMenus(sample([]), "mac");
    const find = model[0].items[1];
    expect(find).toMatchObject({ label: "Find", title: "Filter the library", disabled: true, checked: false });
    const [undo, redo, uncheck] = model[1].items;
    expect(undo).toMatchObject({ role: "undo", disabled: false, shortcut: { key: "z", cmd: true } });
    expect(redo).toMatchObject({ role: "redo", disabled: true, shortcut: { key: "z", cmd: true, shift: true } });
    expect(uncheck).toMatchObject({ label: "Uncheck All", hintText: "3 checked" });
    expect(model[2].items[1]).toMatchObject({ checked: true, shortcut: { key: "h", shift: true } });
  });

  it("the key an item presses wins over its hint text", () => {
    const { model } = serializeMenus(sample([]), "mac");
    expect(model[2].items[0]).toMatchObject({ shortcut: { key: "=", cmd: true } });
  });

  it("the row of swatches becomes a list of choices, each with its own action, and the row itself has none", () => {
    const calls: string[] = [];
    const { model, actions } = serializeMenus(sample(calls), "mac");
    const row = model[3].items[0];
    if (row === "-") throw new Error("not a separator");
    expect(row.swatches).toMatchObject([
      { label: "Red", color: "#e5484d", key: "1", checked: true },
      { label: "Blue", color: "#3e63dd", key: "2", checked: false },
    ]);
    actions.get(row.swatches![1].id)!();
    expect(calls).toEqual(["blue"]);
    expect(actions.has(row.id)).toBe(false);
  });
});

describe("NativeMenuSync: what is sent to the shell and what a command from it does", () => {
  const make = () => {
    const sent: SetMenus[] = [];
    const logs: string[] = [];
    const calls: string[] = [];
    const sync = new NativeMenuSync({ send: (m) => sent.push(m), log: (l) => logs.push(l), platform: "mac" });
    const menus = (n = 0): TopMenu[] => [
      top("File", [
        { label: `Item ${n}`, onClick: () => calls.push(`item${n}`) },
        { label: "Other", onClick: () => calls.push("other") },
      ]),
      top("Edit", [{ label: "Undo", role: "undo", onClick: () => calls.push("undo") }]),
    ];
    return { sync, sent, logs, calls, menus };
  };

  it("sends the first model, and nothing while the content stays the same (new objects, same menus)", () => {
    const { sync, sent, menus } = make();
    sync.update(menus(), false);
    sync.update(menus(), false);
    sync.update(menus(), false);
    expect(sent).toHaveLength(1);
    expect(sent[0].version).toBe(1);
    expect(sent[0].modal).toBe(false);
    expect(sent[0].menus).toHaveLength(2);
  });

  it("a change sends a new model with the next version", () => {
    const { sync, sent, menus } = make();
    sync.update(menus(0), false);
    sync.update(menus(1), false);
    expect(sent.map((m) => m.version)).toEqual([1, 2]);
  });

  it("a dialog opening or closing sends the model again, with modal set accordingly", () => {
    const { sync, sent, menus } = make();
    sync.update(menus(), false);
    sync.update(menus(), true);
    sync.update(menus(), true);
    sync.update(menus(), false);
    expect(sent.map((m) => m.modal)).toEqual([false, true, false]);
  });

  it("a command runs the action of the version it came from: the item the user clicked, even when the menus changed meanwhile", () => {
    const { sync, sent, calls, menus } = make();
    sync.update(menus(0), false);
    sync.update(menus(1), false);
    const first = sent[0].menus[0].items[0];
    const second = sent[1].menus[0].items[0];
    if (first === "-" || second === "-") throw new Error("not a separator");
    expect(sync.run({ id: first.id, version: 1 }, false)).toBe(true);
    expect(sync.run({ id: second.id, version: 2 }, false)).toBe(true);
    expect(calls).toEqual(["item0", "item1"]);
  });

  it("only the last three versions are kept: an older one is dropped and logged, nothing runs", () => {
    const { sync, sent, logs, calls, menus } = make();
    for (let n = 0; n < 5; n++) sync.update(menus(n), false);
    expect(sent).toHaveLength(5);
    const oldest = sent[0].menus[0].items[0];
    if (oldest === "-") throw new Error("not a separator");
    expect(sync.run({ id: oldest.id, version: 1 }, false)).toBe(false);
    expect(logs).toHaveLength(1);
    expect(calls).toEqual([]);
    const kept = sent[2].menus[0].items[0];
    if (kept === "-") throw new Error("not a separator");
    expect(sync.run({ id: kept.id, version: 3 }, false)).toBe(true);
    expect(calls).toEqual(["item2"]);
  });

  it("an id that is not in that version is dropped and logged", () => {
    const { sync, logs, menus } = make();
    sync.update(menus(), false);
    expect(sync.run({ id: "9.9", version: 1 }, false)).toBe(false);
    expect(sync.run({ id: "0.0", version: 77 }, false)).toBe(false);
    expect(logs).toHaveLength(2);
  });

  it("nothing runs while a dialog is open", () => {
    const { sync, sent, calls, menus } = make();
    sync.update(menus(), true);
    const item = sent[0].menus[0].items[0];
    if (item === "-") throw new Error("not a separator");
    expect(sync.run({ id: item.id, version: 1 }, false)).toBe(false);
    expect(calls).toEqual([]);
  });

  it("undo and redo: with the caret in a text box the text is undone, not the notes", () => {
    const { sync, sent, calls, menus } = make();
    const text = vi.fn();
    sync.update(menus(), false);
    const undo = sent[0].menus[1].items[0];
    if (undo === "-") throw new Error("not a separator");
    expect(sync.run({ id: undo.id, version: 1 }, true, text)).toBe(true);
    expect(text).toHaveBeenCalledWith("undo");
    expect(calls).toEqual([]);
    expect(sync.run({ id: undo.id, version: 1 }, false, text)).toBe(true);
    expect(calls).toEqual(["undo"]);
    expect(text).toHaveBeenCalledTimes(1);
  });

  it("many changes in a row: the sync itself is cheap to ask and sends only what is different", () => {
    const { sync, sent, menus } = make();
    for (let i = 0; i < 200; i++) sync.update(menus(i % 3), false);
    // 0, 1, 2, 0, 1, 2 ... every call differs from the one before except none: 200 sends; the same content twice in a row sends once
    expect(sent.length).toBe(200);
    const again = make();
    for (let i = 0; i < 200; i++) again.sync.update(again.menus(0), false);
    expect(again.sent).toHaveLength(1);
  });
});
