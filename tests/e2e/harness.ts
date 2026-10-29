// e2e fixture: every test gets its own temporary project (a copy of tests/e2e/fixtures/project);
// the UI runs in the system's Edge and the shell is replaced by MockHost.
// UI files and materials are served straight from disk by intercepting requests to *.sniptoss.example, so no server is needed
// (the addresses are the same as in the real app, so the CSP still applies).
// The clipboard is a fake one inside the page: it never touches the system clipboard and tests can still read what was copied.

import { test as base, expect, type Page } from "@playwright/test";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MockHost, pathOfUrl } from "./mock-host";

export const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DIST = join(ROOT, "packages", "web", "dist");
const FIXTURE = join(ROOT, "tests", "e2e", "fixtures", "project");

/** The published JSON Schema (docs/schema, ADR-0006 item 6): at the end of every test, every notes file the app wrote must pass it */
const validateFile = new Ajv2020({ allErrors: true }).compile(JSON.parse(readFileSync(join(ROOT, "docs", "schema", "sniptoss-5.schema.json"), "utf8")));
/**
 * Notes files in the project that claim sniptoss/5 but do not match the Schema. Files a test broke on purpose, and old or newer versions,
 * are ignored: only files whose schema is sniptoss/5 count.
 */
function schemaViolations(project: string): string[] {
  const dir = join(project, ".sniptoss", "annotations");
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
    let data: { schema?: unknown };
    try {
      data = JSON.parse(readFileSync(join(dir, name), "utf8"));
    } catch {
      continue;
    }
    if (data?.schema !== "sniptoss/5" || validateFile(data)) continue;
    out.push(`${name}: ${(validateFile.errors ?? []).map((e) => `${e.instancePath} ${e.message}`).join("; ")}`);
  }
  return out;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".json": "application/json",
};

/** Installed before the page scripts run: a fake chrome.webview (forwards to MockHost) and a fake clipboard */
const SHIM = `(() => {
  const listeners = new Set();
  const deliver = (data) => { for (const l of listeners) l({ data }); };
  window.chrome = window.chrome || {};
  window.chrome.webview = {
    // The Mac shell's script sets platform: "mac" on its object; WebView2's has none. A test that wants the Mac sets __e2ePlatform before the page loads (test.use or addInitScript)
    get platform() { return window.__e2ePlatform; },
    postMessage(msg) { window.__e2eHost(msg).then(deliver); },
    // Dropped files: the real shell takes the paths from the attached objects; here the file names go into the params, which simulates the shell
    // matching them by name to the paths the test prepared (nextDrop in mock-host.ts).
    // Like real WebView2: if any attached File is not on disk (an image dragged out of a web page), the whole message is rejected and throws on the spot.
    // Tests put the names of the files that are "on disk" into __e2eOnDisk
    postMessageWithAdditionalObjects(msg, objects) {
      const onDisk = new Set(window.__e2eOnDisk || []);
      if (Array.from(objects).some((f) => !onDisk.has(f.name)))
        throw new Error("Failed to execute 'postMessageWithAdditionalObjects' on 'EmbeddedBrowserWebView': Failed to post a message: additional File object is not a file on the disk.");
      window.__e2eHost({ ...msg, params: { dropped: Array.from(objects, (f) => f.name) } }).then(deliver);
    },
    addEventListener(type, l) { if (type === "message") listeners.add(l); },
    removeEventListener(type, l) { listeners.delete(l); },
  };
  window.__e2eEmit = deliver;
  const clip = { text: null };
  window.__e2eClipboard = clip;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (t) => { clip.text = String(t); },
      readText: async () => clip.text ?? "",
      write: async () => {},
      read: async () => [],
    },
  });
})();`;

export interface App {
  page: Page;
  host: MockHost;
  /** The temporary project (the one entry in the library) */
  project: string;
  temp: string;
  /** Opens the UI and waits for the library to appear */
  open(): Promise<void>;
  /** The text that "Copy as Text" copied */
  clipboard(): Promise<string | null>;
  /** Reads one notes file of the project; [] while it has not been written yet */
  annotations(file: string): { id: string; status: string; body: string; replies: unknown[] }[];
  /**
   * Where the canvas content (the item itself) is on screen. Right after switching items it is briefly 0 × 0 at the corner of the
   * canvas area, so this waits until it has a size (measuring too early sends a click outside the canvas)
   */
  media(): Promise<{ x: number; y: number; width: number; height: number }>;
  /**
   * Current content of .sniptoss/REVIEW.md; "" if it has not been written yet
   * (editing notes does not wait for it, so polling must not fail on a missing file)
   */
  review(): string;
  /** In this test the UI is expected to log errors (e.g. a save is made to fail); only messages containing `expected` are let through */
  allowLogErrors(expected: string): void;
}

