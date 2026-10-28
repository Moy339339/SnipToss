import { useEffect, useEffectEvent, useRef, useState, type RefObject } from "react";
import { useIntl } from "react-intl";
import type { Annotation, Shape } from "@sniptoss/core";
import type { Ask } from "./AskDialog";
import type { ComposerAnchor, ComposerValue } from "./Composer";
import { baseName } from "./host";
import type { FolderTarget, Library } from "./library";
import type { Notify } from "./report";

// The note being written in the composer (split out of Workspace): what is open, whether there is unsaved text, and picking it up again
// after quitting and reopening. Opening the composer and saving are in compose.ts

/** The note being written in the composer (not saved yet) */
export interface Draft {
  /** Present when editing an existing note */
  id?: string;
  /** Writing a folder comment: which folder it is for (none = the folder of the item on the canvas) */
  folder?: FolderTarget;
  /**
   * The places already marked (everything drawn on the canvas while the composer is open is added here, with the same number; ADR-0009).
   * A place with its own color carries color
   */
  shapes?: Shape[];
  /**
   * A place was recolored by right-click on the canvas while the composer was open: the note's color after the change (none = follow
   * Settings, see recolorPlace in markColors.ts). Absent if no recoloring happened, and saving then keeps the note's original color
   */
  noteColor?: { color?: string };
  time?: { start: number; end?: number };
  category: Annotation["category"];
  body: string;
  /** Where the input box goes inside the canvas area */
  anchor: ComposerAnchor;
  /** false = "open the composer automatically after drawing" is off in Settings, and the user presses Enter or clicks the draft to write */
  composing: boolean;
}

/**
 * Unsaved text in the composer lives in this localStorage entry: it survives a page reload and quitting and reopening the app
 * (File → Exit, quitting from the tray, shutdown). It used to be sessionStorage, which only covered reloads and was lost on quit
 */
const DRAFT_STORE = "sniptoss:draft";

export function useDraftState(opts: {
  /** The item open on the canvas (its key) */
  currentPath: RefObject<string | undefined>;
  library: Pick<Library, "loaded" | "byKey">;
  selectedKey: string | undefined;
  /** Size of the canvas: present = the canvas is up */
  dims: unknown;
  onNotify: Notify;
  /** Switch to the item that holds the stored draft */
  reveal: (path: string) => void;
  /** Show a confirm dialog (asks when there is unsaved text) */
  ask: (q: Ask) => void;
}) {
  const { currentPath, library, selectedKey, dims, onNotify } = opts;
  const intl = useIntl();
  const [draft, setDraft] = useState<Draft>();
  /** What the composer currently holds (reported by Composer) */
  const liveDraft = useRef<ComposerValue | undefined>(undefined);

  /**
   * Whether the composer holds unsaved text: something was written, or the original was changed (category and time count too).
   * Switching items or opening another composer used to drop it silently
   */
  const draftDirty = () => {
    const v = liveDraft.current;
    if (!draft?.composing || !v || !v.body.trim()) return false;
    return v.body.trim() !== draft.body.trim() || v.category !== draft.category || JSON.stringify(v.time) !== JSON.stringify(draft.time);
  };
  /**
   * For an action that replaces the composer: if there is unsaved text, ask first and act only after "Discard" (nested calls also ask
   * only once: discarding clears the composer first, see discardDraft)
   */
  const unlessDirty = (run: () => void, keep?: () => void) => {
    if (!draftDirty()) return run();
    opts.ask({ kind: "discard", body: liveDraft.current!.body.trim(), run, keep });
  };
  /** "Discard" was clicked in the confirm dialog: the composer is cleared together with the unsaved text */
  const discardDraft = () => {
    liveDraft.current = undefined;
    setDraft(undefined);
  };

  // The shell may reload the page (a newly added item is on a drive that was not mapped yet, see MainWindow.ReloadIfNewVolume; the UI process
  // is reloaded automatically after a crash), and the app may be quit: unsaved text in the composer is stored in localStorage (once a second + when
  // the page unloads) and picked up again on return. Half-written text used to be lost
  const saveForReload = useEffectEvent(() => {
    const v = liveDraft.current;
    if (!draft?.composing || !v || !v.body.trim()) return localStorage.removeItem(DRAFT_STORE);
    localStorage.setItem(
      DRAFT_STORE,
      JSON.stringify({
        material: draft.folder ? undefined : currentPath.current,
        draft: { ...draft, category: v.category, body: v.body, time: v.time },
      }),
    );
  });
  useEffect(() => {
    const save = () => saveForReload();
    const timer = window.setInterval(save, 1000);
    window.addEventListener("pagehide", save);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pagehide", save);
    };
  }, []);

  // After loading: if the stored draft is a folder comment, or the canvas happens to show that item → continue writing; if it belongs to
  // another item → say so and offer a "go back" action
  const restore = useRef<"pending" | "asked" | "done">("pending");
  useEffect(() => {
    if (restore.current === "done" || !library.loaded) return;
    const raw = localStorage.getItem(DRAFT_STORE);
    if (!raw) {
      restore.current = "done";
      return;
    }
    let saved: { material?: string; draft: Draft & { shape?: Shape } };
    try {
      saved = JSON.parse(raw);
    } catch {
      localStorage.removeItem(DRAFT_STORE);
      restore.current = "done";
      return;
    }
    if (!saved.material || (saved.material === selectedKey && dims)) {
      restore.current = "done";
      localStorage.removeItem(DRAFT_STORE);
      // Drafts stored by earlier versions have a single shape
      const { shape, ...rest } = saved.draft;
      setDraft({ ...rest, ...(shape && !rest.shapes ? { shapes: [shape] } : {}), composing: true });
      return;
    }
    const m = library.byKey.get(saved.material);
    if (!m) {
      restore.current = "done";
      localStorage.removeItem(DRAFT_STORE);
      return;
    }
    if (restore.current === "pending" && selectedKey && selectedKey !== saved.material) {
      restore.current = "asked";
      onNotify(intl.formatMessage({ id: "draft.restore.elsewhere" }, { name: baseName(m.path) }), {
        label: intl.formatMessage({ id: "draft.restore.go" }),
        run: () => opts.reveal(m.path),
      });
    }
    // Looked at only when the library has loaded, the item changed or the canvas came up; the rest (library.byKey, the toast) can use
    // whatever they are at that moment
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library.loaded, selectedKey, dims]);

  return { draft, setDraft, liveDraft, draftDirty, unlessDirty, discardDraft };
}
