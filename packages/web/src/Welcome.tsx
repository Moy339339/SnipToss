import { useIntl } from "react-intl";
import { FilePlusIcon, FolderPlusIcon } from "./icons";
import { Sheet } from "./Sheet";

/**
 * Help → Getting Started: the same text as the one in the middle of the canvas when the library is empty, so it can be viewed again once the library has items.
 * Clicking "Add Files" / "Add Folder" closes this dialog first
 */
export function IntroDialog(props: { onClose: () => void; onAddFiles: () => void; onAddFolder: () => void; captureKeys: string }) {
  const intl = useIntl();
  const then = (run: () => void) => () => {
    props.onClose();
    run();
  };
  return (
    <Sheet title={intl.formatMessage({ id: "help.intro.title" })} className="sheet-intro" onClose={props.onClose}>
      <Welcome onAddFiles={then(props.onAddFiles)} onAddFolder={then(props.onAddFolder)} captureKeys={props.captureKeys} />
    </Sheet>
  );
}

/**
 * The explanation in the middle of the canvas when the library is empty (otherwise nothing after opening tells what the app is for). It covers the whole loop: drag in → mark on the canvas → hand to AI.
 * It does not cover "AI finishes, then come back and check": handing it off is enough.
 * captureKeys: the Screen Capture shortcut (space-separated, like "Ctrl Alt A"); empty when not set
 */
export function Welcome(props: { onAddFiles: () => void; onAddFolder: () => void; captureKeys: string }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string>) => intl.formatMessage({ id }, values);
  return (
    <div className="welcome">
      <div className="stage-empty-title">{t("welcome.title")}</div>
      <div className="welcome-lead">{t("welcome.lead")}</div>
      <ol className="welcome-steps">
        {[1, 2, 3].map((n) => (
          <li key={n}>
            <span className="welcome-num">{n}</span>
            <span className="welcome-step-title">{t(`welcome.step${n}.title`)}</span>
            <span className="welcome-step-body">{t(`welcome.step${n}.body`)}</span>
          </li>
        ))}
      </ol>
      <div className="welcome-actions">
        {/* The hover tooltip is the same as the one at the top of the library (name with shortcut) */}
        <button className="btn btn-primary" onClick={props.onAddFiles} title={t("library.add.files")}>
          <FilePlusIcon />
          {t("welcome.addFiles")}
        </button>
        <button className="btn btn-secondary" onClick={props.onAddFolder} title={t("library.add.folder")}>
          <FolderPlusIcon />
          {t("welcome.addFolder")}
        </button>
      </div>
      <p className="welcome-foot">
        {t("welcome.saved")}
        <br />
        {props.captureKeys ? t("welcome.capture", { keys: props.captureKeys }) : t("welcome.captureNoKey")}
      </p>
    </div>
  );
}
