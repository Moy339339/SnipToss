# ADR-0006 Data format versioning policy

- Status: accepted (2026-10-17)
- Related: `docs/annotation-format.md` (the contract itself); ADR-0007 (rename)

## Context
The notes folder (named `.pizhu/` before the rename, now `.sniptoss/`) is a **public interface** for agents to read: once the project is open source, others will write scripts, plugins and skills that read it. Currently:
- Only the `schema` string is checked; the shape of the fields is not (`store.ts` uses a type assertion).
- An unknown version throws immediately, so an older program cannot open a project written by a newer one.
- When a file is read and written back, fields the program does not recognize are dropped.
- The example in the format document still says `pizhu/2`.

## Decision
1. **Schema identifier**: `"sniptoss/<major version>"`. The version that carries the rename starts at `sniptoss/4` (continuing from `pizhu/3`, to show it is the same format carried on), and `pizhu/1`–`pizhu/3` remain readable.
2. **When to bump the major version**: only when "an older reader would misread" — removing a field, changing a field's meaning, changing the unit of a coordinate or time.
   **Adding only optional fields does not bump the version**; the document states "since which version" the field exists.
3. **Reads and writes preserve unknown fields**: if the JSON read contains fields the program does not recognize, they are written back untouched (both TS and C# must do this, with tests).
4. **Forward compatibility**: when a newer major version than its own is found → **open read-only** and show "this project's notes were written by a newer version; upgrade to edit them", with no error and no writes.
5. **Backward compatibility**: keep a sample file for every older version in `tests/golden/formats/`; migration tests ensure each can be read, and that after writing back it is upgraded to the current version with no content lost.
6. **Publish a JSON Schema**: `docs/schema/sniptoss-<major version>.schema.json`, maintained together with the format document; tests use it to validate every file the program writes.
7. **Validation**: validate against the schema on read; an invalid file must not make the whole folder fail to read — list it under "unreadable files" with the reason and carry on with the rest (the command line currently fails the whole command on one bad file; this has to change).
8. **The procedure for changing the format** (written into CONTRIBUTING.md): first change `docs/annotation-format.md` and the JSON Schema → add samples and migration tests → then change the code.

## Implementation
- Item 3: `parseMaterialFile` in `core/store.ts` only fills in missing values and does not rebuild the object, so unknown fields stay as they are; the three-way merge (`merge.ts`) already merged by field and kept unknown fields. Test: `packages/core/test/format.test.ts`.
- Item 4: `isNewerSchema` / `isWritable`. A readable file written by a newer version keeps its original schema and is read-only: the item cannot be drawn on in the UI, marks can be selected but not moved, and changing a status or any other change is stopped in one place, `commit`, with a notice;
  the command line's `updateAnnotation` returns `readonly`. A newer file that cannot be understood gets `reason = newer`.
- Item 5: `tests/golden/formats/` holds one each of `pizhu-1`–`pizhu-3` and `sniptoss-4`; `format.test.ts` reads each, writes it back and compares.
- Item 7: `checkMaterialFile` in `core/validate.ts` (the rules are in `docs/annotation-format.md` "Reading rules"). Errors are a `MaterialFileError` (`reason` + a `detail` containing only the field path and symbols);
  the explanatory text is supplied separately by the UI (messages `app.file.*`) and the command line. Files the UI cannot read are remembered by "notes folder + file name" and recover automatically when re-read after an external-change notification.
- Item 6: `docs/schema/sniptoss-4.schema.json` (the current one is `sniptoss-5.schema.json`, see ADR-0009). It governs the files the program writes (every field present, coordinates in 0–1); the reading rules are more lenient.
  `packages/core/test/schema.test.ts` validates the various files the program writes and what each version's sample looks like after writing back, and checks that "what the Schema rejects, the reading rules reject too";
  at the end of every e2e case it validates all `sniptoss/4` notes files in the project (those written by the UI and by the command line are all included).
- Item 8: the procedure is written into CONTRIBUTING.md "Changing the data format".
- On the C# side the notes content is not parsed for now (the shell reads and writes it as text only); the future `SnipToss.Core` (ADR-0003) is to be implemented against the same set of samples.

## Rejected alternatives
- **Bump the schema on every release**: scripts on the agent side would be broken by meaningless version changes.
- **Restart at `sniptoss/1` after the rename**: it would be confused with `pizhu/1`, making it unclear which format is meant; continuing from 4 is unambiguous at a glance.

## Consequences
- `parse` in `core/store.ts` becomes "validate + preserve unknown fields"; the C# `<Name>.Core` does the same.
- When migrating the old `.pizhu/` folder at rename time: the folder is renamed and the file contents need not be rewritten (they move up to `sniptoss/4` naturally on the next write).
