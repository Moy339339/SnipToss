import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useIntl } from "react-intl";
import type { Annotation, MaterialKind } from "@sniptoss/core";
import { Ambient } from "./Ambient";
import { KeepPunctuation } from "./KeepPunctuation";
import { call, HostError, logError, materialUrl, platform, type DeniedReason, type MaterialEntry } from "./host";
import { FolderIcon } from "./icons";
import { isSvg, needsDecode } from "./library";
import { hasAlpha, rememberSize, svgNaturalSize, vectorWork, type Size } from "./mediaSize";
import { NoAccess } from "./NoAccess";
import { VideoPlayer, type SeekRequest } from "./VideoPlayer";
import { ZoomView } from "./ZoomView";

// The item itself in the canvas: an image (zoomed and panned in ZoomView), a video (VideoPlayer), or the explanation when it cannot open. The note layer is passed in by Workspace through layer

/** The item element on the canvas (used for screenshots, and to get the canvas size and video time) */
export type Media = HTMLImageElement | HTMLVideoElement;

/** Why the shell could not convert it (bridge decodeImage) */
type DecodeProblem = "heif" | "hevc" | "unreadable";

/** The two Microsoft Store extensions (needed to show HEIC / HEIF) */
const STORE = {
  heif: "https://apps.microsoft.com/detail/9pmmsr1cgpwg",
  hevc: "https://apps.microsoft.com/detail/9nmzlz57r3t7",
};

