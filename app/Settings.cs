using System.IO;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Windows;

namespace SnipToss.App;

/// <summary>
/// The app's own settings: the library, window position, interface preferences, stored at %APPDATA%\SnipToss\settings.json (see AppPaths; the old pizhu directory is copied over by LegacyMigration).
/// For development checks the environment variable SNIPTOSS_SETTINGS can point to another file, so tests don't touch the user's own list.
/// Read/write rules (a failed read used to be treated as empty settings, and the next write of the library wiped everything):
/// a failed read never overwrites with empty settings; a corrupt file is renamed and kept first, then restored from .bak; every write keeps the previous file as .bak
/// </summary>
sealed partial class Settings
{
    static readonly string FilePath = AppPaths.SettingsFile;

    // The window position is NaN when never recorded; System.Text.Json throws on NaN by default (which is why the window position was never saved at all)
    static readonly JsonSerializerOptions Json = new()
    {
        WriteIndented = true,
        NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.AllowNamedFloatingPointLiterals,
    };

    /// <summary>The library on the left (files and folders the user dragged in or added). Pinned ones come first</summary>
    public List<LibraryEntry> Library { get; set; } = [];

    /// <summary>Folders expanded in the list (absolute paths)</summary>
    public List<string> Expanded { get; set; } = [];

    /// <summary>Projects collapsed in the list (project folder = absolute path of the notes folder). Projects are expanded by default, so the collapsed ones are recorded</summary>
    public List<string> Collapsed { get; set; } = [];

    /// <summary>The item selected last time (absolute path); the next open continues from it</summary>
    public string? Selected { get; set; }

    public WindowPlacement Placement { get; set; } = new();

    /// <summary>Window always on top (menu "Window → Always on Top")</summary>
    public bool Topmost { get; set; }

    /// <summary>The UI's preferences (those in the settings panel); the structure is defined by packages/web/src/prefs.ts and stored here as is</summary>
    public JsonObject? Prefs { get; set; }

    /// <summary>Screen Capture (the hotkey, tray and so on are needed as soon as the shell starts, so they live here and not in Prefs)</summary>
    public CaptureSettings Capture { get; set; } = new();

    public static string Location => FilePath;

