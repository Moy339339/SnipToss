using System.IO;
using System.Windows.Threading;

namespace SnipToss.App;

// Detecting files that changed externally: an agent wrote notes back, or changed an item according to the notes.
// Neither watcher uses FileSystemWatcher: it holds an open handle on the folder, so while the app is running (by default always, in the tray) the user couldn't rename or move those folders,
// and File Explorer would say "folder in use" (watching a notes folder made the whole project folder impossible to rename). Instead they poll and compare fingerprints.

/// <summary>
/// The .sniptoss/annotations of each notes folder: once a second, look at file names, sizes and modification times; on a change, read the whole directory and hand it to the UI (annotationsChanged).
/// A directory that doesn't exist yet is watched too: one created elsewhere (an agent, a manual copy) is synced when it appears (watching used to start only after this app's first write).
/// A missing project folder itself (its drive disconnected, or moved away) is not a change: it used to count as "all notes deleted", clearing the notes panel and reporting a sync, then reporting it again when the drive returned
/// </summary>
sealed class AnnotationWatcher : IDisposable
{
    readonly Action<string, List<object>, long> changed;
    readonly DispatcherTimer timer;
    /// <summary>Notes folder → the fingerprint seen last time (null = not seen yet)</summary>
    readonly Dictionary<string, string?> homes = new(StringComparer.OrdinalIgnoreCase);
    bool checking;
    bool paused;

    public AnnotationWatcher(Dispatcher dispatcher, Action<string, List<object>, long> changed)
    {
        this.changed = changed;
        timer = new DispatcherTimer(TimeSpan.FromSeconds(1), DispatcherPriority.Background, (_, _) => Check(), dispatcher);
    }

    /// <summary>Start watching this notes folder (call it before reading its notes and after writing to it; repeated calls are harmless). What is recorded is how it looks at the call: every later change is announced</summary>
    public void Watch(string home)
    {
        if (homes.ContainsKey(home)) return;
        homes[home] = Signature(home);
        if (!paused) timer.Start();
    }

    /// <summary>Stops while the window is hidden (resident in the tray for weeks) so network drives aren't woken constantly; checks once immediately when shown again</summary>
    public void Pause(bool pause)
    {
        paused = pause;
        if (pause) timer.Stop();
        else if (homes.Count > 0)
        {
            timer.Start();
            Check();
        }
    }

