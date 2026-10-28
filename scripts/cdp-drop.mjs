// Simulates dragging a file / folder from File Explorer into the SnipToss window (developer self-check) using real drag-and-drop events,
// so the UI receives real File objects.
// The app must be started with a remote debugging port first (see cdp-eval.mjs).
//   node scripts/cdp-drop.mjs <path> [port]

import { cdpTargets } from "./cdp-targets.mjs";

const [path, port = "9333"] = process.argv.slice(2);
if (!path) {
  console.error("Usage: node scripts/cdp-drop.mjs <path> [port]");
  process.exit(2);
}
const targets = await cdpTargets(port);
// Skip WebView2's own edge:// pages (e.g. a permission prompt) and find the UI page
const page = targets.find((t) => t.type === "page" && !t.url.startsWith("edge://"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
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

const data = { items: [], files: [path], dragOperationsMask: 1 };
for (const type of ["dragEnter", "dragOver", "drop"]) {
  const r = await send("Input.dispatchDragEvent", { type, x: 600, y: 400, data });
  if (r.error) console.log(type, "error:", r.error.message);
}
console.log("Dropped", path);
ws.close();
