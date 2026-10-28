import { useIntl } from "react-intl";
import type { Annotation, MaterialFile } from "@sniptoss/core";
import { ConfirmDialog } from "./Confirm";
import type { LibraryEntry } from "./host";
import type { Project } from "./library";
import type { RemoveTarget } from "./libraryModel";

// What the main window's confirm dialogs say (split out of Workspace). Names use the body color and are quoted, so it is obvious at a
// glance which one is affected

/**
 * Remove, clear and delete-notes all ask first and act only after confirmation (confirm or cancel up front, rather than relying on an
 * "Undo" toast afterwards)
 */
export type Ask =
  | { kind: "remove"; entries: LibraryEntry[]; what: RemoveTarget }
  | { kind: "clear" }
  | { kind: "delete"; annotation: Annotation; key: string }
  /** The checked notes are deleted together */
  | { kind: "deleteMany"; items: { a: Annotation; key: string }[] }
  /**
   * Everything listed in the notes panel (right-click on blank space, Edit menu's "Delete All Notes…"); hidden = how many in scope are
   * not listed and not deleted
   */
  | { kind: "deleteAll"; items: { a: Annotation; key: string }[]; hidden: number }
  /** The item is gone (missing): its whole notes file is deleted */
  | { kind: "deleteMissing"; key: string }
  /**
   * The composer holds unsaved text and the user is switching items or opening another composer: run only if discarded; keep when "Keep
   * editing" is chosen
   */
  | { kind: "discard"; body: string; run: () => void; keep?: () => void };

