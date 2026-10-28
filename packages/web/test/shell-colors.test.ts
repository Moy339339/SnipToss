// The shell's and the UI's colors match: the window background, the background before the page loads and the WebView2 background must equal
// --bg in styles.css, or a flash of another color shows on startup and reload; the shell's own native UI (error window, notice page) takes
// its colors from the
// tokens named in the comments. Changing only one place fails here
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const css = read("packages/web/src/styles.css");
/** --name: #rrggbb in styles.css */
const token = (name: string) => new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i").exec(css)?.[1]?.toLowerCase();
/** Color.FromRgb(0x14, 0x14, 0x16) → #141416 */
const fromRgb = (src: string, before: string) => {
  const m = new RegExp(`${before}[^\\n]*?Color\\.FromRgb\\(0x([0-9a-f]{2}), 0x([0-9a-f]{2}), 0x([0-9a-f]{2})\\)`, "i").exec(src);
  return m ? `#${m[1]}${m[2]}${m[3]}`.toLowerCase() : undefined;
};

describe("shell and UI colors", () => {
  it("the window background (MainWindow.Bg, which the WebView2 default background also takes) and the background before the page loads (index.html) both equal --bg", () => {
    const bg = token("bg");
    expect(bg).toBe("#141416");
    expect(fromRgb(read("app/MainWindow.cs"), "static readonly Color Bg =")).toBe(bg);
    expect(read("app/MainWindow.cs")).toContain("DefaultBackgroundColor = System.Drawing.Color.FromArgb(Bg.R, Bg.G, Bg.B)");
    expect(/<html[^>]*style="background: (#[0-9a-f]{6})"/i.exec(read("packages/web/index.html"))?.[1]?.toLowerCase()).toBe(bg);
  });

  it("every color in the native UI (NativeUi.cs) equals the token named in its comment", () => {
    const lines = [...read("app/NativeUi.cs").matchAll(/Hex\("(#[0-9a-f]{6})"\);\s*\/\/ --([a-z0-9-]+)/gi)];
    expect(lines.length).toBeGreaterThanOrEqual(8);
    for (const [, hex, name] of lines) expect(`${name} ${hex.toLowerCase()}`).toBe(`${name} ${token(name)}`);
  });

  it("the error window's dark title bar is --surface-2 (the same as the background inside the window)", () => {
    expect(fromRgb(read("app/Crash.cs"), "DarkChrome.Apply\\(this,")).toBe(token("surface-2"));
  });
});
