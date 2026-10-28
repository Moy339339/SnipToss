import type { IntlShape } from "react-intl";
import { APP_NAME_EN, APP_VERSION, ISSUES_URL, UI_BUILT } from "./brand";
import { call, type AppInfo } from "./host";

/**
 * Diagnostic info (Help → Copy Diagnostic Info, Report an Issue; Settings → About): version, OS, runtime, language and display scaling.
 * Always English and independent of the UI language (like VS Code's "Copy About info"), so anyone's report can be read;
 * it contains no paths (the locations of the log, the app and the settings include the Windows user name, and reports are pasted on public GitHub)
 */
export function diagnosticsText(info: AppInfo | undefined, uiLocale: string): string {
  const shell = info ? `${info.version}, built ${info.built}${info.portable ? ", portable" : ""}` : "unknown";
  return [
    `${APP_NAME_EN} ${APP_VERSION}`,
    `UI: ${APP_VERSION}, built ${UI_BUILT || "unknown"}`,
    `Shell: ${shell}${info && info.version !== APP_VERSION ? " (MISMATCH)" : ""}`,
    `OS: ${info?.os ?? "unknown"}`,
    `.NET: ${info?.dotnet ?? "unknown"} · WebView2: ${info?.webview2 ?? "unknown"}`,
    `Language: UI ${uiLocale}, system ${info?.systemLanguage ?? "unknown"}`,
    `Display: devicePixelRatio ${window.devicePixelRatio}, window ${window.innerWidth}×${window.innerHeight}`,
  ].join("\n");
}

/** Copy the diagnostic info to the clipboard */
export const copyDiagnostics = (info: AppInfo | undefined, uiLocale: string) =>
  navigator.clipboard.writeText(diagnosticsText(info, uiLocale));

/**
 * Report an issue: opens a new GitHub Issue in the browser using the repository's issue form (.github/ISSUE_TEMPLATE/bug_report.yml),
 * with the "Diagnostic info" field prefilled (form fields are prefilled by id from URL parameters; the body parameter has no effect once
 * a form is used)
 */
export function reportIssue(intl: IntlShape, info: AppInfo | undefined) {
  const query = new URLSearchParams({ template: "bug_report.yml", diagnostics: diagnosticsText(info, intl.locale) });
  return call("openExternal", { url: `${ISSUES_URL}?${query}` });
}
