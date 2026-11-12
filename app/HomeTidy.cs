using System.Collections.Concurrent;
using System.IO;
using System.Text.Json;

namespace SnipToss.App;

/// <summary>
/// Keeps .sniptoss out of the user's way: hidden in Explorer, and removed once it holds no notes (the last note was deleted, or it is found empty when read).
/// Removing deletes only what this app wrote: notes files with no notes and no drawings, REVIEW.md, project.json, the .gitignore it placed, snapshots it named.
/// Anything else stays, and then so does the folder.
/// Deleting a note keeps its snapshot because undo needs it. The snapshots of a removed folder are therefore set aside in the app's own cache for as long as the app runs
/// and put back before the next write into that folder (undo writes the notes back first), so undo works as before
/// </summary>
static class HomeTidy
{
    public enum Result
    {
        /// <summary>There is no .sniptoss here</summary>
        Nothing,
        /// <summary>It holds notes, or something that can't be judged (an unreadable notes file, a file being written, a link): left untouched</summary>
        Kept,
        /// <summary>This app's files are gone but the folder holds other files, so it stays</summary>
        Left,
        /// <summary>The folder is gone</summary>
        Removed,
    }

    /// <summary>Notes folder → where its snapshots were set aside</summary>
    static readonly ConcurrentDictionary<string, string> stashes = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// One at a time per notes folder: removing it, and every write into it (which first puts the snapshots back). Without this a note saved
    /// while the folder is being removed could have its snapshot set aside after the note was written, and lose it when the app quits
    /// </summary>
    static readonly ConcurrentDictionary<string, SemaphoreSlim> gates = new(StringComparer.OrdinalIgnoreCase);

