using System.IO;

namespace SnipToss.App;

/// <summary>
/// The folder inside a notes folder that holds the notes data: .sniptoss (format in docs/annotation-format.md).
/// Before the rename it was .pizhu: opening a project renames an old one over (docs/adr/0007-rename.md). Only touches our own folder, never the items
/// </summary>
static class DataDir
{
    public const string Name = ".sniptoss";

    /// <summary>The old name: only used to recognize and move old projects over; new data is never written to it</summary>
    public const string LegacyName = ".pizhu";

    /// <summary>The write-back script an old version placed: after the rename the path it calls is wrong (the UI doesn't place even sniptoss.cmd now; opening a project deletes what was placed earlier)</summary>
    const string LegacyShim = "pizhu.cmd";

    /// <summary>Notes have been kept in this folder (either name counts)</summary>
    public static bool ExistsIn(string dir) =>
        Directory.Exists(Path.Combine(dir, Name)) || Directory.Exists(Path.Combine(dir, LegacyName));

    /// <summary>
    /// Which one to read notes from: .sniptoss if present; if it hasn't been moved over yet (and can't be, e.g. the project is in a read-only location), read the old .pizhu.
    /// Writes always go to .sniptoss (Bridge.InDataDir)
    /// </summary>
    public static string Active(string home)
    {
        var current = Path.Combine(home, Name);
        if (Directory.Exists(current)) return current;
        var legacy = Path.Combine(home, LegacyName);
        return Directory.Exists(legacy) ? legacy : current;
    }

    /// <summary>Contents of .sniptoss/.gitignore: ignores only the temp and lock files from writing; whether the notes themselves go into git is up to the user, so they are not ignored for them</summary>
    internal const string GitIgnore =
        "# SnipToss: temporary and lock files left while saving notes (normally removed right away).\n" +
        "# Your notes are not ignored; commit them or not as you like.\n" +
        "*.tmp\n" +
        "*.lock\n";

    /// <summary>
    /// After something has been written into .sniptoss, put a .gitignore there if none exists (a .tmp or .lock left by a power cut mid-write would otherwise show up in the git change list of the user's project).
    /// An existing one is left alone (the user may have edited it); failing to write is harmless, just logged
    /// </summary>
    public static void EnsureGitIgnore(string home)
    {
        var path = Path.Combine(home, Name, ".gitignore");
        if (File.Exists(path) || !Directory.Exists(Path.GetDirectoryName(path))) return;
        try
        {
            using var f = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None);
            f.Write(System.Text.Encoding.UTF8.GetBytes(GitIgnore));
        }
        catch (IOException) when (File.Exists(path))
        {
            // Another process just placed one
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            Log.Warn($"Could not write .gitignore: {path}", ex);
        }
    }

    public enum Outcome
    {
        /// <summary>No old one, nothing to move</summary>
        Nothing,
        /// <summary>The whole folder was renamed over</summary>
        Moved,
        /// <summary>Could not rename (a file inside is open in another program), so it was copied; the old one was deleted, or kept if it couldn't be deleted</summary>
        Copied,
        /// <summary>Both exist: the new one is used and the old one is left alone</summary>
        BothExist,
        /// <summary>Neither rename nor copy worked (read-only location etc.): keep reading the old one, try again next time</summary>
        Failed,
    }

    /// <summary>
    /// If only the old .pizhu exists, move it to .sniptoss: rename the whole folder first; if that can't be done, copy to a temp name and rename that to .sniptoss (never leaves a half-finished directory), then try to delete the old one.
    /// Idempotent; may be called every time a project is opened. Never throws; what was done is logged
    /// </summary>
    public static Outcome Migrate(string home)
    {
        var legacy = Path.Combine(home, LegacyName);
        var current = Path.Combine(home, Name);
        try
        {
            if (!Directory.Exists(legacy)) return Outcome.Nothing;
            if (Directory.Exists(current)) return Outcome.BothExist;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return Outcome.Failed;
        }

        try
        {
            Directory.Move(legacy, current);
            DeleteLegacyShim(current);
            Log.Info($"Moved {legacy} -> {current}");
            return Outcome.Moved;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            Log.Info($"Could not rename {legacy} ({ex.Message}); copying instead");
        }

        var staging = Path.Combine(home, $"{Name}.migrating-{Guid.NewGuid():N}");
        try
        {
            CopyTree(legacy, staging);
            Directory.Move(staging, current);
            DeleteLegacyShim(current);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            Log.Warn($"Could not migrate {legacy}; still reading it in place", ex);
            TryDelete(staging);
            return Outcome.Failed;
        }
        if (TryDelete(legacy)) Log.Info($"Copied {legacy} -> {current} and removed the old one");
        else Log.Warn($"Copied {legacy} -> {current}; the old one is still in use and was left behind");
        return Outcome.Copied;
    }

    static void DeleteLegacyShim(string dir)
    {
        try
        {
            File.Delete(Path.Combine(dir, LegacyShim));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Harmless to leave: the path it calls is wrong now, so an agent running it would get "not found"
        }
    }

    internal static void CopyTree(string from, string to)
    {
        Directory.CreateDirectory(to);
        foreach (var file in Directory.EnumerateFiles(from))
            File.Copy(file, Path.Combine(to, Path.GetFileName(file)));
        foreach (var dir in Directory.EnumerateDirectories(from))
            CopyTree(dir, Path.Combine(to, Path.GetFileName(dir)));
    }

    static bool TryDelete(string dir)
    {
        try
        {
            if (Directory.Exists(dir)) Directory.Delete(dir, recursive: true);
            return true;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return false;
        }
    }
}
