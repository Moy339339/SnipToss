import Foundation

/// Runs in every page before its own scripts. The UI talks to the shell through `window.chrome.webview` (see `host.ts`); WKWebView has no
/// such object, so this gives it one that forwards to the `bridge` message handler. Replies and events come back through
/// `window.__sniptoss.receive`, which hands them to the listeners the UI registered.
let bridgeShimScript = """
(() => {
  const listeners = [];
  window.chrome = window.chrome || {};
  window.chrome.webview = {
    // Which shell hosts the page (host.ts reads it; WebView2's own object has none, which means Windows)
    platform: "mac",
    postMessage(message) {
      window.webkit.messageHandlers.bridge.postMessage(message);
    },
    // WKWebView gives a dropped File no path; the shell takes the paths from the native drop instead, so only the message goes through
    postMessageWithAdditionalObjects(message) {
      window.webkit.messageHandlers.bridge.postMessage(message);
    },
    addEventListener(type, listener) {
      if (type === "message") listeners.push(listener);
    },
  };
  window.__sniptoss = {
    receive(data) {
      for (const listener of listeners) listener({ data });
    },
  };
})();
"""

/// Reports page errors to the shell (the `console` message handler): what the UI logs with console.error and what it throws unhandled
let consoleHookScript = """
(() => {
  const post = (kind, text) => {
    try {
      window.webkit.messageHandlers.console.postMessage({ kind, text: String(text).slice(0, 2000) });
    } catch (e) {}
  };
  const error = console.error.bind(console);
  console.error = (...args) => {
    post("console.error", args.map((a) => (a instanceof Error ? a.stack || a.message : typeof a === "object" ? JSON.stringify(a) : a)).join(" "));
    error(...args);
  };
  window.addEventListener("error", (e) => post("error", `${e.message} (${e.filename}:${e.lineno})`));
  window.addEventListener("unhandledrejection", (e) => post("unhandledrejection", e.reason && e.reason.stack ? e.reason.stack : e.reason));
})();
"""