    public static async Task<IDisposable> EnterAsync(string home)
    {
        var gate = gates.GetOrAdd(home, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync();
        return new Release(gate);
    }

    sealed class Release(SemaphoreSlim gate) : IDisposable
    {
        int done;

        public void Dispose()
        {
            if (Interlocked.Exchange(ref done, 1) == 0) gate.Release();
        }
    }

    /// <summary>Where snapshots are set aside (tests point it elsewhere)</summary>
    internal static string StashRoot = Path.Combine(AppPaths.LocalDir, "cache", "removed-snapshots");

    /// <summary>Marks .sniptoss as hidden (Explorer and the desktop don't show it by default; reading and writing by path are unaffected). Failing is harmless, just logged</summary>
    public static void Hide(string home)
    {
        try
        {
            var dir = new DirectoryInfo(Path.Combine(home, DataDir.Name));
            if (!dir.Exists || dir.Attributes.HasFlag(FileAttributes.Hidden)) return;
            dir.Attributes |= FileAttributes.Hidden;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            Log.Warn($"Could not hide {DataDir.Name} in {home}", ex);
        }
    }

    /// <summary>Removes .sniptoss if it holds no notes (see the class summary). Never throws</summary>
    public static async Task<Result> TidyAsync(string home)
    {
        using (await EnterAsync(home)) return await TidyInsideAsync(home);
    }

    static async Task<Result> TidyInsideAsync(string home)
    {
        var dir = Path.Combine(home, DataDir.Name);
        var started = false;
        try
        {
            if (!Directory.Exists(dir)) return Result.Nothing;
            var notes = Path.Combine(dir, "annotations");
            var shots = Path.Combine(dir, "snapshots");
            if (IsLink(dir) || IsLink(notes) || IsLink(shots)) return Result.Kept;
            var files = Directory.Exists(notes) ? Directory.GetFiles(notes) : [];
            // A lock or temp file here means someone is writing right now; any other stranger is not ours to judge
            if (files.Any(f => !f.EndsWith(".json", StringComparison.OrdinalIgnoreCase) || !IsEmptyNotes(f))) return Result.Kept;

            foreach (var f in files)
            {
                // Under the write lock, and looked at again: an agent or another write may have got in since the first look
                using (await FileLock.AcquireAsync(f))
                {
                    if (!File.Exists(f)) continue;
                    if (!IsEmptyNotes(f)) return started ? Result.Left : Result.Kept;
                    File.Delete(f);
                    started = true;
                }
            }
            started = true;
            File.Delete(Path.Combine(dir, "REVIEW.md"));
            File.Delete(Path.Combine(dir, "project.json"));
            var ignore = Path.Combine(dir, ".gitignore");
            if (File.Exists(ignore) && File.ReadAllText(ignore) == DataDir.GitIgnore) File.Delete(ignore); // one the user edited is theirs
            Stash(home, shots);
            var gone = RemoveIfEmpty(notes) & RemoveIfEmpty(shots) && RemoveIfEmpty(dir);
            Log.Info(gone ? $"Removed the empty notes folder: {dir}" : $"Cleared the empty notes folder, other files remain: {dir}");
            return gone ? Result.Removed : Result.Left;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            Log.Warn($"Could not remove the empty notes folder: {dir}", ex);
            return started ? Result.Left : Result.Kept;
        }
    }

    /// <summary>Before writing into a notes folder: puts back the snapshots set aside when it was removed (the write is undo bringing notes back, and they refer to these)</summary>
    public static void Restore(string home)
    {
        if (!stashes.TryGetValue(home, out var from)) return;
        try
        {
            var shots = Path.Combine(home, DataDir.Name, "snapshots");
            Directory.CreateDirectory(shots);
            foreach (var f in Directory.GetFiles(from))
            {
                var to = Path.Combine(shots, Path.GetFileName(f));
                if (!File.Exists(to)) File.Move(f, to);
            }
            Directory.Delete(from, recursive: true);
            // Forgotten only once everything is back: if this failed (the drive is away for a moment), the next write tries again
            stashes.TryRemove(home, out _);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            Log.Warn($"Could not put the snapshots back into {home}", ex);
        }
    }

    /// <summary>On quit the undo history ends with the app, so nothing needs the set-aside snapshots any more; on start, the same goes for what a run that didn't close normally left behind</summary>
    public static void DropStashes()
    {
        stashes.Clear();
        try
        {
            if (Directory.Exists(StashRoot)) Directory.Delete(StashRoot, recursive: true);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Left for the next start
        }
    }

    static void Stash(string home, string shots)
    {
        if (!Directory.Exists(shots)) return;
        foreach (var f in Directory.GetFiles(shots))
        {
            var name = Path.GetFileName(f);
            if (!Bridge.IsSnapshotName(name)) continue;
            var to = stashes.GetOrAdd(home, _ => Path.Combine(StashRoot, Guid.NewGuid().ToString("N")));
            Directory.CreateDirectory(to);
            File.Move(f, Path.Combine(to, name), overwrite: true);
        }
    }

    /// <summary>A notes file of this app (it names its schema) with no notes and no drawings. Unreadable or unrecognized content counts as not empty</summary>
    internal static bool IsEmptyNotes(string file)
    {
        try
        {
            using var doc = JsonDocument.Parse(AtomicFile.ReadAllText(file));
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return false;
            // Some other JSON that happens to have an empty "annotations" is not ours to delete
            if (!root.TryGetProperty("schema", out var schema) || schema.ValueKind != JsonValueKind.String) return false;
            var name = schema.GetString()!;
            if (!name.StartsWith("sniptoss/", StringComparison.Ordinal) && !name.StartsWith("pizhu/", StringComparison.Ordinal)) return false;
            // A field this version doesn't know (a later version may keep something else in the file) means the file is not known to be empty
            foreach (var field in root.EnumerateObject())
                if (field.Name is not ("schema" or "material" or "annotations" or "drawings")) return false;
            if (!root.TryGetProperty("annotations", out var list) || list.ValueKind != JsonValueKind.Array || list.GetArrayLength() > 0) return false;
            return !root.TryGetProperty("drawings", out var drawings) || (drawings.ValueKind == JsonValueKind.Array && drawings.GetArrayLength() == 0);
        }
        catch (JsonException)
        {
            return false;
        }
    }

    static bool IsLink(string dir) => Directory.Exists(dir) && File.GetAttributes(dir).HasFlag(FileAttributes.ReparsePoint);

    /// <summary>Not recursive on purpose: a folder that still holds something stays</summary>
    static bool RemoveIfEmpty(string dir)
    {
        if (!Directory.Exists(dir)) return true;
        if (Directory.EnumerateFileSystemEntries(dir).Any()) return false;
        Directory.Delete(dir);
        return true;
    }
}
