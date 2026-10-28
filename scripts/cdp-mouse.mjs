// Simulates a real mouse drag in the SnipToss window (developer self-check): press -> move in several steps -> release.
//   node scripts/cdp-mouse.mjs <x1> <y1> <x2> <y2> [<x3> <y3> ...] [--hold] [--port 9333]
//   node scripts/cdp-mouse.mjs --release <x> <y>
// Coordinates are CSS pixels in the UI (the same as getBoundingClientRect). With several points the mouse passes through them in order (draws a freehand polyline).
// --hold: don't release at the end point (to capture the mid-drag state, e.g. the pixel readout); release later with --release.
// --shift / --ctrl / --alt: click with the modifier held (Shift-click checks a range, Ctrl-click adds to the selection).

import { cdpTargets } from "./cdp-targets.mjs";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  args.splice(i, 1);
  return true;
};
const option = (name, fallback) => {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  const [, value] = args.splice(i, 2);
  return value;
};
const hold = flag("--hold");
const release = flag("--release");
const port = option("--port", "9333");
// CDP modifier bits: Alt 1, Ctrl 2, Meta 4, Shift 8
const modifiers = (flag("--alt") ? 1 : 0) | (flag("--ctrl") ? 2 : 0) | (flag("--shift") ? 8 : 0);

const targets = await cdpTargets(port);
// Skip WebView2's own edge:// pages (e.g. a permission prompt) and find the UI page
const ws = new WebSocket(targets.find((t) => t.type === "page" && !t.url.startsWith("edge://")).webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

let id = 0;
const send = (method, params) =>
  new Promise((resolve) => {
    const my = ++id;
    const onMsg = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id === my) {
        ws.removeEventListener("message", onMsg);
        resolve(msg);
      }
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id: my, method, params }));
  });

if (release) {
  const [x, y] = args.map(Number);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1, modifiers });
} else {
  const nums = args.map(Number);
  const pts = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
  const [ax, ay] = pts[0];
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: ax, y: ay, modifiers });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: ax, y: ay, button: "left", buttons: 1, clickCount: 1, modifiers });
  for (let k = 1; k < pts.length; k++) {
    const [fx, fy] = pts[k - 1];
    const [tx, ty] = pts[k];
    for (let i = 1; i <= 8; i++) {
      const t = i / 8;
      await send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: fx + (tx - fx) * t,
        y: fy + (ty - fy) * t,
        button: "left",
        buttons: 1,
        modifiers,
      });
    }
  }
  const [bx, by] = pts[pts.length - 1];
  if (!hold)
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: bx, y: by, button: "left", buttons: 0, clickCount: 1, modifiers });
}
ws.close();
