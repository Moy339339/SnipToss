import { useEffect, useState } from "react";
import { useIntl } from "react-intl";
import { DATA_DIR } from "@sniptoss/core";
import { call, logError } from "./host";

// Covers the canvas area when a note written on an earlier version is selected: shows its snapshot from back then
// (the whole frame + marks, .sniptoss/snapshots), with a line of explanation on top and a "back to current canvas" button
// (Esc does the same, see the layered exit in Workspace). After the item is overwritten the old marks are not drawn on the new
// canvas, so this picture is where to see what the note was about (ADR-0008)

export function EarlierShot(props: {
  /** Notes folder */
  home: string;
  /** Snapshot, relative to .sniptoss/; undefined when there is none */
  snapshot: string | undefined;
  onClose: () => void;
}) {
  const intl = useIntl();
  const { home, snapshot } = props;
  const [url, setUrl] = useState<{ for: string; url: string | null }>();
  useEffect(() => {
    if (!snapshot) return;
    let alive = true;
    call("fileUrl", { home, path: `${DATA_DIR}/${snapshot}` })
      .then((u) => alive && setUrl({ for: snapshot, url: u }))
      .catch((e: unknown) => {
        logError("snapshot of a note on an earlier version", e, "warn");
        if (alive) setUrl({ for: snapshot, url: null });
      });
    return () => {
      alive = false;
    };
  }, [home, snapshot]);
  const shot = snapshot && url?.for === snapshot ? url.url : undefined;
  const title = intl.formatMessage({ id: "stage.earlier.title" });
  return (
    // A click on the blank area outside the snapshot = go back (like clicking blank space on the canvas deselects)
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div className="earlier-shot" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="earlier-bar" role="status">
        <span className="earlier-title">{title}</span>
        <span className="earlier-note">{intl.formatMessage({ id: "stage.earlier.note" })}</span>
        <button
          type="button"
          className="btn btn-secondary btn-small"
          onClick={props.onClose}
          title={intl.formatMessage({ id: "stage.earlier.backTitle" })}
        >
          {intl.formatMessage({ id: "stage.earlier.back" })}
        </button>
      </div>
      {!snapshot || shot === null ? (
        <div className="earlier-none">{intl.formatMessage({ id: "stage.earlier.noShot" })}</div>
      ) : (
        shot && (
          <img className="earlier-img" src={shot} alt={title} draggable={false} onError={() => setUrl({ for: snapshot, url: null })} />
        )
      )}
    </div>
  );
}
