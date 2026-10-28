import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS, mergePrefs, NOT_SETTINGS, storedPrefs } from "../src/prefs";

describe("mergePrefs", () => {
  it("removed settings are no longer carried along, the rest is unchanged", () => {
    const saved = {
      agentFiles: ["README.md"],
      agentBlock: "x",
      exportIncludeMaterials: true,
      writeReview: false,
      promptTemplate: "请先读 {review}",
      author: "我",
    };
    const merged = mergePrefs(saved as never) as unknown as Record<string, unknown>;
    for (const k of ["agentFiles", "agentBlock", "exportIncludeMaterials", "writeReview", "promptTemplate"])
      expect(k in merged).toBe(false);
    expect(merged.author).toBe("我");
    expect(merged.promptExtra).toBe(DEFAULT_PREFS.promptExtra);
  });

  it("the record of New markers in the library (fresh): start times keep only numbers and seen entries keep only strings; missing or broken gives an empty record", () => {
    expect(mergePrefs({}).fresh).toEqual({ since: {}, seen: [] });
    const m = mergePrefs({ fresh: { since: { "e:\\a": 123, "e:\\b": "x", "e:\\c": Infinity }, seen: ["e:\\a\\1.png", 5, null] } } as never);
    expect(m.fresh).toEqual({ since: { "e:\\a": 123 }, seen: ["e:\\a\\1.png"] });
    expect(mergePrefs({ fresh: "坏了" } as never).fresh).toEqual({ since: {}, seen: [] });
  });

  it("the mark color accepts only #rrggbb: a settings file broken by hand cannot put anything else into SVG", () => {
    expect(mergePrefs({ markColor: "#3ddc84" }).markColor).toBe("#3ddc84");
    for (const bad of ['red" onload="x', "#fff", "url(x)", 42, null]) {
      expect(mergePrefs({ markColor: bad } as never).markColor).toBe(DEFAULT_PREFS.markColor);
    }
  });

  it("every setting is validated by type and value: a wrong type or an unrecognized value falls back to the default (a settings file broken by hand)", () => {
    const m = mergePrefs({
      skipDirs: "node_modules",
      uiScale: 0,
      markWidth: "粗",
      snapshotMax: -5,
      backdrop: "sparkly",
      defaultCategory: "fix",
      kinds: { image: "yes", pdf: true },
      autoCompose: "false",
      volume: 3,
      author: 7,
    } as never);
    expect(m.skipDirs).toEqual(DEFAULT_PREFS.skipDirs);
    expect(m.uiScale).toBe(0.5); // clamped into the range (0 would shrink the whole interface to nothing)
    expect(m.markWidth).toBe(DEFAULT_PREFS.markWidth);
    expect(m.snapshotMax).toBe(0);
    expect(m.backdrop).toBe(DEFAULT_PREFS.backdrop);
    expect(m.defaultCategory).toBe(DEFAULT_PREFS.defaultCategory);
    expect(m.kinds).toEqual({ image: true, video: true, pdf: true, slides: false });
    expect(m.autoCompose).toBe(DEFAULT_PREFS.autoCompose);
    expect(m.volume).toBe(1);
    expect(m.author).toBe(DEFAULT_PREFS.author);
  });

  it("non-string and blank array entries are dropped; unrecognized settings are kept as they are (added by a later version)", () => {
    const m = mergePrefs({ skipDirs: ["out", 3, " ", null, "dist"], futureThing: { a: 1 } } as never) as unknown as Record<string, unknown>;
    expect(m.skipDirs).toEqual(["out", "dist"]);
    expect(m.futureThing).toEqual({ a: 1 });
  });

  it("not an object (an array or a string at the root of the settings file): the default settings are used", () => {
    expect(mergePrefs([] as never)).toEqual(DEFAULT_PREFS);
    expect(mergePrefs("x" as never)).toEqual(DEFAULT_PREFS);
  });

  it("the first time the notes panel opens it lists the whole project and only open notes; an unrecognized scope also falls back to the whole project", () => {
    expect(mergePrefs({})).toMatchObject({ panelScope: "project", panelResolved: false });
    expect(mergePrefs({ panelScope: "material" }).panelScope).toBe("material");
    expect(mergePrefs({ panelScope: "picked" } as never).panelScope).toBe("project");
  });

  it("the notes panel filter: off by default; only the four section kinds are accepted and other values are dropped; hiding everything (by hand edit) counts as no filter", () => {
    expect(mergePrefs({}).panelHidden).toEqual([]);
    expect(mergePrefs({ panelHidden: ["overall", "bogus", "earlier"] } as never).panelHidden).toEqual(["overall", "earlier"]);
    expect(mergePrefs({ panelHidden: ["marked", "overall", "earlier"] }).panelHidden).toEqual(["marked", "overall", "earlier"]);
    expect(mergePrefs({ panelHidden: ["marked", "timed", "overall", "earlier"] }).panelHidden).toEqual([]);
    expect(mergePrefs({ panelHidden: "overall" } as never).panelHidden).toEqual([]);
  });

  it("the two removed settings (AI marking notes done, generating a snapshot for every note) are dropped when read", () => {
    const m = mergePrefs({ cliShim: true, snapshots: false } as never) as unknown as Record<string, unknown>;
    expect("cliShim" in m).toBe(false);
    expect("snapshots" in m).toBe(false);
  });

  it("numbers out of range are clamped back, and non-finite ones use the default", () => {
    expect(mergePrefs({ uiScale: 5, markWidth: 99, snapshotMax: 1e9, volume: -1 })).toMatchObject({
      uiScale: 2,
      markWidth: 8,
      snapshotMax: 16384,
      volume: 0,
    });
    expect(mergePrefs({ uiScale: NaN, markWidth: Infinity }).uiScale).toBe(1);
    expect(mergePrefs({ markWidth: Infinity }).markWidth).toBe(2);
    expect(mergePrefs({ snapshotFormat: "gif", initialSelect: "x", language: 5, muted: "yes" } as never)).toMatchObject({
      snapshotFormat: "png",
      initialSelect: "first",
      language: "system",
      muted: false,
    });
  });
});

