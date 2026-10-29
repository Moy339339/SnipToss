import { describe, expect, it, vi } from "vitest";

// host.ts looks for window.chrome.webview (the WebView2 bridge) as soon as it loads; only the path functions are tested here, so an empty
// window is provided
vi.stubGlobal("window", {});
const { baseName, callTimeout, dirName, keyOf, homeJoin, materialUrl } = await import("../src/host");

// Path names and parents. For a drive root (E:\), a name of "E:" and a parent of "E:" (without the \) would not match the E:\ the shell gives,
// and the project row of a single file at a drive root would change its key before and after a scan

describe("baseName", () => {
  it("names of files and folders", () => {
    expect(baseName("E:\\项目\\a.png")).toBe("a.png");
    expect(baseName("E:\\项目\\")).toBe("项目");
    expect(baseName("E:/项目/图")).toBe("图");
  });
  it("drive root: E:\\", () => {
    expect(baseName("E:\\")).toBe("E:\\");
    expect(baseName("e:")).toBe("e:\\");
  });
});

describe("dirName", () => {
  it("the parent folder", () => {
    expect(dirName("E:\\项目\\a.png")).toBe("E:\\项目");
    expect(dirName("E:/项目/a.png")).toBe("E:/项目");
  });
  it("a file at a drive root: the parent is E:\\ (consistent with the shell)", () => {
    expect(dirName("E:\\a.png")).toBe("E:\\");
    expect(dirName("E:\\")).toBe("E:\\");
  });
  it("a network share root: the parent stops at itself (like a drive root); going up to \\\\srv would make the project row's subtitle show the server name", () => {
    expect(dirName("\\\\srv\\share")).toBe("\\\\srv\\share");
    expect(dirName("\\\\srv\\share\\a.png")).toBe("\\\\srv\\share");
    expect(dirName("\\\\srv\\share\\图\\a.png")).toBe("\\\\srv\\share\\图");
    expect(baseName("\\\\srv\\share")).toBe("share");
  });
});

// A shell on another system hands over its own kind of path (/Users/…): the functions follow the path they are given
describe("POSIX paths (macOS shell)", () => {
  it("baseName: the last segment; the root is itself; a folder that looks like a drive letter is not a drive", () => {
    expect(baseName("/Users/alex/项目/a.png")).toBe("a.png");
    expect(baseName("/Users/alex/项目/")).toBe("项目");
    expect(baseName("/")).toBe("/");
    expect(baseName("/e:")).toBe("e:");
  });
  it("dirName: the parent folder; a file directly under / has the parent /", () => {
    expect(dirName("/Users/alex/项目/a.png")).toBe("/Users/alex/项目");
    expect(dirName("/Users/a.png")).toBe("/Users");
    expect(dirName("/a.png")).toBe("/");
    expect(dirName("/")).toBe("/");
  });
  it("a path that starts with two slashes is not a network share", () => {
    expect(dirName("//srv/share/a.png")).toBe("//srv/share");
  });
  it("homeJoin: slashes stay slashes", () => {
    expect(homeJoin("/Users/alex/p", "a/b.png")).toBe("/Users/alex/p/a/b.png");
    expect(homeJoin("/Users/alex/p/", "a")).toBe("/Users/alex/p/a");
    expect(homeJoin("/", "a")).toBe("/a");
  });
  it("keyOf: one form for both kinds, so prefix tests with a trailing \\ work on either", () => {
    expect(keyOf("/Users/Alex/P")).toBe("\\users\\alex\\p");
    expect(keyOf("/Users/Alex/P/a.png").startsWith(keyOf("/Users/Alex/P") + "\\")).toBe(true);
  });
  it("keyOf: the same name in composed and decomposed Unicode (macOS can hand over either) is one key", () => {
    const composed = "caf" + String.fromCharCode(0xe9);
    const decomposed = "caf" + String.fromCharCode(0x65, 0x301);
    expect(decomposed).not.toBe(composed);
    expect(keyOf(`/Users/alex/${decomposed}.png`)).toBe(keyOf(`/Users/alex/${composed}.png`));
  });
});

describe("keyOf / homeJoin / materialUrl", () => {
  it("keyOf: forward slashes become backslashes, everything is lowercased, and a trailing \\ is kept", () => {
    expect(keyOf("E:/Proj/A.PNG")).toBe("e:\\proj\\a.png");
    expect(keyOf("E:\\")).toBe("e:\\");
  });
  it("homeJoin: notes folder + relative path (forward slashes)", () => {
    expect(homeJoin("E:\\", "a/b.png")).toBe("E:\\a\\b.png");
    expect(homeJoin("E:\\p\\", "a")).toBe("E:\\p\\a");
    expect(homeJoin("\\\\srv\\share", "a/b")).toBe("\\\\srv\\share\\a\\b");
  });
  it("materialUrl: the URL carries the modification time and size, so a changed file gets a new URL and bypasses the cache; a changed size with the same modification time also changes it (a copy can keep the modification time)", () => {
    const m = { url: "https://vol-e.sniptoss.example/a.png", mtime: 5, size: 100 } as Parameters<typeof materialUrl>[0];
    expect(materialUrl(m)).toBe("https://vol-e.sniptoss.example/a.png?v=5-100");
    expect(materialUrl({ ...m, size: 101 })).not.toBe(materialUrl(m));
  });
});

// How long without a reply from the shell counts as not responding
describe("callTimeout", () => {
  it("ordinary calls wait 30 seconds; those that wait for the user (picking files, capturing, dragging a window edge) have no limit", () => {
    expect(callTimeout("getPrefs")).toBe(30_000);
    for (const m of ["pickFiles", "pickFolder", "captureStart", "windowResize"] as const) expect(callTimeout(m), m).toBe(0);
  });
  it("a scan waits 5 minutes; checking whether each item exists (a disconnected network drive takes tens of seconds per item), reading many notes and producing dozens of images wait 2 minutes", () => {
    expect(callTimeout("scan")).toBe(300_000);
    for (const m of ["library", "missing", "readHomes", "libraryAdd", "addDropped", "sha256", "copyImages"] as const)
      expect(callTimeout(m), m).toBe(120_000);
  });
});