export function Viewer(props: {
  material: MaterialEntry;
  annotations: Annotation[];
  seek?: SeekRequest;
  /** Told when the item element on the canvas is attached / detached (used for screenshots and reading the current time). The caller's ref is the caller's to write; props refs are not mutated here (react(immutability)) */
  onMedia: (el: Media | null) => void;
  selectedId?: string;
  /** Original image size (for SVG the size it declares, for shell-converted images the size before conversion), see mediaSize.ts */
  onSize: (s: { w: number; h: number }) => void;
  /** A click on blank canvas: deselect; returns whether anything was selected (on video, a click while something is selected only deselects and does not play) */
  onBackgroundClick: () => boolean;
  onMarkClick: (id: string) => void;
  /** The notes panel's number of each note (VideoPlayer shows it on the play bar) */
  labels?: ReadonlyMap<string, { index: number; plain: boolean }>;
  /** A video's constant frame rate read from its header (VideoPlayer; null = none, undefined = not read yet): how times are shown (timeFormat.ts) */
  onFrameRate?: (fps: number | null | undefined) => void;
  layer: (size: { w: number; h: number }, t?: number, playing?: boolean, fps?: number) => React.ReactNode;
  /** The canvas cannot open (reports this URL): the drawing tools must be grayed out */
  onFail: (url: string) => void;
  /** Access to an item that could not be read was granted, and it is being loaded again: the drawing tools come back */
  onRetry: () => void;
  onReveal: () => void;
}) {
  const intl = useIntl();
  const base = materialUrl(props.material);
  // Each retry after access was granted loads from a new address: the failed request is not answered again from the one before
  const [attempt, setAttempt] = useState(0);
  const url = attempt ? `${base}&retry=${attempt}` : base;
  // The URL that failed to open (broken file, unsupported codec, missing system extension, no permission). The URL carries the modified
  // time, so once the file is fixed the URL changes and it retries naturally. checking: still asking the shell whether it was refused
  const [failed, setFailed] = useState<{
    url: string;
    code?: number;
    problem?: DecodeProblem;
    checking?: boolean;
    denied?: boolean;
    deniedReason?: DeniedReason;
  }>();
  const path = props.material.path;
  const fail = (code?: number, problem?: DecodeProblem) => {
    const what = `${path}${code ? ` (MediaError ${code})` : ""}${problem ? ` (${problem})` : ""}`;
    props.onFail(base);
    // A missing Windows extension or an over-long path already has its own explanation; anything else may be the system refusing access,
    // which to the page looks just like a damaged file
    if (problem === "heif" || problem === "hevc" || props.material.longPath) {
      setFailed({ url, code, problem });
      logError("Item failed to open", what, "warn");
      return;
    }
    setFailed({ url, code, problem, checking: true });
    void call("readable", { path })
      .then(
        () => ({ denied: false }),
        (e: unknown) =>
          e instanceof HostError && e.code === "denied"
            ? { denied: true, deniedReason: e.reason === "permissions" ? ("permissions" as const) : ("privacy" as const) }
            : { denied: false },
      )
      .then(({ denied, deniedReason }: { denied: boolean; deniedReason?: DeniedReason }) => {
        setFailed((f) => (f?.url === url ? { ...f, checking: false, denied, deniedReason } : f));
        logError("Item failed to open", `${what}${denied ? " (no permission)" : ""}`, "warn");
      });
  };
  const denied = failed?.url === url && failed.denied === true;
  const retried = useEffectEvent(() => {
    setAttempt((a) => a + 1);
    props.onRetry();
  });
  // Access is granted elsewhere (System Settings, the file's Properties): when the window gets focus back, ask again and load if it can be read
  useEffect(() => {
    if (!denied) return;
    const recheck = () =>
      void call("readable", { path }).then(
        () => retried(),
        () => {},
      );
    window.addEventListener("focus", recheck);
    return () => window.removeEventListener("focus", recheck);
  }, [denied, path]);
  if (failed?.url === url) {
    // Asking takes a moment: a blank canvas meanwhile, not first "the file may be damaged" and then a different reason
    if (failed.checking) return <div className="stage-empty" />;
    if (failed.denied) return <NoAccess folder={false} reason={failed.deniedReason} onReveal={props.onReveal} />;
    return (
      <MediaFailed
        kind={props.material.kind}
        code={failed.code}
        problem={failed.problem}
        longPath={props.material.longPath}
        onReveal={props.onReveal}
      />
    );
  }
  switch (props.material.kind) {
    case "image":
      return (
        <ImageMedia
          material={props.material}
          url={url}
          onMedia={props.onMedia}
          onSize={props.onSize}
          onBackgroundClick={props.onBackgroundClick}
          layer={props.layer}
          onFail={(problem) => fail(undefined, problem)}
        />
      );
    case "video":
      return (
        <VideoPlayer
          src={url}
          annotations={props.annotations}
          seek={props.seek}
          onMedia={props.onMedia}
          selectedId={props.selectedId}
          onSize={props.onSize}
          onMarkClick={props.onMarkClick}
          onBackgroundClick={props.onBackgroundClick}
          onFrameRate={props.onFrameRate}
          labels={props.labels}
          onError={fail}
          overlay={(t, s, playing, fps) => props.layer(s, t, playing, fps)}
        />
      );
    default:
      return (
        <div className="stage-empty">
          <KeepPunctuation>
            {intl.formatMessage({ id: "stage.unsupported" }, { kind: intl.formatMessage({ id: `kind.${props.material.kind}` }) })}
          </KeepPunctuation>
        </div>
      );
  }
}

/** The beginning of an SVG (including the root element's opening tag): used to get the original size. Empty when it cannot be read, in which case the browser's size is used */
async function svgHead(url: string): Promise<string> {
  try {
    const res = await fetch(url, { headers: { Range: "bytes=0-65535" } });
    return new TextDecoder().decode((await res.arrayBuffer()).slice(0, 65536));
  } catch {
    return "";
  }
}

/**
 * Image: what the browser can show itself is given by URL; TIFF and HEIC are first converted to PNG by the shell (decodeImage).
 * After loading, the original size and the drawn size are recorded (mediaSize.ts): an SVG is drawn enlarged enough and recorded at the size it declares; a converted image is recorded at its size before conversion
 */
