import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, open, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  dataDirOf,
  earlierAll,
  findRoot,
  loadAll,
  saveMaterialFile,
  updateAnnotation,
  withFileLock,
  writeAtomic,
  writeReview,
} from "../src/fs-store.js";

const FIXTURE = fileURLToPath(new URL("../../core/test/fixture/", import.meta.url));

describe("fs-store", () => {
  it("returns nothing when the directory does not exist", async () => {
    expect(await loadAll(join(tmpdir(), "sniptoss-不存在-" + Date.now()))).toEqual({ files: [], unreadable: [] });
  });

  it("findRoot finds the project from inside a subfolder: walks up to the nearest .sniptoss like git, accepts the legacy .pizhu, falls back to the start folder", async () => {
    const root = await mkdtemp(join(tmpdir(), "sniptoss-"));
    try {
      const deep = join(root, "assets", "ui", "icons");
      await mkdir(join(root, ".sniptoss"), { recursive: true });
      await mkdir(deep, { recursive: true });
      expect(findRoot(deep)).toBe(root);
      expect(findRoot(root)).toBe(root);
      // The subfolder is a project of its own: the nearest one wins
      await mkdir(join(root, "assets", ".pizhu"));
      expect(findRoot(deep)).toBe(join(root, "assets"));
      const bare = await mkdtemp(join(tmpdir(), "sniptoss-"));
      try {
        expect(findRoot(bare)).toBe(bare);
      } finally {
        await rm(bare, { recursive: true, force: true });
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("REVIEW.md is updated after a status change", async () => {
    const root = await mkdtemp(join(tmpdir(), "sniptoss-"));
    try {
      await cp(FIXTURE, root, { recursive: true });
      const hero = (await loadAll(root)).files[0].file;
      hero.annotations[0].status = "resolved";
      await saveMaterialFile(root, hero);
      const { open: openCount } = await writeReview(root, "zh-CN");
      expect(openCount).toBe(1);
      const md = await readFile(join(root, ".sniptoss/REVIEW.md"), "utf8");
      expect(md).not.toContain("k3f9a2");
      expect(md).toContain("p0c7xe");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // The language of REVIEW.md follows what this notes folder has recorded (project.json, docs/annotation-format.md, "Folder settings"), the
  // same rules as the UI
  it("REVIEW.md language: an existing REVIEW.md with no recorded language is recorded as Chinese; a new folder records the current language; a recorded one is used as is", async () => {
    const root = await mkdtemp(join(tmpdir(), "sniptoss-"));
    try {
      await cp(FIXTURE, root, { recursive: true });
      const project = join(root, ".sniptoss/project.json");
      const review = join(root, ".sniptoss/REVIEW.md");
      await writeFile(review, "以前的版本写的\n");
      await writeReview(root, "en");
      expect(await readFile(project, "utf8")).toBe('{\n  "language": "zh-CN"\n}\n');
      expect(await readFile(review, "utf8")).toContain("# 待处理批注（2 条）");
      await writeFile(project, '{ "language": "en" }');
      await writeReview(root, "zh-CN");
      expect(await readFile(review, "utf8")).toContain("# Open notes (2)");
      expect(await readFile(project, "utf8")).toBe('{ "language": "en" }');
      await rm(project);
      await rm(review);
      await writeReview(root, "en");
      expect(await readFile(project, "utf8")).toBe('{\n  "language": "en"\n}\n');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // A project from before the rename (only .pizhu) that the new UI has not opened yet: agents can still write back, inside .pizhu, without
  // creating .sniptoss (docs/adr/0007-rename.md)
  it("only the legacy .pizhu exists: it is read and written in place, and snapshot paths in REVIEW.md say .pizhu too", async () => {
    const root = await mkdtemp(join(tmpdir(), "sniptoss-"));
    try {
      await cp(FIXTURE, root, { recursive: true });
      await rename(join(root, ".sniptoss"), join(root, ".pizhu"));
      expect(dataDirOf(root)).toBe(".pizhu");
      await writeReview(root, "zh-CN");
      expect(await readFile(join(root, ".pizhu/REVIEW.md"), "utf8")).toContain("截图：.pizhu/snapshots/k3f9a2.png");
      const hero = (await loadAll(root)).files[0].file;
      hero.annotations[0].status = "resolved";
      await saveMaterialFile(root, hero);
      expect(JSON.parse(await readFile(join(root, ".pizhu/annotations/assets__hero.png.json"), "utf8")).annotations[0].status).toBe(
        "resolved",
      );
      expect(existsSync(join(root, ".sniptoss"))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("both exist: .sniptoss is used; neither exists: still .sniptoss", async () => {
    const root = await mkdtemp(join(tmpdir(), "sniptoss-"));
    try {
      expect(dataDirOf(root)).toBe(".sniptoss");
      await cp(join(FIXTURE, ".sniptoss"), join(root, ".pizhu"), { recursive: true });
      await cp(join(FIXTURE, ".sniptoss"), join(root, ".sniptoss"), { recursive: true });
      expect(dataDirOf(root)).toBe(".sniptoss");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("atomic write: the content is complete after overwriting and no temporary file is left", async () => {
    const root = await mkdtemp(join(tmpdir(), "sniptoss-"));
    try {
      const path = join(root, "a", "b.json");
      await writeAtomic(path, "1");
      await writeAtomic(path, "22");
      expect(await readFile(path, "utf8")).toBe("22");
      expect((await readdir(join(root, "a"))).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // Node opens files in a way that allows others to replace them, so this never actually reaches the retry; opens that forbid replacing
  // (like an editor's) are covered by the shell's AtomicFileTests
  it("atomic write: the target can be replaced while it is open", async () => {
    const root = await mkdtemp(join(tmpdir(), "sniptoss-"));
    try {
      const path = join(root, "b.json");
      await writeAtomic(path, "old");
      const handle = await open(path, "r");
      setTimeout(() => void handle.close(), 100);
      await writeAtomic(path, "new");
      expect(await readFile(path, "utf8")).toBe("new");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // ---------- Unreadable files, files written by a newer version, write contention (ADR-0005, ADR-0006) ----------

  /** A temporary project (core's test fixture), deleted afterwards */
  async function withProject(fn: (root: string, dir: string) => Promise<void>) {
    const root = await mkdtemp(join(tmpdir(), "sniptoss-"));
    try {
      await cp(FIXTURE, root, { recursive: true });
      await fn(root, join(root, ".sniptoss", "annotations"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
  const read = async (dir: string, name: string) => JSON.parse(await readFile(join(dir, name), "utf8"));

  it("an overwritten item (content differs from the recorded fingerprint, modified after the notes) counts as an earlier version and REVIEW.md says so; unchanged content and missing items do not (ADR-0008)", async () => {
    await withProject(async (root, dir) => {
      await mkdir(join(root, "assets"), { recursive: true });
      await writeFile(join(root, "assets", "hero.png"), "第二版");
      const hero = await read(dir, "assets__hero.png.json");
      const openIds = hero.annotations.filter((a: { status: string }) => a.status === "open").map((a: { id: string }) => a.id);
      const all = (await loadAll(root)).files.map((f) => f.file);
      const earlier = await earlierAll(root, all);
      expect(earlier["assets/hero.png"]).toEqual(hero.annotations.map((a: { id: string }) => a.id));
      expect(earlier["video/intro.mp4"]).toBeUndefined(); // item missing: when unsure, it does not count
      await writeReview(root, "zh-CN");
      const md = await readFile(join(root, ".sniptoss", "REVIEW.md"), "utf8");
      for (const id of openIds)
        expect(md.split("\n").find((l) => l.startsWith(`### [${id}]`))).toMatch(/（写在旧版本上，位置以截图为准）$/);

      // The content has not actually changed (only the modified time is newer): once the recorded fingerprint is the current one, it does not count
      hero.material.sha256 = createHash("sha256").update("第二版").digest("hex");
      await writeFile(join(dir, "assets__hero.png.json"), JSON.stringify(hero, null, 2) + "\n");
      expect(
        await earlierAll(
          root,
          (await loadAll(root)).files.map((f) => f.file),
        ),
      ).toEqual({});
    });
  });

  it("a broken notes file is skipped and listed in unreadable; the others are read as usual", async () => {
    await withProject(async (root, dir) => {
      await writeFile(join(dir, "broken.png.json"), "{ 坏了");
      const { files, unreadable } = await loadAll(root);
      expect(files.map((f) => f.name)).toEqual(["assets__hero.png.json", "video__intro.mp4.json"]);
      expect(unreadable.map((e) => [e.file, e.reason])).toEqual([["broken.png.json", "json"]]);
      // REVIEW.md lists it at the top: agents read REVIEW.md first, and without that they would assume these are all the notes
      await writeReview(root, "zh-CN");
      const md = await readFile(join(root, ".sniptoss", "REVIEW.md"), "utf8");
      expect(md).toContain("> - .sniptoss/annotations/broken.png.json：不是合法的 JSON");
    });
  });

  it("updateAnnotation writes back to the original file name (no new file from the slug, so the same note does not appear twice)", async () => {
    await withProject(async (root, dir) => {
      await rename(join(dir, "assets__hero.png.json"), join(dir, "hero-old-name.json"));
      const r = await updateAnnotation(root, "k3f9a2", (a) => (a.status = "resolved"));
      expect(r.result).toBe("ok");
      expect((await read(dir, "hero-old-name.json")).annotations[0].status).toBe("resolved");
      expect(existsSync(join(dir, "assets__hero.png.json"))).toBe(false);
    });
  });

  it("updateAnnotation: when the UI changes the same file after it was found and before the write, it re-reads under the lock and keeps the UI's change", async () => {
    await withProject(async (root, dir) => {
      const r = await updateAnnotation(
        root,
        "k3f9a2",
        (a) => (a.status = "resolved"),
        async (path, attempt) => {
          if (attempt !== 1) return;
          const ui = JSON.parse(await readFile(path, "utf8"));
          ui.annotations.push({ ...ui.annotations[0], id: "new001", body: "界面刚加的" });
          await writeFile(path, JSON.stringify(ui, null, 2) + "\n");
        },
      );
      expect(r.result).toBe("ok");
      const after = (await read(dir, "assets__hero.png.json")).annotations;
      const states = after.map((a: { id: string; status: string }) => `${a.id}:${a.status}`);
      expect(states).toContain("k3f9a2:resolved");
      expect(states).toContain("new001:open");
    });
  });

  it("updateAnnotation leaves files written by a newer version alone", async () => {
    await withProject(async (root, dir) => {
      const name = "assets__hero.png.json";
      const newer = { ...(await read(dir, name)), schema: "sniptoss/6" };
      await writeFile(join(dir, name), JSON.stringify(newer));
      const r = await updateAnnotation(root, "k3f9a2", (a) => (a.status = "resolved"));
      expect(r).toEqual({ result: "readonly", schema: "sniptoss/6", name });
      expect(await readFile(join(dir, name), "utf8")).toBe(JSON.stringify(newer));
    });
  });

  it("updateAnnotation reports the unreadable files when the note is not found (it may be inside one)", async () => {
    await withProject(async (root, dir) => {
      await writeFile(join(dir, "broken.png.json"), '{ "schema": "sniptoss/4" }');
      const r = await updateAnnotation(root, "nope00", () => {});
      expect(r.result).toBe("missing");
      expect(r.result === "missing" && r.unreadable.map((e) => e.reason)).toEqual(["invalid"]);
    });
  });

  // ---------- Cross-process write lock (ADR-0005, "Locks"; the shell's side of the same rules is in tests/AppTests/FileLockTests.cs) ----------

  it("withFileLock: while held, a .<file name>.lock with the pid sits next to the file; it is deleted afterwards", async () => {
    await withProject(async (_root, dir) => {
      const path = join(dir, "a.json");
      const seen = await withFileLock(path, () => readFile(join(dir, ".a.json.lock"), "utf8"));
      expect(seen.startsWith(`${process.pid} `)).toBe(true);
      expect(existsSync(join(dir, ".a.json.lock"))).toBe(false);
    });
  });

  it("withFileLock: a lock whose process is gone (killed while holding it) is taken over at once", async () => {
    await withProject(async (_root, dir) => {
      const dead = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" }).stdout;
      await writeFile(join(dir, ".a.json.lock"), `${dead} ${Date.now()}`);
      const started = Date.now();
      expect(await withFileLock(join(dir, "a.json"), async () => "ok", 3000)).toBe("ok");
      expect(Date.now() - started).toBeLessThan(1000);
    });
  });

  it("withFileLock: a lock written by another computer (network drive) is not judged by pid, and a fresh one is not taken", async () => {
    await withProject(async (_root, dir) => {
      const dead = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" }).stdout;
      const lock = join(dir, ".a.json.lock");
      await writeFile(lock, `${dead} ${Date.now()} SOME-OTHER-PC`);
      await expect(withFileLock(join(dir, "a.json"), async () => "ok", 500)).rejects.toThrow("stayed locked");
      expect(existsSync(lock)).toBe(true);
    });
  });

  // If a stale lock that cannot be deleted just went on to the next round without checking the time limit, it would spin forever. The
  // read-only attribute does not block it (Node clears it before deleting), so deletion is denied through permissions
  it.skipIf(process.platform !== "win32")(
    "withFileLock: a stale lock that cannot be deleted (no permission) waits until the time limit and then fails, without spinning",
    async () => {
      await withProject(async (_root, dir) => {
        const dead = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" }).stdout;
        const lock = join(dir, ".a.json.lock");
        await writeFile(lock, `${dead} ${Date.now()}`);
        const user = spawnSync("whoami", { encoding: "utf8" }).stdout.trim();
        expect(spawnSync("icacls", [lock, "/deny", `${user}:(D)`]).status).toBe(0);
        expect(spawnSync("icacls", [dir, "/deny", `${user}:(DC)`]).status).toBe(0);
        try {
          await expect(withFileLock(join(dir, "a.json"), async () => "ok", 500)).rejects.toThrow("stayed locked");
        } finally {
          spawnSync("icacls", [dir, "/remove:d", user]);
          spawnSync("icacls", [lock, "/remove:d", user]);
        }
      });
    },
  );

  it("withFileLock: a lock just taken by a live process is not stolen; it gives up at the time limit", async () => {
    await withProject(async (_root, dir) => {
      const lock = join(dir, ".a.json.lock");
      await writeFile(lock, `${process.pid} ${Date.now()}`);
      await expect(withFileLock(join(dir, "a.json"), async () => "ok", 500)).rejects.toThrow("stayed locked");
      expect(existsSync(lock)).toBe(true);
    });
  });

  it.skipIf(process.platform !== "win32")(
    "withFileLock: when the folder is not writable it fails after a little over a second, not the full ten",
    async () => {
      await withProject(async (_root, dir) => {
        const user = spawnSync("whoami", { encoding: "utf8" }).stdout.trim();
        // Deny only "create files, create subfolders, delete what is inside": icacls's W includes SYNCHRONIZE, and denying that blocks even reading
        expect(spawnSync("icacls", [dir, "/deny", `${user}:(CI)(WD,AD,DC)`]).status).toBe(0);
        try {
          const started = Date.now();
          await expect(withFileLock(join(dir, "a.json"), async () => "ok")).rejects.toMatchObject({ code: "EPERM" });
          expect(Date.now() - started).toBeLessThan(3000);
        } finally {
          spawnSync("icacls", [dir, "/remove:d", user]);
        }
      });
    },
  );

  // The command line itself (dist must be compiled first: npm run build; skipped when it is not)
  const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));
  it.skipIf(!existsSync(CLI))(
    "CLI resolve still writes back with a broken file next to it, and mentions the broken file on stderr",
    async () => {
      await withProject(async (root, dir) => {
        await writeFile(join(dir, "broken.png.json"), "{ 坏了");
        const r = spawnSync(process.execPath, [CLI, "resolve", "k3f9a2", "-m", "改好了", "--root", root], { encoding: "utf8" });
        expect(r.status).toBe(0);
        expect(r.stderr).toContain("broken.png.json");
        expect((await read(dir, "assets__hero.png.json")).annotations[0].status).toBe("resolved");
        const list = spawnSync(process.execPath, [CLI, "list", "--json", "--root", root], { encoding: "utf8" });
        expect(() => JSON.parse(list.stdout)).not.toThrow(); // warnings do not leak into the JSON
      });
    },
  );
});
