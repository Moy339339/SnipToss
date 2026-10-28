// Screenshots the UI inside the SnipToss window (developer self-check) via CDP Page.captureScreenshot:
// coordinates are CSS pixels, there is no window frame, and none of the occasional white dots capture-window.ps1 (PrintWindow) can produce.
//   node scripts/cdp-shot.mjs <output.png> [--clip x,y,width,height [--scale 2]] [--port 9333]
// Use this for measuring alignment and looking pixel by pixel; use capture-window / capture-screen only for things the system draws (the window frame, the Screen Capture overlay).

import { cdpTargets } from "./cdp-targets.mjs";

import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  const [, value] = args.splice(i, 2);
  return value;
};
const port = option("--port", "9333");
const clipArg = option("--clip");
const scaleArg = option("--scale", "1"); // With --clip: zoom in to see detail (re-laid out and painted at that scale, not a stretched 1x image)
const [out] = args;
if (!out) {
  console.error("Usage: node scripts/cdp-shot.mjs <output.png> [--clip x,y,width,height] [--port 9333]");
  process.exit(2);
}

const targets = await cdpTargets(port);
// Skip WebView2's own edge:// pages (e.g. a permission prompt) and find the UI page
const page = targets.find((t) => t.type === "page" && !t.url.startsWith("edge://"));
if (!page) throw new Error("No page found");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

const params = { format: "png", captureBeyondViewport: false };
if (clipArg) {
  const [x, y, width, height] = clipArg.split(",").map(Number);
  params.clip = { x, y, width, height, scale: Number(scaleArg) };
}
ws.send(JSON.stringify({ id: 1, method: "Page.captureScreenshot", params }));
const msg = await new Promise((resolve) => (ws.onmessage = (m) => resolve(JSON.parse(m.data))));
ws.close();
if (msg.error) throw new Error(JSON.stringify(msg.error));
writeFileSync(out, Buffer.from(msg.result.data, "base64"));
console.log("Saved", out);
