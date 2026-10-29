import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// The version has a single source: the root package.json (scripts/build-app.ps1 bumps it each time it builds the installed copy). The UI gets it at build time; the shell reads the same number from the csproj.
// The Mac CI builds trial packages as betas of it, numbered by the run (SNIPTOSS_UI_VERSION = <version>-beta.<run>, shown as "Beta <run>"); the Mac package carries the same
const version =
  process.env.SNIPTOSS_UI_VERSION ||
  (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version;

/**
 * Content security policy: the UI runs only its own bundled scripts; items come from the virtual hosts the shell maps (like vol-e.sniptoss.example, see HostOf in app/MainWindow.cs;
 * the Mac shell serves them from sniptoss://media instead, since WKWebView cannot map an https host).
 * Added only to the built page: the dev server (npm run dev:web) needs inline scripts for hot reload.
 * Styles need 'unsafe-inline': the page's html element carries an inline background color (no white flash at startup), and the marks layer uses SVG with style attributes
 */
const MATERIAL_HOSTS = "https://*.sniptoss.example sniptoss://media";
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${MATERIAL_HOSTS}`,
  `media-src 'self' blob: ${MATERIAL_HOSTS}`,
  `connect-src 'self' ${MATERIAL_HOSTS}`,
  // data: the brand font (assets/brand-name.woff2, about 2 KB) is under Vite's inline limit, so the build turns it into a data URL (without this entry it is blocked and the wordmark falls back to a plain font)
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const csp = (): Plugin => ({
  name: "csp",
  apply: "build",
  // Right after the charset tag: the charset must come first, and the policy must come before the scripts the build injects to cover them
  transformIndexHtml: (html) =>
    html.replace(/<meta charset="UTF-8" \/>/i, (m) => `${m}\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
});

// For development: run npm run dev:web, then start SnipToss.exe with the environment variable SNIPTOSS_DEV_URL=http://localhost:5173
export default defineConfig({
  plugins: [react(), csp()],
  server: { port: 5173, strictPort: true },
  build: { target: "chrome120" },
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __UI_BUILT__: JSON.stringify(new Date().toISOString()),
  },
});
