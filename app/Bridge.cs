using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Web.WebView2.Core;

namespace SnipToss.App;

/// <summary>
/// The bridge between the UI (packages/web/src/host.ts) and the disk. Message format:
///   UI → shell { id, method, params }
///   shell → UI { id, result } or { id, error }
/// Writes are allowed only into a notes folder's .sniptoss/ (DataDir): the app never modifies the item itself.
/// The shell works out the notes folders (homes) while scanning and hands them to the UI (see HomeFinder); writes accept only those that were handed out.
/// </summary>
sealed class Bridge(CoreWebView2 core, MainWindow window, Action onReady)
{
    static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    static readonly UTF8Encoding Utf8NoBom = new(false);

    /// <summary>Notes folders handed to the UI during a scan; reads and writes of notes accept only these</summary>
    readonly HashSet<string> homes = new(StringComparer.OrdinalIgnoreCase);

    Settings settings => window.Settings;

    public void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        // Accept messages only from our own UI (when web items are embedded later, other pages must not use this bridge to read or write the disk)
        if (!MainWindow.IsOwnUi(e.Source))
        {
            Log.Warn($"Bridge: ignoring a message not sent by our own UI ({e.Source})");
            return;
        }
        int id;
        string method;
        JsonElement args;
        List<string> files;
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            var msg = doc.RootElement;
            id = msg.GetProperty("id").GetInt32();
            method = msg.GetProperty("method").GetString() ?? "";
            args = msg.TryGetProperty("params", out var p) ? p.Clone() : default;
            // Files dropped on the window: the UI passes File objects with postMessageWithAdditionalObjects, which is the only way to get real paths here.
            // Files not on disk (images dragged out of a browser) have no path: don't hand them to Library.Add (it would report a cryptic "bad path:"); the UI explains when nothing was added
            files = e.AdditionalObjects?.OfType<CoreWebView2File>().Select(f => f.Path).Where(p => !string.IsNullOrEmpty(p)).ToList() ?? [];
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException or KeyNotFoundException or FormatException)
        {
            // Malformed message: there is no id to reply to, so log it and drop it (an exception here used to crash the app)
            Log.Warn($"Bridge: received a malformed message: {Truncate(e.WebMessageAsJson, 300)}", ex);
            return;
        }
        _ = HandleAsync(id, method, args, files);
    }

    static string Truncate(string s, int max) => s.Length <= max ? s : s[..max] + "…";

    async Task HandleAsync(int id, string method, JsonElement args, List<string> files)
    {
        string reply;
        try
        {
            object? result = method switch
            {
                "ready" => Ready(),
                "library" => await LibraryStateAsync(),
                "libraryAdd" => AfterAdd(await Library.AddAsync(settings, StrList(args, "paths"))),
                "addDropped" => AfterAdd(await Library.AddAsync(settings, files)),
                "pasteClipboard" => await PasteFromClipboardAsync(),
                "pickFiles" => PickFiles(),
                "pickFolder" => PickFolder(args.ValueKind == JsonValueKind.Object && args.TryGetProperty("title", out var title) ? title.GetString() : null),
                "libraryRemove" => RemoveFromLibrary(StrList(args, "paths")),
                "libraryRelocate" => RelocateEntry(Str(args, "from"), Str(args, "to")),
                "libraryPin" => Run(() => Library.Pin(settings, StrList(args, "paths"), args.GetProperty("pinned").GetBoolean())),
                "libraryExpanded" => Run(() => settings.Update(s => s.Expanded = StrList(args, "paths"))),
                "libraryCollapsed" => Run(() => settings.Update(s => s.Collapsed = StrList(args, "paths"))),
                "librarySelect" => Run(() => settings.Update(s => s.Selected = args.GetProperty("path").GetString())),
                "scan" => await ScanAsync(StrList(args, "paths").Where(Library.Contains(settings.Library.Select(e => e.Path))).ToList()),
                "readHomes" => ReadHomes(StrList(args, "homes")),
                "writeText" => await WriteAsync(Home(args), Str(args, "path"), Utf8NoBom.GetBytes(Str(args, "text"))),
                "writeAnnotation" => await WriteCheckedAsync(Home(args), Str(args, "path"), Str(args, "text"), args),
                "writeBase64" => await WriteAsync(Home(args), Str(args, "path"), Convert.FromBase64String(Str(args, "data"))),
                "deleteFile" => DeleteInDataDir(Home(args), Str(args, "path")),
                "pruneSnapshots" => PruneSnapshots(Home(args), StrList(args, "keep"), TimeSpan.FromMinutes(10)),
                "sha256" => await HashCache.Sha256Async(Allowed(Str(args, "path"), LibraryRoots())),
                "fileUrl" => window.UrlOf(InDataDir(Home(args), Str(args, "path"))),
                "decodeImage" => DecodedReply(await DecodedImages.GetAsync(Allowed(Str(args, "path"), LibraryRoots()))),
                "missing" => await MissingAsync(StrList(args, "paths")),
                "getPrefs" => settings.Prefs,
                "setPrefs" => Run(() => SetPrefs(args.GetProperty("prefs"))),
                "appInfo" => AppInfo(),
                "copyImages" => new { count = HandoffImages.Copy(HandoffItems(args), args.TryGetProperty("extra", out var extra) ? extra.GetString() : null) },
                "reveal" => await RevealAsync(Allowed(Special(Str(args, "path")), RevealRoots())),
                "openExternal" => Run(() => Shell.OpenUrl(Str(args, "url"))),
                "exportDiagnostics" => ExportDiagnostics(Str(args, "text")),
                "checkUpdates" => UpdateReply(await Updates.CheckAsync()),
                "log" => Run(() => WebLog(args)),
                "window" => window.Command(Str(args, "action")),
                "windowResize" => Run(() => window.StartResize(Str(args, "edge"))),
                "captureStart" => Run(() => window.StartCapture(fromButton: true)),
                "captureSettings" => window.CaptureState(),
                "setCaptureSettings" => window.SetCapture(args),
                "captureHotkeyPause" => Run(() => window.PauseHotkey(args.GetProperty("pause").GetBoolean())),
                "windowState" => window.State(),
                "shellIntegration" => ShellIntegration.IsEnabled(),
                "setShellIntegration" => Run(() => ShellIntegration.Set(args.GetProperty("enable").GetBoolean(), settings.MoreFormats)),
                "openDevTools" => Run(() =>
                {
                    core.Settings.AreDevToolsEnabled = true;
                    core.OpenDevToolsWindow();
                }),
#if TEST_HOOKS
                "debugThrow" => TestHooks.Throw(window, Str(args, "where")),
                "debugTray" => TestHooks.TrayState(window),
                "debugTrayAct" => TestHooks.TrayAct(window, Str(args, "action")),
                "debugCaptureFake" => TestHooks.CaptureFake(args),
                "debugCaptureDo" => await TestHooks.CaptureDo(args),
                "debugCaptureState" => TestHooks.CaptureState(),
                "debugCaptureResult" => TestHooks.CaptureResult(args),
                "debugCaptureErrorKey" => TestHooks.CaptureErrorKey(args),
                "debugHotkey" => TestHooks.Hotkey(window),
                "debugWindowShot" => TestHooks.WindowShot(window, args),
                "debugClipboardPng" => TestHooks.ClipboardPng(args),
#endif
                _ => throw new InvalidOperationException($"Unsupported method: {method}"),
            };
            reply = JsonSerializer.Serialize(new { id, result }, Json);
        }
        catch (Exception ex)
        {
            // Bad arguments, a file in use, no permission are expected (the UI tells the user): log at INFO; anything else is a bug: log at ERROR
            if (ex is ArgumentException or IOException or UnauthorizedAccessException or InvalidOperationException or KeyNotFoundException)
                Log.Info($"Bridge: {method} failed: {ex.Message}");
            else
                Log.Error($"Bridge: {method} failed unexpectedly", ex);
            reply = JsonSerializer.Serialize(new { id, error = ex.Message, code = ErrorCode(ex) }, Json);
        }
        try
        {
            core.PostWebMessageAsJson(reply);
        }
        catch (Exception ex)
        {
            // The page is reloading / already closed: nobody is left to receive this reply
            Log.Info($"Bridge: could not send the reply to {method}: {ex.Message}");
        }
    }

    // ---------- Let through only the paths that should be allowed (reveal / sha256 / openExternal used to accept any path, so openExternal could launch any program) ----------

    /// <summary>The path is one of roots or inside one of them</summary>
    internal static bool IsUnder(string path, IEnumerable<string> roots)
    {
        string full;
        try
        {
            full = Library.Norm(path);
        }
        catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException)
        {
            return false;
        }
        return roots.Any(r => Library.Same(full, r) || Library.Inside(full, r));
    }

    static string Allowed(string path, IEnumerable<string> roots) =>
        IsUnder(path, roots) ? path : throw new UnauthorizedAccessException($"Path is not in the material list or a notes folder: {path}");

    /// <summary>Remove from the library: the paths to remove are normalized to keys once (each entry used to re-parse and normalize all of paths)</summary>
    int RemoveFromLibrary(List<string> paths)
    {
        var remove = Library.Contains(paths);
        return Library.Remove(settings, e => remove(e.Path));
    }

    IEnumerable<string> LibraryRoots() => settings.Library.Select(e => e.Path);

    /// <summary>An image the shell converted to PNG (TIFF, HEIC): its URL and original size, or why it couldn't be converted (DecodedImages.Result)</summary>
    static object DecodedReply(DecodedImages.Result r) =>
        r.File is { } file
            ? new { url = $"https://{DecodedImages.Host}/{Uri.EscapeDataString(Path.GetFileName(file))}", width = r.Width, height = r.Height }
            : new { problem = r.Problem };

    /// <summary>
    /// Which of these items no longer exist (deleted, renamed, moved): the UI lists their notes separately instead of letting them vanish.
    /// Only paths in the library and in notes folders are checked; runs on a background thread (File.Exists blocks while a network drive is down)
    /// </summary>
    async Task<List<string>> MissingAsync(List<string> paths)
    {
        var roots = LibraryRoots().Concat(homes).ToList();
        var asked = paths.Where(p => IsUnder(p, roots)).ToList();
        // Don't query drives that aren't connected one by one (each query on a disconnected network drive waits for a timeout, see Volumes)
        await Volumes.WaitAsync(asked, Volumes.Patience);
        return await Task.Run(() => asked.Where(p => Volumes.Known(p) != true || (!File.Exists(p) && !Directory.Exists(p))).ToList());
    }

    /// <summary>Paths that may be shown in File Explorer: library entries, notes folders, the Screen Capture folder, the app's own settings / logs / program folder</summary>
    /// <summary>
    /// Shows the path in File Explorer. Runs on a background thread: it first checks whether the path is a file or a folder, which takes tens of seconds
    /// for items on a disconnected network drive or a sleeping NAS, and doing that on the UI thread used to freeze the whole window
    /// </summary>
    static async Task<object?> RevealAsync(string path)
    {
        await Task.Run(() => Shell.Reveal(path));
        return null;
    }

    IEnumerable<string> RevealRoots() =>
        LibraryRoots().Concat(homes).Append(settings.Capture.FolderOrDefault).Append(Settings.Location).Append(Log.Dir).Append(AppContext.BaseDirectory);

    /// <summary>
    /// Sorts common disk errors into a code; the UI explains it in the interface language (the system's original text in error follows Windows' language, often English).
    /// Before, only the original text was sent: saving a note in a folder without write permission showed just "Access to the path … is denied"
    /// </summary>
    internal static string? ErrorCode(Exception ex) => ex switch
    {
        UnauthorizedAccessException => "denied",
        DirectoryNotFoundException or FileNotFoundException or DriveNotFoundException => "notFound",
        PathTooLongException => "tooLong",
        IOException io => (io.HResult & 0xFFFF) switch
        {
            19 => "denied", // ERROR_WRITE_PROTECT: write-protected disk
            32 or 33 => "busy", // ERROR_SHARING_VIOLATION / ERROR_LOCK_VIOLATION
            39 or 112 => "diskFull", // ERROR_HANDLE_DISK_FULL / ERROR_DISK_FULL
            51 or 53 or 59 or 64 or 67 or 1231 => "network", // network path not found, or disconnected
            _ => null,
        },
        // CLIPBRD_E_CANT_OPEN: another program (remote desktop and clipboard tools often do this) still holds the clipboard after several retries. Lets Copy as Images fail with a plain-language message
        System.Runtime.InteropServices.COMException { HResult: unchecked((int)0x800401D0) } => "clipboardBusy",
        _ => null,
    };

    /// <summary>UI errors (ErrorBoundary, window.onerror) go into the same log. At most 60 per minute, so a UI error loop doesn't flood the log (WebLogLimiter)</summary>
    void WebLog(JsonElement args)
    {
        switch (webLogLimit.Take(DateTime.Now))
        {
            case WebLogLimiter.Verdict.Drop:
                return;
            case WebLogLimiter.Verdict.Notice:
                Log.Warn("UI: too many log entries within a minute; the rest are not recorded (resumes next minute)");
                return;
        }
        var message = Truncate(Str(args, "message"), 8000);
        switch (WebLogLevel(args))
        {
            case "warn":
                Log.Warn($"UI: {message}");
                break;
            case "info":
                Log.Info($"UI: {message}");
                break;
            default:
                Log.Error($"UI: {message}");
                break;
        }
    }

    readonly WebLogLimiter webLogLimit = new();

    /// <summary>Hands the update-check result to the UI (Help → Check for Updates and the automatic check after startup look the same): newer is null when there is none; when the check can't run, error is the reason (English original, for the log only)</summary>
    internal static object UpdateReply(Updates.Result r)
    {
        if (r.Error is not null) Log.Info($"Update check: could not check ({r.Error})");
        return new { newer = r.Newer is { } n ? new { version = n.Version, url = n.Url, prerelease = n.Prerelease } : null, error = r.Error };
    }
    /// <summary>Level of a UI log entry: error / warn / info; missing, null or anything else counts as error (null used to fall to info, so errors were logged as ordinary messages)</summary>
    internal static string WebLogLevel(JsonElement args) =>
        args.ValueKind == JsonValueKind.Object && args.TryGetProperty("level", out var l) && l.ValueKind == JsonValueKind.String && l.GetString() is "warn" or "info"
            ? l.GetString()!
            : "error";

    static string Str(JsonElement args, string name) =>
        args.ValueKind == JsonValueKind.Object && args.TryGetProperty(name, out var v) && v.GetString() is { } s
            ? s
            : throw new ArgumentException($"Missing argument: {name}");

    static List<string> StrList(JsonElement args, string name) =>
        args.ValueKind == JsonValueKind.Object && args.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Array
            ? v.EnumerateArray().Select(x => x.GetString() ?? "").Where(s => s != "").ToList()
            : [];

    static object? Run(Action action)
    {
        action();
        return null;
    }

    /// <summary>The notes folder in the arguments must be one that was handed out during a scan</summary>
    string Home(JsonElement args)
    {
        var home = Library.Norm(Str(args, "home"));
        return homes.Contains(home) ? home : throw new UnauthorizedAccessException($"Unknown notes folder: {home}");
    }

    /// <summary>"@settings" = the settings file, "@app" = the program folder, "@logs" = the log folder, anything else is an absolute path</summary>
    static string Special(string path) => path switch
    {
        "@settings" => Settings.Location,
        "@app" => AppContext.BaseDirectory,
        "@logs" => Directory.CreateDirectory(Log.Dir).FullName,
        _ => Path.IsPathRooted(path) ? path : throw new ArgumentException($"Absolute path required: {path}"),
    };

    async Task<object> LibraryStateAsync()
    {
        var entries = settings.Library.Select(e => (e.Path, e.Pinned)).ToList();
        var (expanded, collapsed, selected) = (settings.Expanded, settings.Collapsed, settings.Selected);
        // Paths brought in by the command line, the context menu, or a drop on a shortcut: the UI locates them after loading; what wasn't added and any moved items that were recognized are reported together
        var (focus, skipped, relocated) = window.Pending.Take();
        // Checking whether each entry still exists runs on a background thread; an entry on a disconnected network drive or a sleeping NAS takes ten-odd seconds to check, so check per drive first (waiting only a moment, see Volumes)
        // and don't ask about entries on a drive that isn't connected: the whole list used to wait for all of them to time out
        await Volumes.WaitAsync(entries.Select(e => e.Path), Volumes.Patience);
        var kinds = await Task.Run(() =>
            entries.Select(e => Volumes.Known(e.Path) != true ? "missing" : Directory.Exists(e.Path) ? "folder" : File.Exists(e.Path) ? "file" : "missing").ToList());
        // Among the missing ones, mark separately those whose whole drive is absent (USB stick or external disk not plugged in, network drive not connected): they weren't deleted and come back when the drive does
        var offline = entries.Select((e, i) => kinds[i] == "missing" && Volumes.Known(e.Path) != true).ToList();
        return new
        {
            entries = entries.Select((e, i) => new { path = e.Path, pinned = e.Pinned, kind = kinds[i], offline = offline[i] }),
            expanded,
            collapsed,
            selected,
            focus,
            skipped,
            relocated = relocated.Select(x => new { from = x.From, to = x.To }),
        };
    }

    /// <summary>An added item on a drive that is only mapped after the page has loaded: the shell reloads the page, and after loading the UI locates it and reports what wasn't added (see MainWindow.ReloadIfNewVolume)</summary>
    /// <param name="pasted">An image saved from a Ctrl+V paste (the UI says "pasted" instead of "already in the list")</param>
    object AfterAdd(Library.AddResult r, string? pasted = null) => new
    {
        added = r.Added,
        focus = r.Focus,
        skipped = r.Skipped,
        relocated = (r.Relocated ?? []).Select(x => new { from = x.From, to = x.To }),
        reloading = window.ReloadIfNewVolume(r.Added, r),
        pasted,
    };

    /// <summary>
    /// Ctrl+V: if the clipboard holds files or folders copied in File Explorer, handle them like a drop; if it holds an image (copied from web-based AI or a chat app), save it as PNG
    /// into the "Pasted Images" folder (AppPaths.PastedDir), add that folder to the library and locate the image. If it holds neither: empty = true and the UI says so
    /// </summary>
    async Task<object> PasteFromClipboardAsync()
    {
        if (System.Windows.Clipboard.ContainsFileDropList())
            return AfterAdd(await Library.AddAsync(settings, System.Windows.Clipboard.GetFileDropList().Cast<string>().ToList()));
        var png = ClipboardPng();
        if (png is null) return new { empty = true };
        var dir = AppPaths.PastedDir;
        Directory.CreateDirectory(dir);
        var stem = "paste-" + DateTime.Now.ToString("yyyyMMdd-HHmmss", System.Globalization.CultureInfo.InvariantCulture);
        var file = Path.Combine(dir, stem + ".png");
        for (var n = 2; File.Exists(file); n++) file = Path.Combine(dir, $"{stem}-{n}.png");
        AtomicFile.Write(file, png);
        Log.Info($"Pasted an image: {file}");
        return AfterAdd(await Library.AddAsync(settings, [dir]) with { Focus = file }, pasted: file);
    }

    /// <summary>Encodes the clipboard image as PNG: if the source put a PNG there, use it as is (browsers and chat apps usually do, with transparency); re-encode when only a bitmap is available</summary>
    static byte[]? ClipboardPng()
    {
        if (System.Windows.Clipboard.GetData("PNG") is MemoryStream ms) return ms.ToArray();
        if (!System.Windows.Clipboard.ContainsImage() || System.Windows.Clipboard.GetImage() is not { } image) return null;
        var encoder = new System.Windows.Media.Imaging.PngBitmapEncoder();
        encoder.Frames.Add(System.Windows.Media.Imaging.BitmapFrame.Create(image));
        using var output = new MemoryStream();
        encoder.Save(output);
        return output.ToArray();
    }

    /// <summary>Points a library entry that can no longer be found at its new location (right-click "Locate…")</summary>
    object RelocateEntry(string from, string to)
    {
        var r = Library.Relocate(settings, from, to);
        return new { to = r.To, reloading = window.ReloadIfNewVolume([r.To], new Library.AddResult([r.To], r.To, [])) };
    }

    object AppInfo() => new
    {
        version = AppVersion.Text,
        // First start after the rename, with old settings just migrated: the UI shows a notice once after loading (compute before TakeStartupNotice, which records "already shown")
        renamedFromPizhu = !startupNoticeTaken && LegacyMigration.JustMigrated,
        // Something happened while reading the settings at startup (corrupt, restored from backup): the UI shows a notice once after loading
        startupNotice = TakeStartupNotice(),
        logDir = Log.Dir,
        // Where images pasted with Ctrl+V go (shown in the library as "Pasted Images")
        pastedDir = AppPaths.PastedDir,
        // Portable build (a data folder next to the exe): the settings switches that write to the registry (context menu, start at login) are greyed out
        portable = AppPaths.IsPortable,
        // Windows display language: used when the UI setting is "follow system" (docs/adr/0001-i18n.md)
        systemLanguage = System.Globalization.CultureInfo.CurrentUICulture.Name,
        // Build time of the app itself: shown in the UI next to the UI's own build time, to tell whether they come from the same install
        built = File.GetLastWriteTimeUtc(typeof(Bridge).Assembly.Location).ToString("o"),
        dotnet = Environment.Version.ToString(),
        webview2 = core.Environment.BrowserVersionString,
        // Diagnostic info (Help → Copy Diagnostic Info, Report a Problem)
        os = $"{System.Runtime.InteropServices.RuntimeInformation.OSDescription} ({System.Runtime.InteropServices.RuntimeInformation.OSArchitecture})",
        exe = Environment.ProcessPath,
        settingsPath = Settings.Location,
        userName = Environment.UserName,
    };

    /// <summary>
    /// UI setting changes (only the items that were changed, see storedPrefs in prefs.ts). When they weren't written to disk this throws, and the UI says so with its own message (app.prefs.saveFailed;
    /// Settings.Save already logged the reason). Before, only the log knew; the UI showed the change as saved
    /// </summary>
    void SetPrefs(JsonElement prefs)
    {
        var more = settings.MoreFormats;
        if (!settings.Update(s => s.Prefs = JsonNode.Parse(prefs.GetRawText()) as JsonObject))
            throw new IOException($"Settings not written: {settings.StorePath}");
        // The UI changed language: the shell's own text (tray, capture overlay, error windows) follows without a restart (ADR-0001 item 6)
        Locale.Use(settings.Language);
        // More formats switched: the context menu (when it's on) gains or drops those extensions right away
        if (settings.MoreFormats != more)
        {
            try
            {
                ShellIntegration.Sync(settings.MoreFormats);
            }
            catch (Exception ex) when (ex is UnauthorizedAccessException or System.Security.SecurityException or IOException)
            {
                Log.Warn("Could not update the Explorer context menu for More formats", ex);
            }
        }
    }

    bool startupNoticeTaken;

    /// <summary>Handed out only once: not repeated when the page reloads (after adding items on another drive)</summary>
    string? TakeStartupNotice()
    {
        if (startupNoticeTaken) return null;
        startupNoticeTaken = true;
        return settings.StartupNotice;
    }

    List<string> PickFiles()
    {
        var patterns = string.Join(";", MaterialScanner.Extensions.Select(e => "*" + e));
        var dialog = new Microsoft.Win32.OpenFileDialog
        {
            Title = Locale.T("shell.dialog.addFiles"),
            Filter = $"{Locale.T("shell.dialog.supported")}|{patterns}|{Locale.T("shell.dialog.allFiles")}|*.*",
            Multiselect = true,
        };
        return dialog.ShowDialog(window) == true ? [.. dialog.FileNames] : [];
    }

    /// <summary>
    /// Help → Export Diagnostics Package…: the user picks where to save it, and it is selected in File Explorer once written; returns null if cancelled (see DiagnosticsPackage for what is written and what is stripped)
    /// </summary>
    string? ExportDiagnostics(string text)
    {
        var dialog = new Microsoft.Win32.SaveFileDialog
        {
            Title = Locale.T("shell.dialog.exportDiagnostics"),
            FileName = DiagnosticsPackage.DefaultName(DateTime.Now),
            DefaultExt = ".zip",
            Filter = $"{Locale.T("shell.dialog.zip")}|*.zip",
        };
        if (dialog.ShowDialog(window) != true) return null;
        DiagnosticsPackage.Write(dialog.FileName, text, settings.StorePath, Log.Dir);
        Shell.Reveal(dialog.FileName);
        return dialog.FileName;
    }

    /// <param name="title">Dialog title: the UI passes its own when asking where screenshots are stored (Settings → Screen Capture); it used to always say "Add Folder"</param>
    string? PickFolder(string? title)
    {
        var dialog = new Microsoft.Win32.OpenFolderDialog { Title = string.IsNullOrWhiteSpace(title) ? Locale.T("shell.dialog.addFolder") : title };
        return dialog.ShowDialog(window) == true ? dialog.FolderName : null;
    }

    object? Ready()
    {
        onReady();
        return null;
    }

    /// <summary>
    /// Scans the library entries: a folder lists every item in it (paths relative to the folder, from which the UI builds the tree); a file is just itself.
    /// Each item carries its notes folder and its URL (the item's drive is mapped to a virtual host, see MainWindow.UrlOf).
    /// The entry itself also carries its notes folder (project): the UI groups entries into "projects" by it.
    /// When an entry sits inside another folder entry in the library (skipped by that scan, added on its own), its notes are stored with the outer one, together with the other items in that folder
    /// </summary>
    async Task<object> ScanAsync(List<string> paths)
    {
        var (kinds, skip) = (settings.EnabledKinds, settings.SkipDirs);
        var all = settings.Library.Select(e => e.Path).ToList();
        var finder = new HomeFinder();
        // Entries on drives that aren't connected are not scanned (a disconnected network drive takes ten-odd seconds per query, see Volumes): one such entry used to make the other items wait for it
        await Volumes.WaitAsync(all, Volumes.Patience);
        var results = await Task.Run(() =>
        {
            var folders = all.Where(p => Volumes.Known(p) == true && Directory.Exists(p)).ToList();
            return paths.Select(raw => ScanEntry(raw, Library.OuterFolder(folders, raw))).ToList();
        });

        // Mapping virtual hosts has to happen on the UI thread, so build the URLs here, after the scan returns
        var reply = results.Select(r =>
        {
            foreach (var h in r.homes) homes.Add(h);
            return new
            {
                entry = r.entry,
                kind = r.kind,
                project = r.project,
                // Missing entry: if its project's .sniptoss still exists, hand it over so the UI still reads that notes folder (the "Item missing" group in the notes panel)
                keptHome = r.kind == "missing" && r.homes.Count > 0 ? r.homes[0] : null,
                // Hit the limit with items left unscanned: the UI says so on the project row (items beyond the limit used to just not appear, with no way for the user to know)
                truncatedAt = r.kind == "folder" && r.stats is { Truncated: true } ? MaterialScanner.Limit : (int?)null,
                // Unsupported files and skipped folders in a folder: the UI explains them at the end of the folder
                others = r.stats is { Others: > 0 } o ? new { count = o.Others, exts = o.OtherExts.ToList() } : null,
                moreOff = r.stats is { MoreOff: > 0 } m ? new { count = m.MoreOff, exts = m.MoreOffExts.ToList() } : null,
                skippedDirs = r.stats is { SkippedDirs.Count: > 0 } sk ? sk.SkippedDirs.ToList() : null,
                materials = r.found.Select((f, i) => new
                {
                    path = f.FullPath,
                    rel = r.kind == "folder" ? Path.GetRelativePath(r.entry, f.FullPath).Replace('\\', '/') : Path.GetFileName(f.FullPath),
                    kind = f.Kind,
                    size = f.Size,
                    mtime = f.Mtime,
                    ctime = f.Ctime,
                    home = r.homes[i],
                    homeRel = Path.GetRelativePath(r.homes[i], f.FullPath).Replace('\\', '/'),
                    url = window.UrlOf(f.FullPath),
                    longPath = LongPaths.TooLong(f.FullPath) && LongPaths.AliasOf(f.FullPath) is null ? true : (bool?)null,
                }).ToList(),
            };
        }).ToList();
        // A drive that wasn't plugged in at startup (not mapped, see MainWindow.MapVolume) is back: it gets mapped now while the URLs are built, and the page must reload to read from it
        window.ReloadIfNewVolume([], null);
        return reply;

        // Runs on a background thread: scanning a folder entry and HomeFinder both query the disk
        (string entry, string kind, string project, List<MaterialScanner.Found> found, List<string> homes, MaterialScanner.Stats? stats) ScanEntry(string raw, string? outer)
        {
            var entry = Library.Norm(raw);
            if (Volumes.Known(entry) != true) return (entry, "missing", Path.GetDirectoryName(entry) ?? entry, [], [], null);
            if (File.Exists(entry))
            {
                var one = MaterialScanner.Describe(entry);
                var home = finder.Find(entry, outer);
                return (entry, "file", home, one is null ? [] : [one.Value], one is null ? [] : [home], null);
            }
            if (Directory.Exists(entry))
            {
                var stats = new MaterialScanner.Stats();
                var found = MaterialScanner.Scan(entry, kinds, skip, stats: stats);
                var folderEntry = outer ?? entry;
                return (entry, "folder", finder.FolderHome(entry, folderEntry), found, found.Select(f => finder.Find(f.FullPath, folderEntry)).ToList(), stats);
            }
            // Not found: group it under the folder it used to be in. If that project's .sniptoss still exists (only this one file was moved away), its notes are still read,
            // so the "Item missing" group in the notes panel can list them (otherwise none were read: invisible in the UI while the agent still saw them in REVIEW.md)
            var kept = finder.ExistingHome(entry);
            return (entry, "missing", kept ?? Path.GetDirectoryName(entry) ?? entry, [], kept is null ? [] : [kept], null);
        }
    }

    /// <summary>Reads all notes files in these notes folders (including those of items not in the library, since REVIEW.md needs all of them) and starts watching</summary>
    List<object> ReadHomes(List<string> list)
    {
        var result = new List<object>();
        foreach (var raw in list)
        {
            var home = Library.Norm(raw);
            if (!homes.Contains(home)) continue;
            // When a project is opened, rename the old .pizhu to .sniptoss (docs/adr/0007-rename.md); this must happen before watching starts, since watching holds the directory
            DataDir.Migrate(home);
            // Start watching before reading (this records how the directory looks now): if an agent writes during the read, the difference shows up a second later and a notification goes out.
            // Before, watching began after the read, the recorded state already included the write, and that change was never announced
            window.Watch(home);
            var seq = Observe(); // take the sequence number before reading (ADR-0005 item 8)
            result.Add(new { home, seq, annotations = ReadAnnotations(home), project = ReadProject(home) });
        }
        return result;
    }

    /// <summary>
    /// This notes folder's settings (the raw text of .sniptoss/project.json, null if absent) and whether REVIEW.md exists: the UI uses them to decide which language to write REVIEW.md in
    /// (reviewLanguage in core; see the folder settings in docs/annotation-format.md)
    /// </summary>
    internal static object ReadProject(string home)
    {
        var dir = DataDir.Active(home);
        string? text = null;
        try
        {
            text = AtomicFile.ReadAllText(Path.Combine(dir, "project.json"));
        }
        catch (Exception ex) when (ex is FileNotFoundException or DirectoryNotFoundException)
        {
        }
        return new { text, review = File.Exists(Path.Combine(dir, "REVIEW.md")) };
    }

    /// <summary>
    /// Ordering of the notes content that was read / written (ADR-0005 item 8): notifications and reads of a notes folder take their number **before** reading; a write takes its number **inside the lock** once it is done, or after reading the current state when it is refused.
    /// A number taken before a read that is larger than the one taken inside some lock means the file was opened after that write, so what was read is not older (the disk only moves forward). The UI drops notifications numbered lower than one it has already seen:
    /// a late, old notification used to be taken as "changed elsewhere again", and merging rolled the notes back to the old version, wiping the status and replies an agent had just written back
    /// </summary>
    static long observed;
    internal static long Observe() => Interlocked.Increment(ref observed);

    internal static List<object> ReadAnnotations(string home)
    {
        var dir = Path.Combine(DataDir.Active(home), "annotations");
        if (!Directory.Exists(dir)) return [];
        var result = new List<object>();
        foreach (var f in Directory.EnumerateFiles(dir, "*.json"))
        {
            try
            {
                // Don't block writers (an agent's write-back command may be replacing it)
                result.Add(new { name = Path.GetFileName(f), text = AtomicFile.ReadAllText(f) });
            }
            catch (Exception ex) when (ex is FileNotFoundException or DirectoryNotFoundException)
            {
                // Deleted after listing and before reading (undo, deleted elsewhere): treat it as absent
            }
        }
        return result;
    }

    /// <summary>A file under .sniptoss/ in a notes folder; rel must be a relative path that lands inside .sniptoss/</summary>
    internal static string InDataDir(string home, string rel)
    {
        if (Path.IsPathRooted(rel)) throw new ArgumentException($"Relative path required: {rel}");
        var full = Path.GetFullPath(Path.Combine(home, rel));
        var limit = Path.Combine(home, DataDir.Name) + Path.DirectorySeparatorChar;
        if (!full.StartsWith(limit, StringComparison.OrdinalIgnoreCase))
            throw new UnauthorizedAccessException($"Only files in {DataDir.Name}/ can be written: {rel}");
        // The item's folder was deleted, renamed or moved away: don't write (AtomicFile used to recreate the whole path, leaving a folder that holds only .sniptoss in the old place, with the notes scattered across two places)
        if (!Directory.Exists(home)) throw new DirectoryNotFoundException(Locale.T("shell.error.homeGone", ("path", home)));
        // Don't write when .sniptoss or a folder under it is a link (symlink, junction): what is written would land wherever the link points
        for (var d = new DirectoryInfo(Path.GetDirectoryName(full)!); d is not null && d.FullName.Length + 1 >= limit.Length; d = d.Parent)
        {
            if (d.Exists && d.Attributes.HasFlag(FileAttributes.ReparsePoint))
                throw new UnauthorizedAccessException($"{DataDir.Name} contains a link, write refused: {d.FullName}");
        }
        return full;
    }

    static object? DeleteInDataDir(string home, string rel)
    {
        var full = InDataDir(home, rel);
        if (File.Exists(full)) File.Delete(full);
        return null;
    }

    /// <summary>
    /// Deletes snapshots in .sniptoss/snapshots that no note uses anymore: leftovers from deleted notes or from a changed snapshot format (it used to only grow).
    /// keep = the snapshots recorded by all notes of this notes folder in the UI (including those in the undo stack), relative to .sniptoss/ (snapshots/xxxxxx.png).
    /// Deletes only names this app generates (6-character ID + .png / .jpg); anything modified less than minAge ago is kept, since another window may have just taken a snapshot whose note isn't written yet. Returns how many were deleted
    /// </summary>
    internal static int PruneSnapshots(string home, IEnumerable<string> keep, TimeSpan minAge)
    {
        var dir = Path.GetDirectoryName(InDataDir(home, $"{DataDir.Name}/snapshots/_"))!;
        if (!Directory.Exists(dir)) return 0;
        var kept = new HashSet<string>(
            keep.Select(k => k.Replace('\\', '/')).Where(k => k.StartsWith("snapshots/", StringComparison.OrdinalIgnoreCase)).Select(k => k["snapshots/".Length..]),
            StringComparer.OrdinalIgnoreCase);
        var deleted = 0;
        foreach (var f in Directory.EnumerateFiles(dir))
        {
            var name = Path.GetFileName(f);
            if (kept.Contains(name) || !IsSnapshotName(name)) continue;
            try
            {
                if (DateTime.UtcNow - File.GetLastWriteTimeUtc(f) < minAge) continue;
                File.Delete(f);
                deleted++;
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                // In use or no permission: leave it for next time
            }
        }
        if (deleted > 0) Log.Info($"Removed {deleted} snapshots no longer used by any note: {dir}");
        return deleted;
    }

    /// <summary>Names this app gives snapshots: note ID (6 lowercase letters or digits) + .png / .jpg</summary>
    internal static bool IsSnapshotName(string name)
    {
        var stem = Path.GetFileNameWithoutExtension(name);
        var ext = Path.GetExtension(name);
        return stem.Length == 6
            && stem.All(c => c is >= 'a' and <= 'z' or >= '0' and <= '9')
            && (ext.Equals(".png", StringComparison.Ordinal) || ext.Equals(".jpg", StringComparison.Ordinal));
    }

    async Task<object?> WriteAsync(string home, string rel, byte[] bytes)
    {
        var full = InDataDir(home, rel);
        // Unique temp file → flush → replace: a crash halfway leaves no half-written JSON, and writing at the same time as an agent's write-back command doesn't clobber it (ADR-0005)
        await AtomicFile.WriteAsync(full, bytes);
        window.Watch(home); // the annotations directory only appears after the first note is written; start watching now
        DataDir.EnsureGitIgnore(home);
        return null;
    }

    /// <summary>
    /// Writes a notes file with a precondition (docs/adr/0005-write-protocol.md): the UI says "I believe the disk holds this content (expectSha256)";
    /// if it doesn't (an agent just wrote back), nothing is written and the current content is returned, and the UI merges and writes again.
    /// expectSha256: absent = no comparison; null = expects the file not to exist yet; a string = SHA-256 of the expected content (computed over the UTF-8 text, no BOM)
    /// </summary>
    async Task<object> WriteCheckedAsync(string home, string rel, string text, JsonElement args)
    {
        var full = InDataDir(home, rel);
        JsonElement expect = default;
        var check = args.ValueKind == JsonValueKind.Object && args.TryGetProperty("expectSha256", out expect);
        var (written, current, seq) = await WriteIfUnchangedAsync(full, text, check, expect.ValueKind == JsonValueKind.String ? expect.GetString() : null);
        if (!written) return new { written, current, seq };
        window.Watch(home);
        DataDir.EnsureGitIgnore(home);
        return new { written, current = (string?)null, seq };
    }

    /// <summary>
    /// Writes only if the disk still holds the expectSha256 version (check = false skips the comparison); otherwise nothing is written and the current content is returned.
    /// The comparison and the write happen under the same lock (FileLock, which the CLI write-back takes too): nobody can slip in between comparing and writing.
    /// Seq: the sequence number of the returned current state / of the written content (Observe, taken inside the lock, when the content is fixed)
    /// </summary>
    internal static async Task<(bool Written, string? Current, long Seq)> WriteIfUnchangedAsync(string full, string text, bool check, string? expectSha256)
    {
        using (await FileLock.AcquireAsync(full))
        {
            if (check)
            {
                var current = File.Exists(full) ? ReadIfExists(full) : null;
                if (TextSha256(current) != expectSha256) return (false, current, Observe());
            }
            await AtomicFile.WriteAsync(full, Utf8NoBom.GetBytes(text));
            return (true, null, Observe());
        }
    }

    /// <summary>
    /// Each item of Copy as Images: the snapshot is accepted only from the notes folder .sniptoss (InDataDir); if the notes folder isn't known or the item's folder is gone, the item is treated as having no snapshot (text only)
    /// </summary>
    List<HandoffImages.Item> HandoffItems(JsonElement args) =>
        args.GetProperty("items").EnumerateArray().Select(it =>
        {
            string? shot = null;
            if (it.TryGetProperty("snapshot", out var rel) && rel.ValueKind == JsonValueKind.String)
            {
                try
                {
                    shot = InDataDir(Home(it), rel.GetString()!);
                }
                catch (Exception ex) when (ex is UnauthorizedAccessException or DirectoryNotFoundException or ArgumentException)
                {
                    Log.Info($"Copy as images: snapshot skipped ({ex.Message})");
                }
            }
            return new HandoffImages.Item(shot, Str(it, "title"), it.GetProperty("number").GetInt32(), Str(it, "category"), Str(it, "where"), Str(it, "body"), MarkColor(Str(it, "color")), Str(it, "name"));
        }).ToList();

    /// <summary>Mark color (#rrggbb from the settings); falls back to the default orange if malformed</summary>
    static System.Windows.Media.Color MarkColor(string hex)
    {
        try
        {
            return (System.Windows.Media.Color)System.Windows.Media.ColorConverter.ConvertFromString(hex);
        }
        catch (FormatException)
        {
            return System.Windows.Media.Color.FromRgb(0xff, 0x6a, 0x3d);
        }
    }

    static string? ReadIfExists(string path)
    {
        try
        {
            return AtomicFile.ReadAllText(path);
        }
        catch (Exception ex) when (ex is FileNotFoundException or DirectoryNotFoundException)
        {
            return null;
        }
    }

    internal static string? TextSha256(string? text) =>
        text is null ? null : Convert.ToHexString(SHA256.HashData(Utf8NoBom.GetBytes(text))).ToLowerInvariant();
}