    async void Check()
    {
        if (checking) return; // the previous round hasn't finished (slow network drive)
        checking = true;
        try
        {
            var list = homes.Keys.ToList();
            // Don't query drives that aren't connected (a disconnected network drive takes ten-odd seconds per query, see Volumes): one project on such a drive used to delay changes in other projects by that long
            await Volumes.WaitAsync(list, Volumes.Patience);
            var now = await Task.Run(() => list.Select(h => (home: h, sig: Volumes.Known(h) == true ? Signature(h) : null)).ToList());
            foreach (var (home, sig) in now)
            {
                if (sig is null || !homes.TryGetValue(home, out var old) || old == sig) continue;
                List<object>? files;
                // Take the number before reading (Bridge.Observe, ADR-0005 item 8): the UI uses it to recognize a late, old notification
                var seq = Bridge.Observe();
                try
                {
                    files = await Task.Run(() =>
                    {
                        var read = Bridge.ReadAnnotations(home);
                        return Directory.Exists(home) ? read : null; // the project folder vanished during the read (drive just disconnected): an empty list read then doesn't count
                    });
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                {
                    continue; // being written, can't read it: look again next second (the fingerprint isn't recorded, so it is retried)
                }
                if (files is null) continue;
                homes[home] = sig;
                changed(home, files, seq);
            }
        }
        catch (Exception ex)
        {
            Log.Warn("Error while checking notes folders for changes", ex);
        }
        finally
        {
            checking = false;
        }
    }

    /// <summary>Name, size and modification time of each .json in annotations; an empty string if the directory is absent; null if the project folder itself is missing (not a change; wait for it to return)</summary>
    static string? Signature(string home)
    {
        try
        {
            if (!Directory.Exists(home)) return null;
            var dir = new DirectoryInfo(Path.Combine(DataDir.Active(home), "annotations"));
            if (!dir.Exists) return "";
            var hc = new HashCode();
            foreach (var f in dir.EnumerateFiles("*.json").OrderBy(f => f.Name, StringComparer.OrdinalIgnoreCase))
            {
                hc.Add(f.Name, StringComparer.OrdinalIgnoreCase);
                hc.Add(f.Length);
                hc.Add(f.LastWriteTimeUtc.Ticks);
            }
            return hc.ToHashCode().ToString(System.Globalization.CultureInfo.InvariantCulture);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return "?"; // unreadable (network drive disconnected): differs from last time, so it is read once; if that fails, look again next second
        }
    }

    public void Dispose() => timer.Stop();
}

/// <summary>
/// Items changed externally (an agent edited an image according to the notes, generated new files, deleted old ones): makes the UI rescan that entry (materialsChanged).
/// The open file is checked every second (that is mostly what an agent edits); when the window returns to the foreground, and now and then in the background, every library entry is scanned and fingerprints compared.
/// Before, only F5 did it, and the item URL carries the modification time from the scan, so without a rescan the URL stayed the same and the UI kept showing the stale cached image
/// </summary>
sealed class MaterialWatcher : IDisposable
{
    readonly Settings settings;
    readonly Action<IReadOnlyList<string>> changed;
    readonly DispatcherTimer timer;
    /// <summary>Entry → fingerprint. The first sighting is only recorded, not announced</summary>
    readonly Dictionary<string, string> signatures = new(StringComparer.OrdinalIgnoreCase);
    /// <summary>
    /// Every item file seen in the last full scan → size and modification time. The open file is compared against this; it used to be compared with its state at "first check",
    /// so if an agent changed it just before that, the changed version became the baseline and was never announced
    /// </summary>
    readonly Dictionary<string, string> files = new(StringComparer.OrdinalIgnoreCase);
    DateTime nextFull = DateTime.MinValue;
    DateTime lastFull = DateTime.MinValue;
    bool scanning;
    bool checkingCurrent;
    bool paused;

    /// <summary>Interval of the background full scan: at least 10 seconds; if a scan is slow (large folders, network drives) it is stretched to 20 times its duration</summary>
    static readonly TimeSpan FullEvery = TimeSpan.FromSeconds(10);

    public MaterialWatcher(Dispatcher dispatcher, Settings settings, Action<IReadOnlyList<string>> changed)
    {
        this.settings = settings;
        this.changed = changed;
        timer = new DispatcherTimer(TimeSpan.FromSeconds(1), DispatcherPriority.Background, (_, _) => Tick(), dispatcher);
        timer.Start();
        FullCheck(); // record the baseline
    }

    void Tick()
    {
        CheckCurrent();
        if (DateTime.UtcNow >= nextFull) FullCheck();
    }

    /// <summary>Window back in the foreground: scan everything right away (the user has probably just come back from having an agent edit things elsewhere)</summary>
    public void WindowActivated()
    {
        if (!paused && DateTime.UtcNow - lastFull > TimeSpan.FromSeconds(2)) FullCheck();
    }

    /// <summary>
    /// Stops while the window is hidden (resident in the tray for weeks): while hidden it used to scan the whole library every 10 seconds and the open file every second, constantly waking network drives and sleeping NAS units.
    /// Checks immediately when shown again
    /// </summary>
    public void Pause(bool pause)
    {
        paused = pause;
        if (pause)
        {
            timer.Stop();
            return;
        }
        timer.Start();
        CheckCurrent();
        WindowActivated();
    }

    async void CheckCurrent()
    {
        var path = settings.Selected;
        if (path is null || checkingCurrent) return;
        checkingCurrent = true;
        try
        {
            await Volumes.WaitAsync([path], Volumes.Patience);
            var sig = Volumes.Known(path) == true ? await Task.Run(() => FileSignature(path)) : Offline;
            var known = files.GetValueOrDefault(path);
            files[path] = sig;
            if (known is not null && known != sig && EntryOf(path) is { } entry)
            {
                signatures.Remove(entry); // the next full scan only records it again, so the same change isn't announced twice
                changed([entry]);
            }
        }
        finally
        {
            checkingCurrent = false;
        }
    }

