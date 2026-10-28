using System.IO;

namespace SnipToss.App;

/// <summary>
/// First start after the rename (pizhu → SnipToss, docs/adr/0007-rename.md): moves the app's own old data over. Everything is idempotent, what was done is logged, and failures don't block startup.
/// Test instances (SNIPTOSS_SETTINGS) skip it: their settings live elsewhere, and they shouldn't touch the registry of the user's own copy.
/// The .pizhu folders inside projects aren't moved here but when the project is opened (DataDir.Migrate)
/// </summary>
static class LegacyMigration
{
    /// <summary>Settings were just migrated from an old version at this start: the UI shows a notice once after loading (the write-back commands copied for AI before no longer work)</summary>
    public static bool JustMigrated { get; private set; }

    /// <summary>Settings and the Screen Capture archive: copied over (the old ones stay as a backup, not deleted). Must be called before the settings are read</summary>
    public static void MigrateAppData()
    {
        if (!AppPaths.WritesRegistry) return; // neither test instances nor portable builds migrate (a portable build's settings are in data; the old %APPDATA%\pizhu belongs to the installed copy)
        try
        {
            var roaming = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            JustMigrated = CopySettings(Path.Combine(roaming, AppPaths.LegacyDirName), Path.Combine(roaming, AppPaths.DirName));
            var captures = Path.Combine(local, AppPaths.LegacyDirName, "captures");
            if (JustMigrated && Directory.Exists(captures)) CopyMissing(captures, Path.Combine(local, AppPaths.DirName, "captures"));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            Log.Warn("Could not migrate settings from the old pizhu folder", ex);
        }
    }

    /// <summary>
    /// If the new directory has no settings.json but the old one does: copies every settings file from the old directory (settings.json, .bak, quarantined corrupt files).
    /// If new settings already exist nothing is done (migrate only once)
    /// </summary>
    internal static bool CopySettings(string oldDir, string newDir)
    {
        if (File.Exists(Path.Combine(newDir, "settings.json")) || !File.Exists(Path.Combine(oldDir, "settings.json"))) return false;
        Directory.CreateDirectory(newDir);
        // A quarantined corrupt file is named settings.corrupt-TIMESTAMP.json (Settings.Quarantine); matching settings.json* used to miss it; half-written temp files are excluded
        var files = Directory.EnumerateFiles(oldDir, "settings*.json*").Where(f => Path.GetFileName(f) is var n && (n == "settings.json.bak" || n.EndsWith(".json", StringComparison.OrdinalIgnoreCase)));
        foreach (var file in files)
            File.Copy(file, Path.Combine(newDir, Path.GetFileName(file)), overwrite: false);
        Log.Info($"Copied settings {oldDir} -> {newDir} (the old folder is kept as a backup)");
        return true;
    }

    /// <summary>Copies the files in from to to; same-named files already in to are left alone</summary>
    internal static void CopyMissing(string from, string to)
    {
        Directory.CreateDirectory(to);
        foreach (var file in Directory.EnumerateFiles(from))
        {
            var target = Path.Combine(to, Path.GetFileName(file));
            if (!File.Exists(target)) File.Copy(file, target);
        }
        foreach (var dir in Directory.EnumerateDirectories(from))
            CopyMissing(dir, Path.Combine(to, Path.GetFileName(dir)));
    }

    /// <summary>Registry: the old context menu is replaced by a new one (pointing at this program) and the old one deleted; an autostart entry pointing at the old program is repointed at this one</summary>
    public static void MigrateRegistry()
    {
        if (!AppPaths.WritesRegistry) return; // neither test instances nor portable builds touch the registry
        try
        {
            if (ShellIntegration.HasLegacy())
            {
                ShellIntegration.Set(true, ShellIntegration.MoreFormatsSetting());
                ShellIntegration.RemoveLegacy();
                Log.Info("Moved the Explorer context menu entry from pizhu to SnipToss");
            }
            if (Autostart.NeedsMigration())
            {
                Autostart.Set(true);
                Log.Info("Pointed the start-with-Windows entry at SnipToss.exe under the name SnipToss");
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or System.Security.SecurityException)
        {
            Log.Warn("Could not migrate the old pizhu registry entries", ex);
        }
    }
}