static class MaterialScanner
{
    /// <summary>
    /// Extensions that can be annotated (the UI's KIND_OF_EXT in library.ts and the e2e mock-host match this list). jfif, jpe, pjpeg, pjp are JPEG, apng is animated PNG;
    /// the UI can't display tif, tiff, heic, heif, so the shell converts them to PNG (DecodedImages)
    /// </summary>
    static readonly Dictionary<string, string> Kinds = new(StringComparer.OrdinalIgnoreCase)
    {
        [".png"] = "image", [".jpg"] = "image", [".jpeg"] = "image", [".jfif"] = "image", [".jpe"] = "image", [".pjpeg"] = "image", [".pjp"] = "image",
        [".webp"] = "image", [".gif"] = "image", [".apng"] = "image", [".bmp"] = "image", [".avif"] = "image", [".ico"] = "image", [".svg"] = "image",
        [".tif"] = "image", [".tiff"] = "image", [".heic"] = "image", [".heif"] = "image",
        [".mp4"] = "video", [".webm"] = "video", [".mov"] = "video", [".m4v"] = "video", [".mkv"] = "video",
    };

    /// <summary>
    /// Less common formats (library.ts MORE_EXTS and the e2e mock-host match this list): folders list them and the context menu offers them
    /// only when Settings → Advanced → More formats is on (off by default). A file added on its own is annotatable either way
    /// </summary>
    static readonly HashSet<string> More = new(StringComparer.OrdinalIgnoreCase)
    {
        ".jfif", ".jpe", ".pjpeg", ".pjp", ".apng", ".ico", ".tif", ".tiff", ".heic", ".heif", ".mkv",
    };

