import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useIntl } from "react-intl";
import type { Annotation, MaterialKind } from "@sniptoss/core";
import { Ambient } from "./Ambient";
import { KeepPunctuation } from "./KeepPunctuation";
import { call, logError, materialUrl, type MaterialEntry } from "./host";
import { FolderIcon } from "./icons";
import { isSvg, needsDecode } from "./library";
import { hasAlpha, rememberSize, svgNaturalSize, vectorWork, type Size } from "./mediaSize";
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
  layer: (size: { w: number; h: number }, t?: number, playing?: boolean, fps?: number) => React.ReactNode;
  /** The canvas cannot open (reports this URL): the drawing tools must be grayed out */
  onFail: (url: string) => void;
  onReveal: () => void;
}) {
  const intl = useIntl();
  const url = materialUrl(props.material);
  // The URL that failed to open (broken file, unsupported codec, missing system extension). The URL carries the modified time, so once the file is fixed the URL changes and it retries naturally
  const [failed, setFailed] = useState<{ url: string; code?: number; problem?: DecodeProblem }>();
  const fail = (code?: number, problem?: DecodeProblem) => {
    setFailed({ url, code, problem });
    props.onFail(url);
    logError(
      "Item failed to open",
      `${props.material.path}${code ? ` (MediaError ${code})` : ""}${problem ? ` (${problem})` : ""}`,
      "warn",
    );
  };
  if (failed?.url === url)
    return (
      <MediaFailed
        kind={props.material.kind}
        code={failed.code}
        problem={failed.problem}
        longPath={props.material.longPath}
        onReveal={props.onReveal}
      />
    );
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
  const decode = needsDecode(material.path);
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
