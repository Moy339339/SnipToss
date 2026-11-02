import { useIntl } from "react-intl";
import { call, logError, platform } from "./host";
import { FolderIcon } from "./icons";
import { KeepPunctuation } from "./KeepPunctuation";

/**
 * The canvas when the system refuses to let the app read an item (or a whole folder in the library): says so instead of "the file may be
 * damaged", and where access is granted. On the Mac that is System Settings → Privacy & Security → Files & Folders, which the main button
 * opens directly (macOS asks once per protected folder, and a "Don't Allow" sticks); on Windows it is the file's own permissions. The page
 * that shows this retries by itself when the window gets focus again, so the text promises an automatic refresh
 */
export function NoAccess(props: { folder: boolean; onReveal: () => void }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id }, { app: intl.formatMessage({ id: "brand.name" }) });
  return (
    <div className="stage-empty" role="alert">
      <KeepPunctuation>
        <div className="stage-empty-title">{t(props.folder ? "stage.denied.folderTitle" : "stage.denied.fileTitle")}</div>
        <div className="muted">{t(props.folder ? "stage.denied.folder" : "stage.denied.file")}</div>
      </KeepPunctuation>
      <div className="stage-empty-actions">
        {platform === "mac" && (
          <button
            className="btn btn-primary btn-small stage-empty-action"
            onClick={() => void call("openFilesAccessSettings").catch((e: unknown) => logError("openFilesAccessSettings", e))}
          >
            {t("stage.denied.openSettings")}
          </button>
        )}
        <button className="btn btn-secondary btn-small stage-empty-action" onClick={props.onReveal}>
          <FolderIcon />
          {t("stage.mediaError.reveal")}
        </button>
      </div>
    </div>
  );
}
