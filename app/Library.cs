using System.IO;

namespace SnipToss.App;

/// <summary>
/// The library on the left: files and folders the user dragged in or added. Add, remove and change all go through Settings.Update (read the disk first, then modify);
/// the list is only a "handy place", and neither removing nor clearing touches the files themselves.
/// </summary>
static class Library
{
    /// <summary>Normalizes to an absolute path and strips a trailing \ (the root of a drive, E:\, is kept)</summary>
    public static string Norm(string path)
    {
        var full = Path.GetFullPath(path);
        var root = Path.GetPathRoot(full) ?? "";
        return full.Length > root.Length ? full.TrimEnd('\\') : full;
    }

    public static bool Same(string a, string b) => string.Equals(Norm(a), Norm(b), StringComparison.OrdinalIgnoreCase);

    /// <summary>The key for comparisons: the normalized path (as is if it can't be normalized), to be used with StringComparer.OrdinalIgnoreCase</summary>
    public static string Key(string path)
    {
        try
        {
            return Norm(path);
        }
        catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException)
        {
            return path;
        }
    }

    /// <summary>
    /// Which of a batch of paths are in the list (equal to one of its entries). The list is normalized to keys once instead of comparing pairs:
    /// each path used to normalize the whole list again, which is N² GetFullPath calls when thousands of separate files are dropped in
    /// </summary>
    public static Func<string, bool> Contains(IEnumerable<string> listed)
    {
        var keys = new HashSet<string>(listed.Select(Key), StringComparer.OrdinalIgnoreCase);
        return path => keys.Contains(Key(path));
    }

    /// <summary>path is inside folder (not folder itself)</summary>
    public static bool Inside(string path, string folder) => KeyInside(Norm(path), Norm(folder));

    /// <summary>Same, with both sides already normalized (Key / Norm). A drive root has a trailing \ after normalizing: E:\ doesn't count as being inside E:\</summary>
    static bool KeyInside(string path, string folder)
    {
        var prefix = folder.EndsWith('\\') ? folder : folder + "\\";
        return path.Length > prefix.Length && path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Whether the drive (or network share) of the path is there: when it isn't, a USB stick isn't plugged in or a network drive isn't connected; the file wasn't deleted or moved.
    /// Use it on a background thread: a disconnected network drive waits for the system timeout (see Volumes)
    /// </summary>
    public static bool DriveThere(string path) => Volumes.ThereWait(path);

    /// <summary>The path is in (or is) a notes data directory (.sniptoss, or the not-yet-migrated .pizhu): those are notes and snapshots, not items</summary>
    static bool InDataDir(string full) =>
        full.Split('\\').Any(s => s.Equals(DataDir.Name, StringComparison.OrdinalIgnoreCase) || s.Equals(DataDir.LegacyName, StringComparison.OrdinalIgnoreCase));

    /// <summary>
    /// Whether the scan of folder (MaterialScanner.Scan) would list path: path is inside folder, none of the levels between is a hidden folder, a dot-prefixed one, a skipped folder or a directory link,
    /// and for a file its kind is turned on. Only then does "inside the folder" count as already in the list (it used to look only at the path, so dragging in a skipped file said "already in the list" when it was nowhere)
    /// </summary>
    internal static bool Covers(string folder, string path, HashSet<string> kinds, HashSet<string> skipDirs)
    {
        if (!Inside(path, folder)) return false;
        var cur = Norm(folder);
        var parts = Path.GetRelativePath(cur, Norm(path)).Split('\\');
        for (var i = 0; i < parts.Length; i++)
        {
            var name = parts[i];
            cur = Path.Combine(cur, name);
            if (name.StartsWith('.')) return false;
            FileAttributes attrs;
            try
            {
                attrs = File.GetAttributes(cur);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                return false;
            }
            if (attrs.HasFlag(FileAttributes.Hidden)) return false;
            if (attrs.HasFlag(FileAttributes.Directory))
            {
                // When the last level is the folder itself, it isn't listed if it is skipped or a link either (the scan doesn't enter it)
                if (skipDirs.Contains(name) || attrs.HasFlag(FileAttributes.ReparsePoint)) return false;
            }
            else if (i < parts.Length - 1 || MaterialScanner.Listed(name, kinds) is null || name.StartsWith("~$", StringComparison.Ordinal))
            {
                return false;
            }
        }
        return true;
    }

    /// <summary>The outermost folder entry in the list that contains path (or is path): for things added on their own that the scan skips, notes are stored with it (see Bridge.ScanAsync)</summary>
    public static string? OuterFolder(Settings settings, string path) => OuterFolder(settings.Library.Select(e => e.Path).Where(Directory.Exists), path);

    /// <summary>Same, but folders are the folder entries in the list (already checked to be folders, so the disk is queried only once during a scan)</summary>
    public static string? OuterFolder(IEnumerable<string> folders, string path) =>
        folders.Where(f => Same(f, path) || Inside(path, f)).Select(Norm).OrderBy(p => p.Length).FirstOrDefault();

    /// <summary>Relocated: the added item was recognized as the list entry that could no longer be found (moved elsewhere), and was replaced in place with its new location</summary>
    public sealed record AddResult(List<string> Added, string? Focus, List<string> Skipped, List<Relocation>? Relocated = null);

    /// <summary>A list entry went from From to To (the project folder was moved or renamed)</summary>
    public sealed record Relocation(string From, string To);

    /// <summary>
    /// Replaces an entry that was moved or renamed with its new location (when a project folder is moved, its list entry turns gray; before, the only way was to remove it and add it again): the path is replaced in place, position and pin are kept;
    /// old paths recorded in expanded, collapsed and last selected follow. If the new location is already in the list on its own (dragged in again), that entry is merged away. The notes are in the project's own .sniptoss and move with it
    /// </summary>
    public static Relocation Relocate(Settings settings, string from, string to)
    {
        var target = Norm(to);
        if (!Directory.Exists(target) && !File.Exists(target)) throw new FileNotFoundException("Not found", target);
        if (InDataDir(target)) throw new ArgumentException($"Inside {DataDir.Name}: {target}");
        settings.Update(s =>
        {
            var entry = s.Library.FirstOrDefault(e => Same(e.Path, from)) ?? throw new InvalidOperationException($"Not in the list: {from}");
            s.Library.RemoveAll(e => e != entry && Same(e.Path, target));
            Retarget(s, entry, target);
        });
        return new(from, target);
    }

    /// <summary>Switches this entry to target: its path, and those under it in expanded / collapsed / last selected, are all replaced</summary>
    static void Retarget(Settings s, LibraryEntry entry, string target)
    {
        var old = entry.Path;
        entry.Path = target;
        string Move(string p) => Same(p, old) ? target : Inside(p, old) ? Path.Combine(target, Path.GetRelativePath(old, p)) : p;
        s.Expanded = s.Expanded.Select(Move).ToList();
        s.Collapsed = s.Collapsed.Select(Move).ToList();
        if (s.Selected is { } sel) s.Selected = Move(sel);
    }

    /// <summary>
    /// Whether the newly added item is the list entry that could no longer be found (dragged in again after being moved): same name, both folders or same extension, and the original is really gone (probe.Gone).
    /// If recognized, it is replaced in place; otherwise the list would show one grayed and one normal entry, and the pin and position would have to be redone
    /// </summary>
    static LibraryEntry? MovedFrom(Settings s, string full, bool isDir, Probed probe)
    {
        var name = NameOf(full);
        return s.Library.FirstOrDefault(e =>
            string.Equals(NameOf(e.Path), name, StringComparison.OrdinalIgnoreCase)
            && (isDir ? MaterialScanner.KindOf(e.Path) is null : string.Equals(Path.GetExtension(e.Path), Path.GetExtension(full), StringComparison.OrdinalIgnoreCase))
            && !Same(e.Path, full)
            && probe.Gone.Contains(e.Path));
    }

    static string NameOf(string path) => Path.GetFileName(path.TrimEnd('\\'));

    /// <summary>Checked in the background before adding to the list (Probe). Items has one entry per path: Full is null = malformed path; Gone: the list entries with the same name that are really gone (their drive is still there)</summary>
    public sealed record Probed(List<ProbedPath> Items, HashSet<string> Gone);

    public sealed record ProbedPath(string Raw, string? Full, bool IsDir, bool Exists);

    /// <summary>
    /// The part of adding that queries the disk: whether each path exists and is a folder, and whether the same-named list entries that may have been moved still exist (MovedFrom).
    /// Done on a background thread: when a path or a list entry is on a disconnected network drive a query takes 10 seconds or more. listed is the paths of the list entries (copied on the UI thread first)
    /// </summary>
    public static Probed Probe(IReadOnlyList<string> listed, IEnumerable<string> paths)
    {
        var items = new List<ProbedPath>();
        foreach (var raw in paths)
        {
            string full;
            try
            {
                full = Norm(raw);
            }
            catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException)
            {
                items.Add(new(raw, null, false, false));
                continue;
            }
            // If the drive isn't there, don't ask one by one (each query on a disconnected network drive waits for a timeout)
            var there = Volumes.ThereWait(full);
            var isDir = there && Directory.Exists(full);
            items.Add(new(raw, full, isDir, isDir || (there && File.Exists(full))));
        }
        var names = new HashSet<string>(items.Where(i => i.Exists).Select(i => NameOf(i.Full!)), StringComparer.OrdinalIgnoreCase);
        // Entries whose whole drive is absent (USB stick unplugged, network drive not connected) don't count as moved: they are there once plugged back in. Before, casually adding something with the same name (items, assets) replaced it
        var gone = listed.Where(p => names.Contains(NameOf(p)) && DriveThere(p) && !Directory.Exists(p) && !File.Exists(p));
        return new(items, new HashSet<string>(gone, StringComparer.OrdinalIgnoreCase));
    }

    /// <summary>
    /// Adds to the list (drop, paste, dialog, open from outside): the disk queries run in the background (Probe), the list change returns to the calling thread. Call this on the UI thread,
    /// where the settings' "read the disk, change, write the disk" runs one at a time, so the two sides never change it simultaneously and overwrite each other
    /// </summary>
    public static async Task<AddResult> AddAsync(Settings settings, IReadOnlyCollection<string> paths)
    {
        var listed = settings.Library.Select(e => e.Path).ToList();
        var probe = await Task.Run(() => Probe(listed, paths));
        return Add(settings, probe);
    }

    /// <summary>Same, but the disk queries also run on this thread (unit tests; when all paths are on local drives)</summary>
    public static AddResult Add(Settings settings, IEnumerable<string> paths) => Add(settings, Probe(settings.Library.Select(e => e.Path).ToList(), paths));

    /// <summary>
    /// Adds to the list: new entries go below the pinned area and above the other entries. Ones already in the list (an entry itself, or reachable by a folder entry's scan) aren't added twice
    /// but are returned as Focus, and the UI locates it directly. Focus is the first path that can be opened this time.
    /// When a folder is added, the entries in the list that its scan reaches (subfolders and single files added earlier) are merged in: otherwise the same item would be listed in two places, and where its notes go would depend on which row is clicked;
    /// if a merged one was pinned, the new one is pinned too
    /// </summary>
    public static AddResult Add(Settings settings, Probed probe)
    {
        var added = new List<string>();
        var skipped = new List<string>();
        var relocated = new List<Relocation>();
        string? focus = null;
        settings.Update(s =>
        {
            var (kinds, skip) = (s.EnabledKinds, s.SkipDirs);
            var at = s.Library.Count(e => e.Pinned);
            // The normalized path of each entry is remembered (normalized once per entry): every added path below is compared against the whole list, and it used to normalize again each time, N² GetFullPath calls
            var keys = new Dictionary<LibraryEntry, string>();
            string KeyOfEntry(LibraryEntry e) => keys.TryGetValue(e, out var k) ? k : keys[e] = Key(e.Path);
            static bool Under(string path, string folder) => path.StartsWith(folder.EndsWith('\\') ? folder : folder + "\\", StringComparison.OrdinalIgnoreCase);
            foreach (var (raw, probed, isDir, exists) in probe.Items)
            {
                if (probed is not { } full)
                {
                    skipped.Add(Locale.T("shell.add.invalid", ("path", raw)));
                    continue;
                }
                if (!exists)
                {
                    skipped.Add(Locale.T("shell.notFound", ("path", full)));
                    continue;
                }
                if (InDataDir(full))
                {
                    skipped.Add(Locale.T("shell.add.dataDir", ("dir", DataDir.Name), ("path", full)));
                    continue;
                }
                if (!isDir && MaterialScanner.KindOf(full) is null)
                {
                    skipped.Add(Locale.T("shell.add.type", ("ext", Path.GetExtension(full)), ("name", Path.GetFileName(full))));
                    continue;
                }
                focus ??= full;
                // Pick by string first (only things inside can be reached by the scan), then query the disk
                if (s.Library.Any(e => string.Equals(KeyOfEntry(e), full, StringComparison.OrdinalIgnoreCase) || (Under(full, KeyOfEntry(e)) && Covers(e.Path, full, kinds, skip))))
                    continue;
                // The list entry that could no longer be found has moved: replace the path in place (position and pin kept) instead of adding another entry
                if (MovedFrom(s, full, isDir, probe) is { } moved)
                {
                    relocated.Add(new(moved.Path, full));
                    Retarget(s, moved, full);
                    keys[moved] = full;
                    added.Add(full);
                    continue;
                }
                var entry = new LibraryEntry { Path = full };
                if (isDir)
                {
                    var absorbed = s.Library.Where(e => Under(KeyOfEntry(e), full) && Covers(full, e.Path, kinds, skip)).ToList();
                    at -= s.Library.Take(at).Count(absorbed.Contains);
                    s.Library.RemoveAll(absorbed.Contains);
                    entry.Pinned = absorbed.Any(e => e.Pinned);
                }
                if (entry.Pinned)
                {
                    s.Library.Insert(s.Library.Count(e => e.Pinned), entry);
                    at++;
                }
                else s.Library.Insert(at++, entry);
                added.Add(full);
            }
        });
        return new(added, focus, skipped, relocated);
    }

    /// <summary>
    /// Tidy-up at startup: entries reachable by another folder entry's scan are merged into it (repairs duplicates saved before "add the subfolder first, then the parent" was handled). Returns how many were merged.
    /// reachable: which paths have a confirmed connected drive; the rest are skipped and tidied at the next start (this runs on the UI thread at startup, and a disconnected network drive takes 10 seconds per query, see Volumes)
    /// </summary>
    public static int Tidy(Settings settings, Func<string, bool>? reachable = null)
    {
        var there = reachable ?? (_ => true);
        List<LibraryEntry> Covered(Settings s)
        {
            var (kinds, skip) = (s.EnabledKinds, s.SkipDirs);
            // First pick by string only the ones "inside another" (runs at startup, most lists have no such pair, so no disk queries)
            var norm = s.Library.Select(e => (e, key: SafeNorm(e.Path) + "\\")).ToList();
            return norm
                .Where(x => norm.Any(f => f.e != x.e && x.key.StartsWith(f.key, StringComparison.OrdinalIgnoreCase) && x.key.Length > f.key.Length
                    && there(x.e.Path) && Covers(f.e.Path, x.e.Path, kinds, skip)))
                .Select(x => x.e)
                .ToList();
        }
        static string SafeNorm(string p)
        {
            try
            {
                return Norm(p).TrimEnd('\\');
            }
            catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException)
            {
                return p;
            }
        }
        if (Covered(settings).Count == 0) return 0;
        var n = 0;
        settings.Update(s =>
        {
            var covered = Covered(s);
            var (kinds, skip) = (s.EnabledKinds, s.SkipDirs);
            foreach (var e in covered.Where(e => e.Pinned))
                foreach (var f in s.Library.Where(f => !covered.Contains(f) && Covers(f.Path, e.Path, kinds, skip)))
                    f.Pinned = true;
            s.Library = [.. s.Library.Where(e => !covered.Contains(e) && e.Pinned), .. s.Library.Where(e => !covered.Contains(e) && !e.Pinned)];
            n = covered.Count;
        });
        return n;
    }

    /// <summary>Removes from the list (files aren't deleted; the UI shows a confirmation first). Returns how many were removed. When the open item is among those removed, "last selected" is cleared too (otherwise nothing is selected at the next start)</summary>
    public static int Remove(Settings settings, Func<LibraryEntry, bool> which)
    {
        var removed = 0;
        settings.Update(s =>
        {
            // Compare by normalized keys: it used to compare pairs with Same / Inside, so removing 6000 separate files normalized paths tens of millions of times and froze the UI for ten-odd seconds
            var gone = s.Library.Where(which).ToHashSet();
            var keys = new HashSet<string>(gone.Select(e => Key(e.Path)), StringComparer.OrdinalIgnoreCase);
            // Inside a removed entry: walk up from this path one level at a time, and hitting a removed one means it is (each path is normalized once, not compared with every removed one)
            bool Covered(string path)
            {
                for (var p = Key(path); !string.IsNullOrEmpty(p); p = Path.GetDirectoryName(p))
                    if (keys.Contains(p)) return true;
                return false;
            }
            s.Library.RemoveAll(gone.Contains);
            s.Expanded.RemoveAll(Covered);
            if (s.Selected is { } sel && Covered(sel)) s.Selected = null;
            removed = gone.Count;
        });
        return removed;
    }

    /// <summary>Pinning moves entries to the end of the pinned area; unpinning moves them to the front of the normal area. The UI pins by project and passes all entries of the project at once, whose order among themselves is unchanged</summary>
    public static void Pin(Settings settings, IEnumerable<string> paths, bool pinned)
    {
        settings.Update(s =>
        {
            var listed = Contains(paths); // normalize the paths to pin into keys first (as in Remove: comparing pairs took ten-odd seconds for thousands of entries)
            var targets = s.Library.Where(x => listed(x.Path)).ToList();
            if (targets.Count == 0) throw new InvalidOperationException(Locale.T("shell.error.notInList"));
            foreach (var e in targets) s.Library.Remove(e);
            var at = s.Library.Count(x => x.Pinned);
            foreach (var e in targets)
            {
                e.Pinned = pinned;
                s.Library.Insert(at++, e);
            }
        });
    }
}

