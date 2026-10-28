import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import { logError } from "./host";
import "./styles.css";
import "./workspace.css";

// Uncaught errors (thrown in event handlers, Promises nobody catches) go into the shell's log: otherwise they only flash by in DevTools and a problem report has nothing to trace
window.addEventListener("error", (e) => logError("Uncaught error", e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => logError("Unhandled Promise rejection", e.reason, "warn"));
// Blocked by the content security policy (the CSP in vite.config.ts): usually the policy missed something, so log it to fix it
document.addEventListener("securitypolicyviolation", (e) =>
  logError("Blocked by the content security policy", new Error(`${e.violatedDirective} ← ${e.blockedURI}`), "warn"),
);

// A trackpad pinch in a web page arrives as Ctrl+wheel: on the canvas ZoomView takes it to zoom the canvas; if it were not intercepted elsewhere,
// WebView2 would zoom the whole UI (with nowhere to reset it).
// The shell's IsPinchZoomEnabled is not turned off: if it were, the canvas would not receive trackpad pinches either. Listeners on window are passive by default, so passive: false is stated explicitly
window.addEventListener("wheel", (e) => e.ctrlKey && e.preventDefault(), { passive: false });

// Dropping files into the window: useFileDrop in App.tsx
// The context menu is kept only in text inputs (copy / paste)
window.addEventListener("contextmenu", (e) => {
  if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) e.preventDefault();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* Outermost layer: if the toast, tooltips or the messages themselves fail, the whole window does not go blank (the error page has a title bar, so the window can be closed) */}
    <ErrorBoundary area="app" page>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
