// Simulates real key presses in the SnipToss window (developer self-check). Unlike dispatchEvent in the page,
// this goes through the browser's input pipeline: events start at the focused element, with the same capture / bubble order as a real keyboard.
//   node scripts/cdp-key.mjs <key> [<key> ...] [--shift] [--ctrl] [--alt] [--down | --up] [--hold ms] [--port 9333]
// Keys: a-z, 0-9, Space, Escape, Enter, ArrowLeft/Right/Up/Down, Delete, Home, End, F5, F10, F11, Alt
// By default a key is pressed and released; --down only presses, --up only releases; --hold is how long to wait after pressing before releasing
// (in between it auto-repeats like a real keyboard).

import { cdpTargets } from "./cdp-targets.mjs";

const args = process.argv.slice(2);
const take = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  args.splice(i, 1);
  return true;
};
const takeValue = (name, fallback) => {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  const [, value] = args.splice(i, 2);
  return value;
};
const modifiers = (take("--alt") ? 1 : 0) | (take("--ctrl") ? 2 : 0) | (take("--shift") ? 8 : 0);
const onlyDown = take("--down");
const onlyUp = take("--up");
const hold = Number(takeValue("--hold", "0"));
const port = takeValue("--port", "9333");

const SPECIAL = {
  Space: { key: " ", code: "Space", vk: 32, text: " " },
  Escape: { key: "Escape", code: "Escape", vk: 27 },
  Enter: { key: "Enter", code: "Enter", vk: 13, text: "\r" },
  Delete: { key: "Delete", code: "Delete", vk: 46 },
  Home: { key: "Home", code: "Home", vk: 36 },
  End: { key: "End", code: "End", vk: 35 },
  F5: { key: "F5", code: "F5", vk: 116 },
  F10: { key: "F10", code: "F10", vk: 121 },
  F11: { key: "F11", code: "F11", vk: 122 },
  Alt: { key: "Alt", code: "AltLeft", vk: 18 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", vk: 37 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", vk: 38 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", vk: 39 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", vk: 40 },
};
const describe = (name) => {
  if (SPECIAL[name]) return SPECIAL[name];
  if (/^[a-z]$/i.test(name)) {
    const upper = name.toUpperCase();
    const key = modifiers & 8 ? upper : name.toLowerCase();
    return { key, code: `Key${upper}`, vk: upper.charCodeAt(0), text: modifiers & 2 ? undefined : key };
  }
  if (/^\d$/.test(name)) return { key: name, code: `Digit${name}`, vk: name.charCodeAt(0), text: name };
  throw new Error(`Unknown key: ${name}`);
};

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const name of args) {
  const k = describe(name);
  const base = { key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, modifiers };
  const down = (autoRepeat = false) =>
    send("Input.dispatchKeyEvent", { ...base, type: k.text ? "keyDown" : "rawKeyDown", text: k.text, unmodifiedText: k.text, autoRepeat });
  if (!onlyUp) {
    await down();
    // While held, auto-repeat like a real keyboard (Windows default: starts after about 500 ms, then every 33 ms)
    if (hold > 0) {
      const end = Date.now() + hold;
      await sleep(Math.min(hold, 500));
      while (Date.now() < end) {
        await down(true);
        await sleep(33);
      }
    }
  }
  if (!onlyDown) await send("Input.dispatchKeyEvent", { ...base, type: "keyUp" });
}
ws.close();
