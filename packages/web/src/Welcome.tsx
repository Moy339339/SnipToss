import { useIntl } from "react-intl";
import { useShortcuts } from "./commandKeys";
import { Demo } from "./Demo";
import { FilePlusIcon, FolderPlusIcon, KindIcon } from "./icons";
import { KeepPunctuation } from "./KeepPunctuation";
import { Sheet } from "./Sheet";

/**
 * Help → Getting Started: the same text as the one in the middle of the canvas when the library is empty, so it can be viewed again once the library has items.
 * Clicking "Add Files" / "Add Folder" closes this dialog first
 */
export function IntroDialog(props: {
  onClose: () => void;
  onAddFiles: () => void;
  onAddFolder: () => void;
  onSample?: () => void;
  captureKeys: string;
}) {
  const intl = useIntl();
  const then = (run: () => void) => () => {
    props.onClose();
    run();
  };
  return (
    <Sheet title={intl.formatMessage({ id: "help.intro.title" })} className="sheet-intro" onClose={props.onClose}>
      <Welcome
        onAddFiles={then(props.onAddFiles)}
        onAddFolder={then(props.onAddFolder)}
        onSample={props.onSample && then(props.onSample)}
        captureKeys={props.captureKeys}
      />
    </Sheet>
  );
}

/** The main formats under the welcome title, the most common first (all of them are in library.ts KIND_OF_EXT; the full list is the tooltip) */
const MAIN_FORMATS = { image: ["PNG", "JPG", "WebP", "GIF", "SVG"], video: ["MP4", "MOV", "WebM"] } as const;

/**
 * What the canvas shows when the library is empty: one line on what to do here (drop files or folders in) and a faint one on what can be
 * dropped (images and videos, their main formats), the whole loop acted out
 * (Demo.tsx: drag in → mark → write → copy → paste to the AI → the picture comes back changed) and the three ways to start. No steps
 * written out, no notes on where things are saved or how to capture the screen: the animation shows the loop, and the first use of each
 * feature brings its own hint. What the app is for is said once, on the first launch (FirstRun.tsx).
 * captureKeys: kept for the callers (Help → Getting Started passes it); the page no longer mentions Screen Capture.
 * onSample: add the sample picture that ships with the app and start the tutorial on it (absent when the shell cannot)
 */
export function Welcome(props: { onAddFiles: () => void; onAddFolder: () => void; onSample?: () => void; captureKeys: string }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { tip } = useShortcuts();
  return (
    <KeepPunctuation>
      <div className="welcome">
        <div className="stage-empty-title">{t("welcome.drop")}</div>
        {/* What can be dropped in, so nothing unsupported is dragged in by mistake: an image and a video icon, each with its main formats
            and an ellipsis (no words or brackets: the icons say which is which, and format names read the same in every language); the full list (with
            those turned on in Settings) on hover, the sentence for screen readers */}
        <div className="welcome-formats" role="note" aria-label={t("welcome.formats")} title={t("library.note.othersTitle")}>
          {(["image", "video"] as const).map((kind) => (
            <span key={kind} className="welcome-formats-group" aria-hidden="true">
              <KindIcon kind={kind} />
              {MAIN_FORMATS[kind].map((format) => (
                <span key={format}>{format}</span>
              ))}
              {/* Not only these: an ellipsis after each group */}
              <span>…</span>
            </span>
          ))}
        </div>
        <div className="welcome-demo">
          <Demo scene="loop" />
        </div>
        <div className="welcome-actions">
          {/* The hover tooltip is the same as the one at the top of the library (its shortcut) */}
          <button className="btn btn-primary" onClick={props.onAddFiles} title={tip(t("library.add.files"), "file.addFiles")}>
            <FilePlusIcon />
            {t("welcome.addFiles")}
          </button>
          <button className="btn btn-secondary" onClick={props.onAddFolder} title={tip(t("library.add.folder"), "file.addFolder")}>
            <FolderPlusIcon />
            {t("welcome.addFolder")}
          </button>
          {props.onSample && (
            <button className="btn btn-secondary" onClick={props.onSample}>
              {t("welcome.sample")}
            </button>
          )}
        </div>
      </div>
    </KeepPunctuation>
  );
}