/// <summary>
/// Where an item's notes are stored (the "notes folder" is the folder holding .sniptoss, see DataDir):
/// 1. Search upward from the item's folder for an existing .sniptoss (or the old name .pizhu not yet moved over) and use it if found: it was annotated in this project, so keep using the same one, and agents need to read only one place;
/// 2. If there is none: an item that came from a folder entry in the list → that folder; a file added on its own → its own folder.
/// This only works out the location; .sniptoss is created when a note is first really written.
/// </summary>
sealed class HomeFinder
{
    readonly Dictionary<string, string?> existing = new(StringComparer.OrdinalIgnoreCase);

    public string Find(string file, string? folderEntry)
    {
        var dir = Path.GetDirectoryName(file)!;
        return Existing(dir) ?? folderEntry ?? dir;
    }

    /// <summary>Searches upward from the folder of this path for an existing .sniptoss; null if none (for entries that can't be found: only places that really have notes count, no guessing)</summary>
    public string? ExistingHome(string path) => Path.GetDirectoryName(path) is { } dir ? Existing(dir) : null;

    /// <summary>The notes folder of a folder entry itself: the items inside it (when there is no deeper .sniptoss) are all stored here. outer is the outermost folder entry containing it (may be itself)</summary>
    public string FolderHome(string folder, string outer) => Existing(folder) ?? outer;

    string? Existing(string dir)
    {
        if (existing.TryGetValue(dir, out var hit)) return hit;
        string? found;
        try
        {
            found = DataDir.ExistsIn(dir) ? dir : null;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            found = null;
        }
        found ??= Path.GetDirectoryName(dir) is { } parent ? Existing(parent) : null;
        existing[dir] = found;
        return found;
    }
}