    // A few items the shell needs itself; if the UI has never saved them, defaults are used (the same as DEFAULT_PREFS in prefs.ts).
    // A wrong type (settings file edited by hand) also falls back to the default: GetValue used to throw, so the capture hotkey did nothing every time
    static string? Text(JsonNode? node) => node is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    public HashSet<string> SkipDirs =>
        new((Prefs?["skipDirs"] as JsonArray)?.Select(n => Text(n) ?? "").Where(s => s != "")
            ?? MaterialScanner.DefaultSkipDirs, StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// The color of note marks (Settings → Annotations), also the default for Screen Capture. Like the UI it accepts only #rrggbb: the shell used to pass the value through as is,
    /// so with a hand-edited "red" the main window was orange and Screen Capture was red
    /// </summary>
    public string MarkColor => Text(Prefs?["markColor"]) is { } c && HexColor().IsMatch(c) ? c : "#ff6a3d";

    [System.Text.RegularExpressions.GeneratedRegex(@"^#[0-9a-fA-F]{6}\z")]
    private static partial System.Text.RegularExpressions.Regex HexColor();

    /// <summary>The default category of a new note (Settings → Annotations)</summary>
    public string DefaultCategory => SnipToss.App.Capture.Categories.Valid(Text(Prefs?["defaultCategory"]));

    /// <summary>Text attached every time something is handed to AI (Settings → Copying)</summary>
    public string PromptExtra => Text(Prefs?["promptExtra"])?.Trim() ?? "";

    /// <summary>Interface language: a language code, or "system" (follow the system, the default; missing or unrecognized values are treated that way by Locale.Resolve too)</summary>
    public string? Language => Text(Prefs?["language"]);

    /// <summary>Automatic update check (Settings → General, on by default; only false turns it off)</summary>
    public bool UpdateCheck => Prefs?["updateCheck"] is not JsonValue v || !v.TryGetValue<bool>(out var on) || on;

    /// <summary>When the last automatic update check succeeded (UTC): checked at most once a day (Updates)</summary>
    public DateTime? UpdatesCheckedAt { get; set; }

    /// <summary>How many one-time migrations this settings file has been through (Migrate). Newly created settings are already at the latest; settings files from before have no such item, which counts as 0</summary>
    public int Migrations { get; set; }

    internal const int LatestMigration = 1;

    /// <summary>
    /// At startup, runs migrations that earlier settings files haven't had (each step runs only once and is recorded when done):
    /// 1 (Beta 58): "follow system" can now pick English. Earlier versions always showed a Chinese interface whatever the system language: existing users who never chose a language and whose system isn't Chinese are pinned to Chinese,
    ///   so the interface doesn't suddenly turn English after the upgrade (for example someone whose system language isn't Chinese but who has always used the Chinese interface). Those who want to follow the system pick "Follow system" in Settings
    /// </summary>
    public void Migrate(string systemLanguage)
    {
        if (Migrations >= LatestMigration) return;
        Update(s =>
        {
            if (s.Migrations < 1 && s.Language is null && Locale.Resolve(null, systemLanguage) != Locale.Source)
                (s.Prefs ??= [])["language"] = Locale.Source;
            s.Migrations = LatestMigration;
        });
    }

    /// <summary>
    /// Settings → Advanced → More formats (off by default, only true turns it on): folders also list the less common formats
    /// (MaterialScanner.More) and the context menu offers them
    /// </summary>
    public bool MoreFormats => Prefs?["moreFormats"] is JsonValue v && v.TryGetValue<bool>(out var on) && on;

    /// <summary>The settings file as it is on disk, or null when it's missing or can't be read. No side effects (Load restores backups and logs)</summary>
    internal static Settings? Peek() => TryRead(FilePath).Settings;

    /// <summary>Whether each kind of item is listed by default (same as DEFAULT_PREFS.kinds in prefs.ts): PDF / PPT can't be annotated yet, so they're off by default</summary>
    static readonly Dictionary<string, bool> DefaultKinds = new() { ["image"] = true, ["video"] = true, ["pdf"] = false, ["slides"] = false };

    /// <summary>
    /// Which kinds of items are listed. A kind the settings don't mention (a type added later, or absent from an old settings file) takes its default, the same as the UI's settings merge;
    /// the shell used to treat it as "off", so the UI showed it on while the scan didn't list it.
    /// Includes MaterialScanner.MoreKind when More formats is on (MaterialScanner.Listed)
    /// </summary>
    public HashSet<string> EnabledKinds
    {
        get
        {
            var kinds = Prefs?["kinds"] as JsonObject;
            var on = new HashSet<string>();
            foreach (var name in DefaultKinds.Keys.Concat(kinds?.Select(k => k.Key) ?? []).Distinct())
            {
                var set = kinds?[name] is JsonValue v && v.TryGetValue<bool>(out var b) ? b : (bool?)null;
                if (set ?? DefaultKinds.GetValueOrDefault(name)) on.Add(name);
            }
            on.Remove(MaterialScanner.MoreKind);
            if (MoreFormats) on.Add(MaterialScanner.MoreKind);
            return on;
        }
    }

    /// <summary>The file these settings read from and write to (a temp file in tests)</summary>
    [JsonIgnore]
    internal string StorePath { get; private set; } = FilePath;

    /// <summary>
    /// What to tell the user when something went wrong reading settings at startup (file corrupt, restored from backup); null if all is well. Shown after the UI loads (appInfo).
    /// Written in the current language only when used: at settings-read time it isn't known which language to use (the language is recorded in the settings)
    /// </summary>
    [JsonIgnore]
    public string? StartupNotice => noticeKey is null ? null : Locale.T(noticeKey, ("reason", noticeReason));

    string? noticeKey;
    string noticeReason = "";

    public static Settings Load() => LoadFrom(FilePath);

    internal static Settings LoadFrom(string path)
    {
        var read = TryRead(path);
        if (read.Status == ReadStatus.Ok) return read.Settings!.At(path);
        if (read.Status == ReadStatus.Missing)
        {
            // First use. Or the main file is gone but the backup is still there (shouldn't happen, but if it does use the backup)
            if (TryRead(path + ".bak") is { Status: ReadStatus.Ok, Settings: { } lost })
            {
                Log.Warn($"Settings file is missing, restored from backup: {path}");
                return lost.At(path, "shell.settings.restored");
            }
            return new Settings { Migrations = LatestMigration }.At(path); // newly installed: no need to run migrations meant for earlier versions
        }

        string? kept = null;
        if (read.Status == ReadStatus.Corrupt)
        {
            kept = Quarantine(path);
            Log.Error($"Settings file is corrupt, the original was renamed and kept at: {kept}", read.Error);
        }
        else
        {
            Log.Error($"Settings file could not be read (maybe held by another program): {path}", read.Error);
        }
        // What the user sees says what happened and whether to do anything; the full path and the reason are in the log
        var reason = kept is null ? "busy" : "corrupt";
        if (TryRead(path + ".bak") is { Status: ReadStatus.Ok, Settings: { } backup })
            return backup.At(path, "shell.settings.fromBackup", reason);
        return new Settings().At(path, "shell.settings.defaults", reason);
    }

    /// <summary>
    /// Changes the settings: re-read from disk first, change, then write back. With two windows open at once (say "Open with SnipToss" from the right-click menu started another one),
    /// each changes only the item it touched, and neither overwrites the other's added items with its stale copy.
    /// If the disk copy can't be read (corrupt, held), the in-memory copy is the base: empty settings never overwrite.
    /// Returns whether this write reached the disk: when it didn't, memory is still up to date and it is written at the next change (the UI uses this to tell the user when changing settings)
    /// </summary>
    public bool Update(Action<Settings> change)
    {
        var read = TryRead(StorePath);
        Settings target;
        if (read.Status == ReadStatus.Ok && !unsaved)
        {
            target = read.Settings!;
        }
        else if (read.Status == ReadStatus.Ok)
        {
            Log.Warn($"The previous settings weren't saved; writing again with the in-memory copy as the base: {StorePath}");
            target = Clone();
        }
        else
        {
            if (read.Status == ReadStatus.Corrupt) Log.Error($"Settings file is corrupt, the original was renamed and kept at: {Quarantine(StorePath)}; writing back the in-memory settings", read.Error);
            else if (read.Status == ReadStatus.Unreadable) Log.Warn($"Settings file could not be read, using the in-memory settings as the base: {StorePath}", read.Error);
            target = Clone();
        }
        target.StorePath = StorePath;
        change(target);
        unsaved = !target.Save();
        Library = target.Library;
        Expanded = target.Expanded;
        Collapsed = target.Collapsed;
        Selected = target.Selected;
        Placement = target.Placement;
        Topmost = target.Topmost;
        Prefs = target.Prefs;
        Capture = target.Capture;
        Migrations = target.Migrations;
        return !unsaved;
    }

    /// <summary>The last settings change didn't reach the disk (file in use, etc.): the next change takes the in-memory copy as the base, otherwise that change would be overwritten by the old content on disk</summary>
    bool unsaved;

    bool Save()
    {
        try
        {
            AtomicFile.Write(StorePath, JsonSerializer.SerializeToUtf8Bytes(this, Json), backup: StorePath + ".bak");
            return true;
        }
        catch (Exception ex)
        {
            // Failing to write doesn't affect this session (memory is up to date); the next settings change tries again
            Log.Error($"Saving settings failed: {StorePath}", ex);
            return false;
        }
    }

    /// <param name="notice">What to tell the user (a message); reason is the reason in the message (busy = held by another program and unreadable, corrupt = broken)</param>
    Settings At(string path, string? notice = null, string reason = "")
    {
        StorePath = path;
        noticeKey = notice;
        noticeReason = reason;
        return this;
    }

    Settings Clone() => JsonSerializer.Deserialize<Settings>(JsonSerializer.SerializeToUtf8Bytes(this, Json), Json)!;

    internal enum ReadStatus { Ok, Missing, Corrupt, Unreadable }

    internal readonly record struct ReadResult(ReadStatus Status, Settings? Settings, Exception? Error);

    internal static ReadResult TryRead(string path)
    {
        string text;
        try
        {
            if (!File.Exists(path)) return new(ReadStatus.Missing, null, null);
            text = AtomicFile.ReadAllText(path);
        }
        catch (Exception ex) when (ex is FileNotFoundException or DirectoryNotFoundException)
        {
            return new(ReadStatus.Missing, null, null);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return new(ReadStatus.Unreadable, null, ex);
        }
        try
        {
            return JsonSerializer.Deserialize<Settings>(text, Json) is { } s
                ? new(ReadStatus.Ok, s, null)
                : new(ReadStatus.Corrupt, null, new JsonException("Content is null"));
        }
        catch (JsonException ex)
        {
            return new(ReadStatus.Corrupt, null, ex);
        }
    }

    /// <summary>Renames a corrupt settings file and keeps it (settings.corrupt-TIMESTAMP.json), returning the kept path; returns the original path if renaming fails</summary>
    static string Quarantine(string path)
    {
        var kept = Path.Combine(Path.GetDirectoryName(path)!,
            $"{Path.GetFileNameWithoutExtension(path)}.corrupt-{DateTime.Now.ToString("yyyyMMdd-HHmmss-fff", System.Globalization.CultureInfo.InvariantCulture)}{Path.GetExtension(path)}");
        try
        {
            File.Move(path, kept);
            return kept;
        }
        catch (Exception ex)
        {
            Log.Warn($"Could not rename the corrupt settings file: {path}", ex);
            return path;
        }
    }
}

sealed class CaptureSettings
{
    /// <summary>
    /// The global hotkey, such as "Ctrl+Alt+A"; empty = no hotkey. Default Ctrl+Alt+A (in line with the habits of common screenshot tools);
    /// other combinations easily clash with the shortcuts of input methods, screenshot tools and chat apps
    /// </summary>
    public string Hotkey { get; set; } = "Ctrl+Alt+A";