    /// <summary>In the set of listed kinds (Settings.EnabledKinds): the formats in More are listed too</summary>
    public const string MoreKind = "more";

    /// <summary>
    /// Files that look like items but can't be annotated yet: not listed during a scan, only counted, and the end of the folder says "N more files aren't supported yet" (they used to be silently left out, with no hint where they went).
    /// PDF and PPT are here too: until annotating them is done they are not listed, not accepted, not registered in the context menu (they used to be listed, and opening one showed just "supported in a later version")
    /// </summary>
    static readonly HashSet<string> NotYet = new(StringComparer.OrdinalIgnoreCase)
    {
        ".pdf", ".pptx", ".ppt", ".key",
        ".psd", ".psb", ".ai", ".eps", ".jxl", ".tga", ".exr", ".hdr", ".dds",
        ".raw", ".dng", ".cr2", ".cr3", ".nef", ".arw", ".orf", ".rw2", ".xcf", ".kra", ".sketch", ".fig", ".xd", ".afdesign", ".afphoto",
        ".avi", ".wmv", ".flv", ".f4v", ".mpg", ".mpeg", ".3gp", ".m2ts", ".mts", ".vob", ".ogv", ".rm", ".rmvb",
    };

    /// <summary>Extensions that used to be registered in the context menu and are no longer accepted: removed together when the context menu is turned off / re-registered</summary>
    public static readonly string[] FormerExtensions = [".pdf", ".pptx", ".ppt"];