export function AskDialog(props: {
  ask: Ask;
  onClose: () => void;
  /** The notes file of an item (when the item is gone, says its path and note count) */
  fileOf: (key: string) => MaterialFile | undefined;
  projects: Project[];
  /** What confirming does */
  on: {
    /** Discard the unsaved text in the composer: clear the composer first, so the check nested inside run doesn't ask again */
    discardDraft: () => void;
    deleteMissing: (key: string) => void;
    deleteAnnotation: (a: Annotation, key: string) => void;
    deleteMany: (items: { a: Annotation; key: string }[]) => void;
    clearList: () => void;
    removeEntries: (entries: LibraryEntry[]) => void;
  };
}) {
  const { ask: q, onClose, on } = props;
  const intl = useIntl();
  const then = (run: () => void) => () => {
    onClose();
    run();
  };
  // The quotation marks around the name follow the language (Chinese corner brackets, English curly quotes)
  const name = (text: string) => <span className="confirm-name">{intl.formatMessage({ id: "ask.quoted" }, { text })}</span>;
  const keep = intl.formatMessage({ id: "ask.keep" });
  const onCancel = () => {
    onClose();
    // "Keep writing": the caret goes back into the composer
    if (q.kind === "discard") {
      q.keep?.();
      requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".composer-text")?.focus());
    }
  };
  const say = () => {
    if (q.kind === "discard")
      return {
        title: intl.formatMessage({ id: "draft.discard.title" }),
        body: (
          <>
            {name(q.body.length > 40 ? `${q.body.slice(0, 40)}…` : q.body)}
            {intl.formatMessage({ id: "draft.discard.body" })}
          </>
        ),
        confirm: intl.formatMessage({ id: "draft.discard.confirm" }),
        cancel: intl.formatMessage({ id: "draft.discard.keep" }),
        safeDefault: true,
        onConfirm: then(() => {
          on.discardDraft();
          q.run();
        }),
      };
    if (q.kind === "deleteMissing") {
      const file = props.fileOf(q.key);
      const count = file?.annotations.length ?? 0;
      return {
        title: intl.formatMessage({ id: "ask.missing.title" }, { count }),
        body: (
          <>
            {name(file?.material.path ?? "")}
            {intl.formatMessage({ id: "ask.missing.body" }, { count })}
          </>
        ),
        confirm: intl.formatMessage({ id: "ask.missing.confirm" }),
        onConfirm: then(() => on.deleteMissing(q.key)),
      };
    }
    /** The first 40 characters of a note (quoted): tells in the dialog which note is being deleted */
    const snippet = (a: Annotation) => {
      const text = a.body.trim().replace(/\s+/g, " ");
      return name(text.length > 40 ? `${text.slice(0, 40)}…` : text || intl.formatMessage({ id: "card.whole" }));
    };
    if (q.kind === "delete") {
      return {
        title: intl.formatMessage({ id: "ask.delete.title" }),
        body: (
          <>
            {snippet(q.annotation)}
            {intl.formatMessage({ id: "ask.delete.body" })}
            <br />
            {intl.formatMessage({ id: "ask.delete.undo" })}
          </>
        ),
        confirm: intl.formatMessage({ id: "ask.delete.confirm" }),
        onConfirm: then(() => on.deleteAnnotation(q.annotation, q.key)),
      };
    }
    if (q.kind === "deleteMany") {
      const materials = new Set(q.items.map((t) => t.key)).size;
      return {
        title: intl.formatMessage({ id: "ask.deleteMany.title" }, { count: q.items.length }),
        body: (
          <>
            {intl.formatMessage({ id: "ask.deleteMany.body" }, { count: q.items.length, materials })}
            <br />
            {intl.formatMessage({ id: "ask.delete.undo" })}
          </>
        ),
        confirm: intl.formatMessage({ id: "ask.delete.confirm" }),
        onConfirm: then(() => on.deleteMany(q.items)),
      };
    }
    if (q.kind === "deleteAll") {
      const materials = new Set(q.items.map((t) => t.key)).size;
      return {
        title: intl.formatMessage({ id: "ask.deleteAll.title" }, { count: q.items.length }),
        body: (
          <>
            {/* When only one is listed, say which one ("These 1 notes will be deleted" reads badly) */}
            {q.items.length === 1 ? (
              <>
                {snippet(q.items[0].a)}
                {intl.formatMessage({ id: "ask.delete.body" })}
              </>
            ) : (
              intl.formatMessage({ id: "ask.deleteMany.body" }, { count: q.items.length, materials })
            )}
            {q.hidden > 0 && (
              <>
                <br />
                {intl.formatMessage({ id: "ask.deleteAll.hidden" }, { count: q.hidden })}
              </>
            )}
            <br />
            {intl.formatMessage({ id: "ask.delete.undo" })}
          </>
        ),
        confirm: intl.formatMessage({ id: "ask.delete.confirm" }),
        onConfirm: then(() => on.deleteMany(q.items)),
      };
    }
    if (q.kind === "clear") {
      const pinned = props.projects.filter((p) => p.pinned).length;
      return {
        title: intl.formatMessage({ id: "ask.clear.title" }),
        body: (
          <>
            {intl.formatMessage({ id: "library.clear.body" }, { count: props.projects.length - pinned, pinned })}
            <br />
            {keep}
          </>
        ),
        confirm: intl.formatMessage({ id: "ask.clear.confirm" }),
        onConfirm: then(on.clearList),
      };
    }
    const n = q.entries.length;
    const onConfirm = then(() => on.removeEntries(q.entries));
    if (q.what.kind === "picked")
      return {
        title: intl.formatMessage({ id: "ask.removeMany.title" }, { count: q.what.count }),
        body: (
          <>
            {intl.formatMessage({ id: "ask.removeMany.body" }, { count: q.what.count })}
            <br />
            {keep}
          </>
        ),
        confirm: intl.formatMessage({ id: "ask.remove.confirm" }),
        onConfirm,
      };
    if (q.what.kind === "project")
      return {
        title: intl.formatMessage({ id: "ask.removeProject.title" }),
        body: (
          <>
            {name(q.what.name)}
            {intl.formatMessage({ id: "ask.removeProject.body" }, { count: n })}
            <br />
            {keep}
          </>
        ),
        confirm: intl.formatMessage({ id: "ask.remove.confirm" }),
        onConfirm,
      };
    return {
      title: intl.formatMessage({ id: "ask.remove.title" }),
      body: (
        <>
          {name(q.what.name)}
          {intl.formatMessage({ id: "ask.remove.body" })}
          <br />
          {keep}
        </>
      ),
      confirm: intl.formatMessage({ id: "ask.remove.confirm" }),
      onConfirm,
    };
  };
  return <ConfirmDialog {...say()} danger onCancel={onCancel} />;
}
