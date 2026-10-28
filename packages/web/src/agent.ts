import { SHIM_FILE } from "@sniptoss/core";
import { call, keyOf } from "./host";

// Older versions put a sniptoss.cmd in the .sniptoss of every project that had notes, and the text copied for AI told the agent to use it
// to mark notes as done after making the change. That step is gone (handing the AI what to change is enough, and the notes stay as a
// record), and the app no longer writes the file. Old copies left in user projects were put there by the app: they are deleted when the
// project is opened, so an agent that sees one doesn't run it anyway. Each project is cleaned once per launch
const cleaned = new Set<string>();

export async function removeOldShim(home: string): Promise<void> {
  if (cleaned.has(keyOf(home))) return;
  cleaned.add(keyOf(home));
  await call("deleteFile", { home, path: SHIM_FILE }).catch(() => {});
}