    /// <summary>Folders skipped by default; the user can change them in Settings (Settings.SkipDirs). Which were skipped is stated at the end of the folder</summary>
    public static readonly string[] DefaultSkipDirs = ["node_modules", "bin", "obj", "dist", "build", "__pycache__", "venv"];

    public static IEnumerable<string> Extensions => Kinds.Keys;

    /// <summary>Extensions the context menu is registered for: the common ones, plus More when that setting is on</summary>
    public static IEnumerable<string> MenuExtensions(bool more) => more ? Kinds.Keys : Kinds.Keys.Where(e => !More.Contains(e));

    /// <summary>Recorded as a by-product of a scan: how many unsupported files and which extensions (lowercase, no dot), and which folders were skipped (by name)</summary>
    public sealed class Stats
    {
        public int Others { get; set; }
        public SortedSet<string> OtherExts { get; } = new(StringComparer.Ordinal);
        /// <summary>Files in a More format left out because that setting is off (the folder's last line says how to show them)</summary>
        public int MoreOff { get; set; }
        public SortedSet<string> MoreOffExts { get; } = new(StringComparer.Ordinal);
        public SortedSet<string> SkippedDirs { get; } = new(StringComparer.OrdinalIgnoreCase);
        /// <summary>There are items beyond the limit that weren't listed (exactly at the limit doesn't count)</summary>
        public bool Truncated { get; set; }
    }

