// Runs a piece of JS in the running SnipToss window and prints the result (developer self-check).
// The app must be started with a remote debugging port first:
//   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9333'
// Then: node scripts/cdp-eval.mjs "document.title"
// The expression may be async; the result is returned by value.

import { cdpTargets } from "./cdp-targets.mjs";

const [expression, port = "9333"] = process.argv.slice(2);
if (!expression) {
  console.error('Usage: node scripts/cdp-eval.mjs "<expression>" [port]');
  process.exit(2);
}
const targets = await cdpTargets(port);
// Skip WebView2's own edge:// pages (e.g. a permission prompt) and find the UI page
const page = targets.find((t) => t.type === "page" && !t.url.startsWith("edge://"));
if (!page) throw new Error("No page found");

const ws = new WebSocket(page.webSocketDebuggerUrl);
ws.onopen = () =>
  ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
ws.onmessage = (m) => {
  const { result } = JSON.parse(m.data);
  const r = result?.result;
  console.log(result?.exceptionDetails ? "Exception: " + JSON.stringify(result.exceptionDetails) : JSON.stringify(r?.value ?? r, null, 2));
  ws.close();
};