    /// <summary>
    /// The hotkey was recorded by the user in Settings. One never recorded (the default) is replaced automatically at startup if it would type a character in an installed keyboard layout (<see cref="Capture.GlobalHotKey.TypedChars(string)"/>);
    /// one the user recorded is left alone and the settings page warns about it
    /// </summary>
    public bool HotkeyCustom { get; set; }

    /// <summary>Keep running in the tray after the window is closed, so the hotkey keeps working (only "Exit" in the tray menu really quits)</summary>
    public bool KeepInTray { get; set; } = true;

    /// <summary>The tray's "still running in the background" message is shown only once</summary>
    public bool TrayHintShown { get; set; }

    /// <summary>Screen Capture has been finished once: the few lines of beginner hints under the magnifier on the capture overlay (drag to select an area, click to select a window, Esc to exit) are no longer shown</summary>
    public bool SelectHintDone { get; set; }

    /// <summary>When the Capture button in the window is clicked, hide this window first so it isn't captured</summary>
    public bool HideWindow { get; set; } = true;

    /// <summary>
    /// When there are notes, write the numbered notes below the image. When the clipboard holds both an image and text, some desktop AI apps paste only the image,
    /// so writing the notes into the image keeps them even when only the image is pasted
    /// </summary>
    public bool NotesInImage { get; set; } = true;

    /// <summary>Where screenshots are stored; empty = %LOCALAPPDATA%\SnipToss\captures (kept 30 days)</summary>
    public string? Folder { get; set; }

    public static string DefaultFolder => System.IO.Path.Combine(AppPaths.LocalDir, "captures");

    [JsonIgnore]
    public string FolderOrDefault => string.IsNullOrWhiteSpace(Folder) ? DefaultFolder : Folder;
}

sealed class LibraryEntry
{
    public string Path { get; set; } = "";
    /// <summary>Pinned: sorted first, kept when the library is cleared</summary>
    public bool Pinned { get; set; }
}