    /// <summary>At most this many items are listed per folder entry (the UI couldn't list more anyway). The scan stops there and the UI marks it on the project row</summary>
    public const int Limit = 20000;

    /// <param name="Ctime">Creation time (ms): used for the "New" marker in the library</param>
    public readonly record struct Found(string FullPath, string Kind, long Size, long Mtime, long Ctime);

    /// <summary>File time → milliseconds (Unix)</summary>
    static long Ms(DateTime utc) => new DateTimeOffset(utc).ToUnixTimeMilliseconds();

    /// <summary>Determines the item kind from the extension; null if unsupported</summary>
    public static string? KindOf(string path) => Kinds.GetValueOrDefault(Path.GetExtension(path));

    /// <summary>The file's kind if a folder scan lists it with these kinds turned on (MoreKind included or not); otherwise null</summary>
    public static string? Listed(string name, HashSet<string> enabledKinds) =>
        KindOf(name) is { } kind && enabledKinds.Contains(kind) && (enabledKinds.Contains(MoreKind) || !More.Contains(Path.GetExtension(name))) ? kind : null;

    public static Found? Describe(string file)
    {
        var f = new FileInfo(file);
        return f.Exists && KindOf(file) is { } kind
            ? new Found(f.FullName, kind, f.Length, Ms(f.LastWriteTimeUtc), Ms(f.CreationTimeUtc))
            : null;
    }

