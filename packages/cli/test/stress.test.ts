// Concurrent-write stress test (docs/adr/0005-write-protocol.md; the 1.0 exit criterion "thousands of interleaved writes lose no change"):
// several processes write back to the same notes file at once (several agents resolving while the UI edits), and every change must survive
import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAll } from "../src/fs-store.js";

const FIXTURE = fileURLToPath(new URL("../../core/test/fixture/", import.meta.url));
const WRITER = fileURLToPath(new URL("./stress/writer.mjs", import.meta.url));

function run(args: string[]): Promise<{ code: number | null; err: string }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [WRITER, ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("exit", (code) => resolve({ code, err }));
  });
}

describe("concurrent-write stress", () => {
  it("4 processes each add 250 replies to the same note (1000 interleaved writes in all): none is lost", async () => {
    const root = await mkdtemp(join(tmpdir(), "sniptoss-stress-"));
    try {
      await cp(FIXTURE, root, { recursive: true });
      const id = "k3f9a2";
      const before = (await loadAll(root)).files.flatMap((f) => f.file.annotations).find((a) => a.id === id)!.replies.length;
      const results = await Promise.all(["w0", "w1", "w2", "w3"].map((tag) => run([root, id, tag, "250"])));
      for (const r of results) expect(r.code, r.err).toBe(0);
      const after = (await loadAll(root)).files.flatMap((f) => f.file.annotations).find((a) => a.id === id)!.replies;
      const mine = after.slice(before).map((r) => r.body);
      const lost = ["w0", "w1", "w2", "w3"]
        .flatMap((t) => Array.from({ length: 250 }, (_, k) => `${t}-${k}`))
        .filter((b) => !mine.includes(b));
      expect(lost, `${lost.length} changes were lost`).toEqual([]);
      expect(after.length).toBe(before + 1000);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 300_000);
});