describe("default values", () => {
  it("item by item", () => {
    expect(DEFAULT_PREFS).toEqual({
      language: "system",
      author: "",
      uiScale: 1,
      backdrop: "blur",
      updateCheck: true,
      defaultCategory: "change",
      autoCompose: true,
      pauseOnAnnotate: true,
      holdTools: false,
      showResolved: true,
      markColor: "#ff6a3d",
      markWidth: 2,
      panelScope: "project",
      panelResolved: false,
      panelHidden: [],
      loop: false,
      volume: 1,
      muted: false,
      reviewIncludeResolved: false,
      snapshotMax: 1600,
      snapshotFormat: "png",
      kinds: { image: true, video: true, pdf: false, slides: false },
      moreFormats: false,
      skipDirs: ["node_modules", "bin", "obj", "dist", "build", "__pycache__", "venv"],
      initialSelect: "first",
      libraryPending: false,
      fresh: { since: {}, seen: [] },
      onboarding: [],
      promptExtra: "",
    });
  });

  it("seen tours and hints: not a setting, so Restore Defaults leaves it alone; only strings are kept when read", () => {
    expect(NOT_SETTINGS).toContain("onboarding");
    expect(mergePrefs({ onboarding: ["tour", 3, "", "hint.copy"] } as never).onboarding).toEqual(["tour", "hint.copy"]);
    expect(mergePrefs({ onboarding: "tour" } as never).onboarding).toEqual([]);
    expect(storedPrefs(mergePrefs({ onboarding: ["tour"] }))).toEqual({ onboarding: ["tour"] });
  });

  it("the few settings the shell reads itself use the same defaults as here when absent from the settings file (the file only records changed settings, see storedPrefs)", () => {
    const cs = (f: string) => readFileSync(new URL(`../../../app/${f}`, import.meta.url), "utf8");
    const skip = /DefaultSkipDirs = \[([^\]]*)\]/.exec(cs("Bridge.cs"))![1];
    expect(skip.split(",").map((s) => s.trim().replace(/"/g, ""))).toEqual(DEFAULT_PREFS.skipDirs);
    const settings = cs("Settings.cs");
    expect(settings).toContain(`: "${DEFAULT_PREFS.markColor}";`);
    const kinds = /DefaultKinds = new\(\) \{([^}]*)\}/.exec(settings)![1];
    expect(Object.fromEntries([...kinds.matchAll(/\["(\w+)"\] = (true|false)/g)].map((m) => [m[1], m[2] === "true"]))).toEqual(
      DEFAULT_PREFS.kinds,
    );
    expect(DEFAULT_PREFS.defaultCategory).toBe("change"); // Capture.Categories.Valid falls back to change for anything unrecognized
    expect(DEFAULT_PREFS.promptExtra).toBe("");
    // Automatic update check: the shell turns it off only when it is written as false (Settings.UpdateCheck)
    expect(DEFAULT_PREFS.updateCheck).toBe(true);
    expect(settings).toContain('Prefs?["updateCheck"] is not JsonValue v || !v.TryGetValue<bool>(out var on) || on;');
    // More formats: the shell turns it on only for true (Settings.MoreFormats)
    expect(DEFAULT_PREFS.moreFormats).toBe(false);
    expect(settings).toContain('Prefs?["moreFormats"] is JsonValue v && v.TryGetValue<bool>(out var on) && on;');
  });
});

describe("storedPrefs: the settings file records only changed settings", () => {
  it("settings equal to the default are not written; changed and unrecognized ones (added by a later version) are", () => {
    expect(storedPrefs(DEFAULT_PREFS)).toEqual({});
    const p = { ...mergePrefs({ futureThing: 1 } as never), loop: true, kinds: { ...DEFAULT_PREFS.kinds, video: false } };
    expect(storedPrefs(p)).toEqual({ futureThing: 1, loop: true, kinds: { image: true, video: false, pdf: false, slides: false } });
  });

  it("what is written reads back the same as the original", () => {
    const p = { ...DEFAULT_PREFS, author: "小王", skipDirs: ["out"], fresh: { since: { "e:\\a": 1 }, seen: [] } };
    expect(mergePrefs(storedPrefs(p) as never)).toEqual(p);
  });
});