function ImageMedia(props: {
  material: MaterialEntry;
  url: string;
  onMedia: (el: Media | null) => void;
  onSize: (s: Size) => void;
  onBackgroundClick: () => boolean;
  layer: (size: Size) => React.ReactNode;
  onFail: (problem?: DecodeProblem) => void;
}) {
  const { material, url } = props;
  /** The drawn size; set together with the loaded image (the ambient background takes its color from it), whether it is vector, and whether it is transparent, so refs are not read while rendering */
  const [shown, setShown] = useState<{ size: Size; img: HTMLImageElement; unit: number; vector: boolean; transparent: boolean }>();
  // WebKit on the Mac shows TIFF and HEIC itself; only WebView2 needs the shell to convert them
  const decode = platform !== "mac" && needsDecode(material.path);
  const [decoded, setDecoded] = useState<{ for: string; src: string; natural: Size }>();
  /** Incremented on each new load after the item changes: a load that was superseded while the SVG head was being read does not count */
  const loads = useRef(0);
  const reportFail = useEffectEvent((problem: DecodeProblem) => props.onFail(problem));

  useEffect(() => {
    loads.current++;
    if (!decode) return;
    let alive = true;
    call("decodeImage", { path: material.path })
      .then((r) => {
        if (!alive) return;
        if ("problem" in r) reportFail(r.problem);
        else setDecoded({ for: url, src: r.url, natural: { w: r.width, h: r.height } });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        logError("Converting image", e, "warn");
        reportFail("unreadable");
      });
    return () => {
      alive = false;
    };
  }, [decode, url, material.path]);

  const src = decode ? (decoded?.for === url ? decoded.src : undefined) : url;

  const loaded = async (img: HTMLImageElement) => {
    const mine = ++loads.current;
    const own = { w: img.naturalWidth, h: img.naturalHeight };
    const vector = isSvg(material.path);
    let natural = own;
    let work = own;
    if (vector) {
      natural = svgNaturalSize(await svgHead(url), own);
      work = vectorWork(natural);
      // The item changed and loaded again while the head was being read: this load does not count
      if (mine !== loads.current) return;
    } else if (decoded?.for === url) natural = decoded.natural;
    const transparent = vector || hasAlpha(img);
    rememberSize(img, { natural, work, vector, transparent });
    setShown({ size: work, img, unit: work.w / natural.w, vector, transparent });
    props.onSize(natural);
  };

  // The shell is still converting (no image yet): do not draw the previous item's marks
  const size = src ? shown?.size : undefined;
  return (
    <>
      <Ambient source={shown?.img ?? null} size={size} />
      <ZoomView size={size} onClick={props.onBackgroundClick} unit={shown?.unit} vector={shown?.vector}>
        {src && (
          <img
            ref={(el) => {
              props.onMedia(el);
            }}
            className={`zoom-media${shown?.transparent ? " is-transparent" : ""}`}
            src={src}
            crossOrigin="anonymous"
            draggable={false}
            onLoad={(e) => void loaded(e.currentTarget)}
            onError={() => props.onFail()}
            alt=""
          />
        )}
        {size && props.layer(size)}
      </ZoomView>
    </>
  );
}

/**
 * The explanation shown on the canvas when an item cannot open (otherwise an image is just blank and a video black, and the user cannot tell what happened).
 * A video's MediaError 4 (MEDIA_ERR_SRC_NOT_SUPPORTED) is mostly an unsupported codec, such as HEVC;
 * when a Windows extension is missing for HEIC / HEIF, it says which one and links to the Microsoft Store
 */
function MediaFailed(props: { kind: MaterialKind; code?: number; problem?: DecodeProblem; longPath?: boolean; onReveal: () => void }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string>) => intl.formatMessage({ id }, values);
  const store = props.problem === "heif" || props.problem === "hevc" ? props.problem : undefined;
  const body = props.longPath
    ? "stage.mediaError.longPath"
    : store
      ? `stage.mediaError.${store}`
      : props.kind === "video"
        ? props.code === 4
          ? "stage.mediaError.video.codec"
          : "stage.mediaError.video.broken"
        : "stage.mediaError.image.body";
  return (
    <div className="stage-empty" role="alert">
      <KeepPunctuation>
        <div className="stage-empty-title">
          {t(props.kind === "video" ? "stage.mediaError.video.title" : "stage.mediaError.image.title")}
        </div>
        <div className="muted">{t(body, { app: t("brand.name") })}</div>
      </KeepPunctuation>
      <div className="stage-empty-actions">
        {store && (
          <button
            className="btn btn-primary btn-small stage-empty-action"
            onClick={() => void call("openExternal", { url: STORE[store] }).catch(() => {})}
          >
            {t(`stage.mediaError.get.${store}`)}
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
