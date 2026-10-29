# ADR-0005 Data write protocol

- Status: accepted (2026-10-17)
- Related: ADR-0003 (command line); `docs/host-api.md` hard rules 3 and 3a

## Context
The same notes file has three writers: the UI (via the shell), the command line (an agent writing a status back), and the user editing by hand. An agent writing back while the user is adding notes in the UI is the normal case. As things stood:
- The command line overwrote the whole file with `writeFile`, which is not atomic (a reader that hits it mid-write sees broken JSON).
- When the UI saved, it overwrote with its in-memory copy of the whole file: a status the command line had just resolved was wiped by the next UI save before the file-change notification arrived.
- The UI changed memory first and wrote to disk afterwards; if the write failed it only showed a notice, and memory and disk stayed inconsistent from then on. Two writes to the same file were not queued.
- The shell and the settings used fixed temp file names (`xxx.tmp`), so two writers at the same time stepped on each other.
- When the settings file failed to load it was treated as empty settings, and the next write wiped the library list.

## Decision
1. **Atomic replace**: every write = write a temp file with a unique name in the same folder (`.<file name>.<process id>-<random>.tmp`) → flush to disk → replace with `File.Move(overwrite)` / `rename`.
   Leftover `.tmp` files are ignored when reading, and ones older than a day are cleaned up at startup.
2. **Compare before writing (optimistic concurrency)**: a writer remembers the hash of the content it last read, and re-reads the disk before writing:
   - Hash unchanged → write directly.
   - Hash changed → take the disk as the base and **three-way merge by note id** (base = what was last read, ours = the changes in memory, theirs = what is on disk):
     different notes each keep their own changes; different fields of the same note each keep their own; if both sides changed the same field → for status fields (`status`, `resolution`) the later change wins, and for text fields ours wins and a log entry is written.
   - After the merged result is written, memory and the UI are updated.