export const test = base.extend<{ app: App }>({
  app: async ({ page }, use) => {
    const temp = mkdtempSync(join(tmpdir(), "e2e-"));
    const project = join(temp, "project");
    cpSync(FIXTURE, project, { recursive: true });
    const host = new MockHost({
      emit: (payload) => page.evaluate((p) => (window as unknown as { __e2eEmit: (x: unknown) => void }).__e2eEmit(p), payload),
      tempDir: temp,
    });
    host.entries = [{ path: project, pinned: false }];

    await page.exposeFunction("__e2eHost", (msg: { id: number; method: string; params: unknown }) => host.handle(msg));
    await page.addInitScript(SHIM);
    await page.route(/^https:\/\/[^/]+\.sniptoss\.example\//, async (route) => {
      const url = new URL(route.request().url());
      const file = url.hostname === "app.sniptoss.example" ? join(DIST, ...url.pathname.split("/").filter(Boolean).map(decodeURIComponent)) : pathOfUrl(url.href);
      if (!file || !existsSync(file) || !statSync(file).isFile()) return route.fulfill({ status: 404, body: "not found" });
      const body = readFileSync(file);
      const type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
      // Dragging the video scrubber needs Range requests (in the real app WebView2's virtual host mapping handles them)
      const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers()["range"] ?? "");
      if (range) {
        const start = Number(range[1]);
        const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
        return route.fulfill({
          status: 206,
          headers: { "content-type": type, "content-range": `bytes ${start}-${end}/${body.length}`, "accept-ranges": "bytes", "access-control-allow-origin": "*" },
          body: body.subarray(start, end + 1),
        });
      }
      return route.fulfill({ status: 200, headers: { "content-type": type, "accept-ranges": "bytes", "access-control-allow-origin": "*" }, body });
    });

    const allowed: string[] = [];
    await use({
      page,
      host,
      project,
      temp,
      open: async () => {
        await page.goto("https://app.sniptoss.example/index.html");
        await expect(page.locator(".lib-row").first()).toBeVisible();
      },
      clipboard: () => page.evaluate(() => (window as unknown as { __e2eClipboard: { text: string | null } }).__e2eClipboard.text),
      // A file not written yet reads as no notes: expect.poll does not retry a callback that throws, so waiting for the first save would fail at once
      annotations: (file) => {
        const path = join(project, ".sniptoss", "annotations", file);
        return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")).annotations : [];
      },
      media: async () => {
        const el = page.locator(".zoom-media");
        await expect.poll(async () => ((await el.boundingBox())?.width ?? 0) > 1 && ((await el.boundingBox())?.height ?? 0) > 1).toBe(true);
        return (await el.boundingBox())!;
      },
    review: () => (existsSync(join(project, ".sniptoss", "REVIEW.md")) ? readFileSync(join(project, ".sniptoss", "REVIEW.md"), "utf8") : ""),
      allowLogErrors: (expected) => void allowed.push(expected),
    });

    // In normal flows the UI must not log errors (ErrorBoundary, uncaught exceptions), and no resource may be blocked by the content security policy
    // or fail in an unhandled Promise (those two are logged as warnings)
    const errors = host.logs.filter(
      (l) =>
        !allowed.some((a) => l.message.includes(a)) &&
        (l.level === "error" ||
          l.message.includes("content security policy") ||
          l.message.startsWith("Unhandled Promise rejection") ||
          // Missing or malformed message (IntlProvider's onError logs a warning): the UI would show a raw id such as sc.xxx
          l.message.startsWith("i18n message: ")),
    );
    const invalid = schemaViolations(project);
    host.dispose();
    rmSync(temp, { recursive: true, force: true });
    expect(errors, `The UI logged errors:\n${errors.map((e) => e.message).join("\n")}`).toEqual([]);
    expect(invalid, `Notes files written do not match docs/schema:\n${invalid.join("\n")}`).toEqual([]);
  },
});

export { expect };
