import { useIntl } from "react-intl";
import { MaterialFileError } from "@sniptoss/core";
import { annotationPath, call, HostError } from "./host";

// How errors are explained to the user: the cause in plain language following the interface language, with a button to act on (open the folder / open the log). Reading and writing notes, copying, screenshots and the library all use it

/** The toast at the bottom right of the interface (drawn in App) */
export interface Notify {
  /**
   * sticky: stays until "OK" is clicked (explanations about data, which are easy to miss when they flash by).
   * error: an error: stays until closed with ×, and the text must say what to do; a path that can be opened comes with an action (keep = the toast stays after clicking)
   */
  (text: string, action?: { label: string; run: () => void; keep?: boolean }, opts?: { sticky?: boolean; error?: boolean }): void;
}

/** Errors classified by the shell (Bridge.ErrorCode) → the message that explains them */
const HOST_REASONS: Record<string, string> = {
  denied: "app.error.denied",
  diskFull: "app.error.diskFull",
  busy: "app.error.busy",
  network: "app.error.network",
  notFound: "app.error.notFound",
  tooLong: "app.error.tooLong",
  clipboardBusy: "app.error.clipboardBusy",
  // The shell did not answer in time (send in host.ts): classified by the UI itself
  timeout: "app.error.timeout",
};

export function useReport(onNotify: Notify) {
  const intl = useIntl();
  /** Show in File Explorer ("@logs" = the log folder, see reveal in docs/host-api.md) */
  const revealInExplorer = (path: string) => void call("reveal", { path }).catch((e: Error) => onNotify(e.message));
  /**
   * The cause of a read / write error: ones classified by the shell (no write permission, disk full, network down, ...) are explained in plain language following the interface language, naming the folder;
   * the rest use the original text. Otherwise only the system's original text would show, such as "Access to the path … is denied" on English Windows
   */
  const reasonOf = (e: unknown, folder: string) => {
    const id = e instanceof HostError && e.code ? HOST_REASONS[e.code] : undefined;
    return id ? intl.formatMessage({ id }, { folder }) : (e as Error).message;
  };
  /**
   * An error toast (an important error must not flash by): stays until closed with ×. It comes with a button to act on:
   * for a disk problem classified by the shell (no permission, disk full, file in use, path too long) where the folder is known: "Open Folder"; otherwise "Open Log" (the details are recorded there)
   */
  const notifyError = (text: string, e: unknown, folder?: string, action?: { label: string; run: () => void }) => {
    const disk = e instanceof HostError && ["denied", "diskFull", "busy", "tooLong"].includes(e.code ?? "");
    onNotify(
      text,
      action ??
        (folder && disk
          ? { label: intl.formatMessage({ id: "app.error.openFolder" }), run: () => revealInExplorer(folder), keep: true }
          : { label: intl.formatMessage({ id: "app.error.openLog" }), run: () => revealInExplorer("@logs"), keep: true }),
      { error: true },
    );
  };
  /** The cause of a failed copy in plain language: the browser and the system give English originals (Document is not focused, OpenClipboard Failed) */
  const copyReason = (e: unknown, folder: string) => {
    if (e instanceof DOMException && e.name === "NotAllowedError") return intl.formatMessage({ id: "app.error.clipboardFocus" });
    if (e instanceof HostError && e.code && HOST_REASONS[e.code]) return reasonOf(e, folder);
    return intl.formatMessage({ id: "app.error.clipboard" });
  };
  /** The explanation shown to people for an unreadable notes file (core only gives the failure cause and field; the wording is in messages) */
  const describeBad = (home: string, name: string, error: unknown) => {
    const path = annotationPath(home, name);
    const reason =
      error instanceof MaterialFileError
        ? intl.formatMessage(
            { id: "app.file.reasonDetail" },
            { reason: intl.formatMessage({ id: `app.file.reason.${error.reason}` }), detail: error.detail },
          )
        : (error as Error).message;
    return intl.formatMessage({ id: "app.file.unreadable" }, { path, reason });
  };
  return { revealInExplorer, reasonOf, notifyError, copyReason, describeBad };
}

export type Report = ReturnType<typeof useReport>;