3. **UI: update the UI first (it has to be fast), queue the disk write, and if the write fails go back to the state on disk and say why** (no more divergence); writes to one file are queued in order, and when its turn comes it writes the latest state of the UI.
   A commit carries "which version this change was computed from": if the UI changed between computing and committing (an agent's write-back synced in), the change is laid over the new state with a three-way merge instead of overwriting it with the stale whole file.
   Undo / redo also use the three-way merge: only that step's own change is reverted, and statuses the agent wrote back in the meantime are kept.
   (The first version said "write to disk first, update the UI once it succeeds"; the implementation changed to the above, which gives the same no-divergence result, and the user does not wait for the disk after drawing a mark.)
   UI-side implementation: the shell's `writeAnnotation` (a write with `expectSha256`) + core's `mergeMaterialFiles` + `flush` / `commit` in `Workspace.tsx`.
   Regression checks: `packages/core/test/merge.test.ts`, and the write-race test in `tests/shell/smoke.spec.ts` (real shell, `npm run e2e:shell`).
4. **Settings file**: when reading fails (bad JSON, file in use) **never treat it as empty settings**: if it is in use, retry; if it is corrupt, rename the original and keep it (`settings.corrupt-<time>.json`),
   restore from `.bak` first, and use default settings only when there is no backup, showing a notice until the user clicks OK; when changing settings and the file on disk cannot be read, the in-memory settings are the base, and so are they when the last save did not succeed.
   Every write keeps the previous one as `settings.json.bak` (`File.Replace`). Implementation: `app/Settings.cs`, tests: `tests/AppTests/SettingsTests.cs`.
5. **The command line and the shell use the same implementation** (`<Name>.Core`, ADR-0003) instead of writing one each.
6. **Stress tests**: a test that runs a UI writer and a command-line writer at the same time, randomly resolving / adding / editing thousands of times on the same file, and finally checks that no change was lost and that the file was valid JSON throughout.
   There are three now: `packages/cli/test/stress.test.ts` (4 command-line processes each write back 250 times to the same note),
   the test in `tests/AppTests/FileLockTests.cs` where the shell and the command line write the same file at the same time (the shell's conditional write + 2 command-line processes, 200 times each),
   and `tests/e2e/write-stress.spec.ts` (the one this item describes): the real UI (queued writes, three-way merge, syncing external changes, undo) performs random add, edit-text, delete and undo steps like a person, 300 steps,
   while 4 agents really run `sniptoss resolve / wontfix` 2,400+ times; status is changed only by agents and text only by the UI (notes are assigned to the agents by id), and at the end every change is checked to have survived, the full JSON could be read at all times, and no lock or temp file is left.
   `npm run stress` runs the full round (about 2 minutes); `npm run e2e` runs a small round of a dozen or so steps. On the UI side it goes through the mock host (mock-host takes the same lock as Bridge and retries the same way when a replace is refused).
   The full stress round caught the UI giving up saving after 3 refusals in a row: the retry was rewritten to be time-based, merging and rewriting for up to 10 seconds.
7. **Lock**: comparing before writing only covers "the moment of comparing"; between the comparison and the new file being swapped in (writing the temp file and flushing takes tens of milliseconds) others can still get in —
   4 command-line processes writing back 1,000 times concurrently lost 771 of them. So the whole "compare + write" section has to run under a lock:
   - The lock is `.<file name>.lock` next to the notes file; it counts as acquired only if **exclusive creation** succeeds; it contains "process id, time, computer id" and is deleted when the write is done.
     The computer id is the first 16 hex digits of the SHA-256 of the lowercased computer name, not the name itself: a lock left by a crash stays in the project folder, and computer names often carry the owner's name.
     A lock that holds the plain name (written before the hash was used) is still recognized as this computer's (`tests/golden/lock-machine.json`).
     The shell's `app/FileLock.cs` and `withFileLock` in the command line's `fs-store.ts` use the same name and the same rules (to be merged into one implementation later, see item 5).
   - The shell's lock uses `DeleteOnClose`: if the process crashes, the system deletes it. For a lock left by a crashed command line: it counts as left over if the writing process no longer exists (the process id is checked only for writes from the same computer;
     writes from another computer over a network drive cannot be checked) or the lock file has not changed for 10 seconds; **before deleting, read it again and delete only if it is still the same lock**, so a new lock someone has just put in place is not deleted.
   - Wait at most 10 seconds; if the lock cannot be taken, report "locked by another program the whole time" and do not write this time (the UI rolls back and explains, per item 3). If creation is refused all along (access denied) for a full 1 second,
     the folder does not allow writing, so report the error directly without waiting the full 10 seconds.
   - When reading the lock file (to see whether it is left over), **allow others to delete it**: the shell first used `File.ReadAllText` (which does not allow deletion), so a command line that was releasing its lock could not delete it,
     the failed deletion was swallowed, the lock stayed forever, and every writer waited the full 10 seconds (caught by the mixed-write stress test). The command line now also retries when it cannot delete its lock on release.
   - Known remaining window: when two writers decide at the same moment that the same old lock is expired, there is still a microsecond gap between "read again" and "delete". It can only be hit if a process crashes while holding the lock
     and two writers come to take it at exactly the same time; closing it completely would require deleting by handle (not possible in Node), to be revisited when the implementations are merged.

8. **Sequence numbers**: notifications about external changes can arrive late — between the shell reading the file and the notification reaching the UI, the UI may already have learned of a newer version from a refused write.
   The UI used to recognize only old versions it had seen itself (`lateEcho`: the last 6 versions); an old version that an agent had written in between and the UI had never seen was not recognized and was treated as "changed elsewhere again":
   in the three-way merge, notes the UI had not touched took the values from the notification, which rolls back to the old version, and the next write to disk wipes the status and reply the agent had just written back
   (seen in the write stress test `write-stress.spec.ts` about once every three runs when two runs were going at the same time).
   So every piece of notes content the shell hands to the UI carries a program-wide increasing sequence number `seq` (`Bridge.Observe`): notifications and reads of the notes folder take their number **before reading**;
   a write to disk takes its number **inside the lock**, after writing or after reading the current state when it was refused (at that point the content is fixed).
   A number taken before a read that is larger than one taken inside a lock = the file was opened after that lock section = what was read is not older (the disk only moves forward; the agent's writes are inside the lock too).
   The UI remembers the largest number it has seen for each file, and **does not merge notifications with a smaller number** (nor treats them as "the file was deleted"); if a dropped one was actually not old, it is at worst shown a little later, and the merge on the next refused write covers it, so nothing is lost.
   File modification time is not used: when two versions are written within the same system clock tick the times are equal and the order cannot be told.
   Regression checks: the test in `notes-panel.spec.ts` where an external-change notification arrives late carrying an old version the UI has never seen, `BridgePolicyTests`, and the write stress test.

## Rejected alternatives
- **Exclusive open of the notes file itself as the lock**: on Windows a crashed process does not release the lock, and when the user's editor or antivirus holds the file the whole write stalls; locks are unreliable when an agent writes over a network drive from another machine.
  (The lock in item 7 is a separate lock file next to the notes file and does not hold the notes file: an editor or antivirus having the notes file open does not prevent taking the lock; a lock left by a crash is reclaimed by process id and time; exclusive creation is still atomic on network drives.)
- **A `revision` counter in the data format**: it would require a format version bump, and the content hash already answers "was it changed by someone else"; revisit if real multi-user collaboration is ever built.
- **Last writer wins**: that is the problem itself.

## Consequences
- The shell's `WriteAsync`, `Settings.Save` and all command-line writes move onto this protocol; with tests.
- The "external change notification" only refreshes the UI; it no longer carries the responsibility of preventing data loss.
