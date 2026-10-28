#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { describeUnreadable, type AnnotationStatus, type MaterialFileError } from "@sniptoss/core";
import { earlierAll, findRoot, loadAll, updateAnnotation, writeReview } from "./fs-store.js";
import { systemLocale, translator } from "./i18n.js";

// The CLI's own messages follow the system display language (cli.* messages, the same set as the UI; a language whose AI messages
// are incomplete falls back to English, see systemLocale)
const t = translator(systemLocale());
const app = t("brand.name");

/** Notes files that cannot be read: skipped, with a note on stderr (kept out of the --json output) */
function warnUnreadable(unreadable: MaterialFileError[]) {
  for (const e of unreadable) console.error(t("cli.skipUnreadable", { file: e.file, reason: describeUnreadable(e, t) }));
}

/** The version follows the product (package.json in the repository root, shared with the UI and the shell; three levels above dist) */
function version(): string {
  try {
    return (JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { version: string }).version;
  } catch {
    return "unknown";
  }
}

const HELP = t("cli.help", { app });
async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      root: { type: "string" },
      all: { type: "boolean" },
      json: { type: "boolean" },
      message: { type: "string", short: "m" },
      author: { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
  if (values.version) {
    console.log(version());
    return 0;
  }
  const [command, ...rest] = positionals;
  if (values.help || !command) {
    console.log(HELP);
    return 0;
  }
  // Running inside a subfolder of the project works too: look upward for the nearest .sniptoss (like git)
  const root = findRoot(resolve(values.root ?? process.cwd()));

  switch (command) {
    case "review": {
      const { path, open, unreadable } = await writeReview(root);
      warnUnreadable(unreadable);
      console.log(t("cli.reviewWritten", { path, open }));
      return 0;
    }

    case "list": {
      const { files: loaded, unreadable } = await loadAll(root);
      warnUnreadable(unreadable);
      // Notes written on an earlier version of the item (the item was overwritten since): their positions refer to the old image, so the
      // snapshot is authoritative (ADR-0008).
      // --json adds earlier: true
      const earlier = await earlierAll(
        root,
        loaded.map((l) => l.file),
      );
      const rows = loaded.flatMap(({ file: f }) =>
        f.annotations
          .filter((a) => values.all || a.status === "open")
          .map((a) => ({
            material: f.material.path,
            kind: f.material.kind,
            ...a,
            ...(earlier[f.material.path]?.includes(a.id) ? { earlier: true } : {}),
          })),
      );
      if (values.json) {
        console.log(JSON.stringify(rows, null, 2));
      } else if (rows.length === 0) {
        console.log(t("cli.noNotes"));
      } else {
        // Whole-folder comments say so after the path, so they are not mistaken for a file
        for (const r of rows)
          console.log(
            `${r.id}  ${r.status.padEnd(8)}  ${r.kind === "folder" ? `${r.material}/${t("cli.wholeFolder")}` : r.material}${"earlier" in r ? t("cli.earlier") : ""}  ${r.body}`,
          );
      }
      return 0;
    }

    case "resolve":
    case "wontfix": {
      const id = rest[0];
      if (!id) {
        console.error(t("cli.usageStatus", { command }));
        return 2;
      }
      const status: AnnotationStatus = command === "resolve" ? "resolved" : "wontfix";
      const done = await updateAnnotation(root, id, (target) => {
        const now = new Date().toISOString();
        target.status = status;
        target.updated_at = now;
        if (values.message) target.replies.push({ author: values.author ?? "agent", body: values.message, at: now });
      });
      if (done.result === "missing") {
        warnUnreadable(done.unreadable);
        console.error(t("cli.notFound", { id, unreadable: done.unreadable.length ? "yes" : "no" }));
        return 1;
      }
      if (done.result === "readonly") {
        console.error(t("cli.readonly", { id, file: done.name, schema: done.schema, app }));
        return 1;
      }
      const { open, unreadable } = await writeReview(root);
      warnUnreadable(unreadable);
      console.log(t("cli.statusDone", { id, status, open }));
      return 0;
    }

    default:
      console.error(`${t("cli.unknownCommand", { command })}\n\n${HELP}`);
      return 2;
  }
}

main().then(
  (code) => {
    if (code !== 0) process.exitCode = code;
  },
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  },
);