    public static List<Found> Scan(string root, HashSet<string> enabledKinds, HashSet<string> skipDirs, int limit = Limit, Stats? stats = null)
    {
        var found = new List<Found>();
        var stack = new Stack<string>();
        stack.Push(root);
        var more = false;
        while (stack.Count > 0 && !more)
        {
            var dir = new DirectoryInfo(stack.Pop());
            IEnumerable<FileSystemInfo> entries;
            try
            {
                entries = dir.EnumerateFileSystemInfos();
            }
            catch (Exception ex) when (ex is UnauthorizedAccessException or IOException)
            {
                continue;
            }
            // An error halfway through reading (network drive dropped mid-scan, folder being deleted): the rest of this folder isn't listed, others are unaffected. Before, the scan threw and no entry in the library could be scanned
            try
            {
                foreach (var entry in entries)
                {
                    if (entry.Attributes.HasFlag(FileAttributes.Hidden) || entry.Name.StartsWith('.')) continue;
                    if (entry is DirectoryInfo d)
                    {
                        // Don't descend into directory links (symlinks, junctions): one pointing back to a parent would loop until the path gets too long or the 20,000 limit
                        if (skipDirs.Contains(d.Name)) stats?.SkippedDirs.Add(d.Name);
                        else if (!d.Attributes.HasFlag(FileAttributes.ReparsePoint)) stack.Push(d.FullName);
                    }
                    else if (entry is FileInfo f && !f.Name.StartsWith("~$", StringComparison.Ordinal))
                    {
                        if (Listed(f.Name, enabledKinds) is { } kind)
                        {
                            // Hit the limit with more left: record that the list is incomplete and stop searching. Exactly at the limit doesn't count (exactly 20,000 items used to be flagged "too many items")
                            if (found.Count >= limit)
                            {
                                more = true;
                                break;
                            }
                            found.Add(new Found(f.FullName, kind, f.Length, Ms(f.LastWriteTimeUtc), Ms(f.CreationTimeUtc)));
                        }
                        else if (stats is not null && NotYet.Contains(f.Extension))
                        {
                            stats.Others++;
                            stats.OtherExts.Add(f.Extension.TrimStart('.').ToLowerInvariant());
                        }
                        // Only when its kind is on: with videos turned off, an MKV is no more missing than an MP4
                        else if (stats is not null && More.Contains(f.Extension) && enabledKinds.Contains(Kinds[f.Extension]))
                        {
                            stats.MoreOff++;
                            stats.MoreOffExts.Add(f.Extension.TrimStart('.').ToLowerInvariant());
                        }
                    }
                }
            }
            catch (Exception ex) when (ex is UnauthorizedAccessException or IOException)
            {
                Log.Warn($"Scanning {dir.FullName} failed partway; the rest of this folder is not listed", ex);
            }
        }
        if (stats is not null) stats.Truncated = more;
        return found;
    }
}

/// <summary>
/// Rate limit for UI log entries: at most perMinute per minute (counted from the first entry of that minute); the one that exceeds it becomes a one-line notice, later ones are dropped, and it resets the next minute.
/// Before, the excess vanished silently, and reading the log suggested the UI had stopped erroring
/// </summary>
sealed class WebLogLimiter(int perMinute = 60)
{
    public enum Verdict { Write, Notice, Drop }

    DateTime window = DateTime.MinValue;
    int count;

    public Verdict Take(DateTime now)
    {
        if (now - window > TimeSpan.FromMinutes(1))
        {
            window = now;
            count = 0;
        }
        count++;
        return count <= perMinute ? Verdict.Write : count == perMinute + 1 ? Verdict.Notice : Verdict.Drop;
    }
}
