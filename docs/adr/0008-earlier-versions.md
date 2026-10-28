# ADR-0008 Notes on an overwritten item; overall comments get their own numbering

- Status: accepted (2026-10-23)
- Related: `docs/annotation-format.md` (`material_sha256`); ADR-0006 (the procedure for changing the format)

## Context
When an AI changes an item it usually saves a new file, but sometimes it overwrites in place (the same file name with different content). What the app used to do: draw the old marks unchanged on the new image, and show a yellow banner at the top of the notes panel,
"…was changed after the notes were written", with an "OK" button. Problems:
- Drawing old marks on the new image is wrong in itself: the coordinates are right for the old image, and handed to an AI they point at the wrong place.
- The banner needs the fingerprint of the whole file first, so it pops up after a 1-second wait and pushes the cards down by about 80 pixels, so a click aimed at a card hits empty space.
- "Which notes are old" was decided by comparing `updated_at` with the file's modification time: edit one word or change the status of an old note and `updated_at` changes, so it counts as new and is drawn back on the new image.
- The notes file holds a single fingerprint for the whole file (recorded when the first note was written), so new notes written after the overwrite cannot be told apart from old ones.

A related problem handled at the same time: overall comments, which have no position on the canvas, were numbered together with pins (1 is a pin, 2 is an overall comment, both orange circles), so "2" could not be found on the canvas.

Established principle: whether a note has been dealt with is up to the user and the app does not try to decide it; old notes stay as a record; whatever the AI produces is a new item and is imported again.

## Decision
1. **Every note records the fingerprint of the item at the time it was written**: the optional field `material_sha256` (since Beta 69; `sniptoss/4` does not bump its version, ADR-0006 item 2).
   A fingerprint different from the item's current one = the note was written on an earlier version. For older notes without this field: those written after the item's last modification count as the current version; earlier ones are judged by the whole-file `material.sha256`.
   The rule is written in one place only: `versions.ts` in core (shared by the UI and the command line), and stated in the "Reading rules" of the format document.
2. **Notes on an earlier version are not drawn on the canvas** (no marks, no numbers, no marks on the video's play bar). In the notes panel they move to a separate section at the bottom of that item, "Notes on an earlier version", and are neither deleted nor have their status changed.
   Selecting one makes the canvas show the snapshot taken when it was written (`.sniptoss/snapshots`: the whole frame + marks, longest side 1600), with a line of explanation on top and "Back to Current Version" (Esc).
   **The old item itself is not saved**: every note already keeps a snapshot of the whole frame from that time, which is enough to look at; saving whole old videos would take too much space.
3. **Copy as Text**: open notes on an earlier version are handed over as usual (their status is the user's to manage: leave the ones not addressed, delete the ones that are done or mark them done), in a separate section whose opening says the positions refer to the frame as it was then and the snapshot is authoritative.
   **Copy as Images** already uses that snapshot and is self-consistent; the caption says the note was written on an earlier version. **REVIEW.md** says so after each such note. The **command line** marks them in `list`, adds `earlier: true` to `--json`, and `review` follows REVIEW.md.
4. **How the app finds out the item changed**: whatever can be decided without reading the file is decided first (all notes written after the item's last modification → all of them are for this version; one note recorded a fingerprint and was written after the last modification → that is the current fingerprint).
   What cannot be decided is computed in a background queue (the one open on the canvas first); until the result is in, it is provisionally treated as "changed" (modification time later than the note, so most likely it really changed); images are settled in tens of milliseconds.
   The shell stores computed fingerprints locally keyed by "path + size + modification time" (`%LOCALAPPDATA%\SnipToss\cache\sha256.json`), so the same file is not read twice.
5. **The yellow banner and "OK" are removed**: "OK" meant "the old positions are still right on the new image", which contradicts item 2; the user marks again on the new image. The banner pushing the cards down goes away with it.
6. **Numbering is separated**: notes with a mark on the canvas (pin, rectangle, arrow, freehand) are numbered from 1, matching the numbers on the canvas, in orange circles; overall comments get their own section, "Overall notes", numbered from 1 with gray square badges (so they do not look like pins);
   notes on an earlier version are also numbered from 1 with gray squares. Order: on the canvas → overall comments → on an earlier version. Copy as Text uses the same sections and numbering; in Copy as Images only the notes on the canvas carry a numbered circle,
   and the file names read "overall comment 2" and "earlier version note 1". Folder comments (the group title already says so) also use gray square numbers.
   Numbers are only how the UI refers to notes and do not go into the notes file (REVIEW.md and the command line use the 6-character `id`), so the format does not change.
7. **Addendum: timestamped comments get their own section.** An overall comment on a video is really two different things: one about this whole frame, one about the whole video.
   A note with `anchor.time` and no `shape` is called a "timestamped comment"; it is placed after the notes on the canvas and before the overall comments (on the canvas → timestamped → overall → on an earlier version),
   numbered from 1 with gray squares; within the section it is **sorted by time** (it is not drawn on the canvas and has no number to match, and while watching the video you read it front to back). Overall comments are left with the ones that have neither time nor position.
   Copy as Text gets one more section heading, the file name of Copy as Images reads "timestamped comment 1", and the line in REVIEW.md says "Timestamped comment". The data format does not change (this kind of note could already be written before, using "Set time" in the overall-comment box).

## Rejected alternatives
- **Edit history / timeline** (switching between the image and notes at each point in time): overwriting is rare; version management is not this software's job; and it is the same kind of idea as the previously rejected "recognize the new version / before-and-after comparison". The snapshot of each note already covers "see it when you want to".
- **Clear old notes as soon as the item changes**, or **show an "overwritten" notice and then let old notes disappear**: it silently loses things, and after handing to an AI it may still need to read the notes again.
- **Save a copy of the whole old item as a cache**: snapshots already exist, and saving whole videos takes too much space.
- **Keep "OK"** (the old positions are still drawn on the new image): see item 5.
- **Decide by modification time only, without recording a fingerprint per note**: editing one word turns an old note into a new one, and new notes written after the overwrite cannot be told from old ones.
- **Put overall comments before the notes on the canvas** (as REVIEW.md "starts with the overall picture"): the notes panel is read side by side with the numbers on the canvas, so the first things seen should be those on the canvas; overall comments go after them as a separate section.