    async void FullCheck()
    {
        if (scanning) return;
        scanning = true;
        var started = lastFull = DateTime.UtcNow;
        nextFull = started + FullEvery;
        try
        {
            var entries = settings.Library.Select(e => e.Path).ToList();
            var kinds = settings.EnabledKinds;
            var skip = settings.SkipDirs;
            var seen = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            // Drives that aren't connected are recorded as Offline and not scanned (a disconnected network drive takes ten-odd seconds per query, see Volumes): one entry on such a drive used to make a round take tens of seconds,
            // the interval stretched to ten-odd minutes, and changes to other items went unseen. When the drive comes back its fingerprint changes from Offline and the UI rescans it (the list entry recovers with it)
            await Volumes.WaitAsync(entries, Volumes.Patience);
            var there = entries.Select(e => Volumes.Known(e) == true).ToList();
            var now = await Task.Run(() => entries.Select((e, i) => (entry: e, sig: there[i] ? EntrySignature(e, kinds, skip, seen) : Offline)).ToList());
            var dirty = new List<string>();
            foreach (var (entry, sig) in now)
            {
                if (signatures.TryGetValue(entry, out var old) && old != sig) dirty.Add(entry);
                signatures[entry] = sig;
            }
            files.Clear();
            foreach (var (path, sig) in seen) files[path] = sig;
            foreach (var gone in signatures.Keys.Except(entries, StringComparer.OrdinalIgnoreCase).ToList()) signatures.Remove(gone);
            if (dirty.Count > 0) changed(dirty);
        }
        catch (Exception ex)
        {
            Log.Warn("Error while checking items for changes", ex);
        }
        finally
        {
            var took = DateTime.UtcNow - started;
            nextFull = DateTime.UtcNow + (took * 20 > FullEvery ? took * 20 : FullEvery);
            scanning = false;
        }
    }

    /// <summary>Fingerprint for when the drive isn't connected (USB stick unplugged, network drive disconnected)</summary>
    const string Offline = "offline";

    string? EntryOf(string path) =>
        settings.Library.Select(e => e.Path).FirstOrDefault(e => Library.Same(e, path) || Library.Inside(path, e));

    /// <summary>Size and modification time (ms, same as what the scan gives the UI); missing if gone</summary>
    internal static string FileSignature(string path)
    {
        try
        {
            return MaterialScanner.Describe(path) is { } f ? Sig(f) : new FileInfo(path).Exists ? "other" : "missing";
        }
        catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException)
        {
            // Settings file corrupted by hand edits ("Selected": "", illegal characters in the path): treat as absent. It used to throw every second and pop up the error window
            return "missing";
        }
    }

    static string Sig(MaterialScanner.Found f) => string.Create(System.Globalization.CultureInfo.InvariantCulture, $"{f.Size}:{f.Mtime}");

    /// <summary>Folder: the items found by the scan rules (path, size, modification time); single file: size and modification time. Every file seen is recorded in seen</summary>
    static string EntrySignature(string entry, HashSet<string> kinds, HashSet<string> skip, Dictionary<string, string> seen)
    {
        if (!Directory.Exists(entry))
        {
            var sig = FileSignature(entry);
            seen[entry] = sig;
            return sig;
        }
        var hc = new HashCode();
        var stats = new MaterialScanner.Stats();
        foreach (var f in MaterialScanner.Scan(entry, kinds, skip, stats: stats))
        {
            hc.Add(f.FullPath, StringComparer.OrdinalIgnoreCase);
            hc.Add(f.Size);
            hc.Add(f.Mtime);
            seen[f.FullPath] = Sig(f);
        }
        // The line at the end of the folder, "N more files aren't supported yet", must follow too: one more psd also counts as the folder having changed
        hc.Add(stats.Others);
        hc.Add(stats.MoreOff);
        return "d" + hc.ToHashCode().ToString(System.Globalization.CultureInfo.InvariantCulture);
    }

    public void Dispose() => timer.Stop();
}
