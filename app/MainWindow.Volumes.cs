using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Web.WebView2.Core;

namespace SnipToss.App;

// Item URLs (part of MainWindow): the drive an item is on is mapped to a virtual host, and the UI reads items via https://vol-<drive>.sniptoss.example/
sealed partial class MainWindow
{
    // ---------- Item URLs: each drive (or network share) is mapped to a virtual host ----------

    readonly HashSet<string> volumes = new(StringComparer.OrdinalIgnoreCase);
    /// <summary>Drives already mapped when the current page navigated. Ones mapped later need a page reload before they can be read (otherwise: Failed to fetch)</summary>
    HashSet<string> volumesAtLoad = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// A path just added to the list uses a drive that is only mapped after the page loaded: remember the path to locate and the notes on what wasn't added, and reload the page (this happens only the first time a given drive is encountered).
    /// Returns true if it will reload, so the UI needs to do nothing else
    /// </summary>
    public bool ReloadIfNewVolume(IEnumerable<string> paths, Library.AddResult? result)
    {
        foreach (var p in paths) MapVolume(p);
        if (volumes.All(volumesAtLoad.Contains)) return false;
        if (result is not null) Pending.Stash(result);
        // A reload is already pending (scanned again and added another entry in the same round): don't queue a second one
        if (!reloadQueued) Dispatcher.InvokeAsync(() => web.CoreWebView2?.Reload(), System.Windows.Threading.DispatcherPriority.Background);
        reloadQueued = true;
        return true;
    }

    bool reloadQueued;

    /// <summary>Drive → virtual host name: a drive letter gives vol-e, a network share gives vol-unc- (first 12 hex digits of the SHA-256 of the lowercase share root); the same share is the same host regardless of case</summary>
    internal static string HostOf(string volume) =>
        volume.Length >= 2 && volume[1] == ':'
            ? $"vol-{char.ToLowerInvariant(volume[0])}.sniptoss.example"
            : $"vol-unc-{Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(volume.ToLowerInvariant())))[..12].ToLowerInvariant()}.sniptoss.example";

    void MapVolume(string path)
    {
        // Don't map while the UI isn't up: InitWebViewAsync maps the drives used by the list in one go
        if (web.CoreWebView2 is not { } core) return;
        var volume = Path.GetPathRoot(Path.GetFullPath(path));
        if (string.IsNullOrEmpty(volume) || volumes.Contains(volume)) return;
        // Drive absent (USB stick not plugged in, network drive not connected): WebView2 throws when mapping a nonexistent folder (an entry on an unplugged drive used to keep the UI from starting).
        // Don't map for now; when the drive is back and a scan finds its items, map then and reload the page once (Bridge.ScanAsync)
        // Use the result of the background check if there is one (a disconnected network drive takes ten-odd seconds to query, see Volumes); only query here if it wasn't checked (just added or just scanned, so the drive is connected and it's quick)
        if ((Volumes.Known(volume) ?? Directory.Exists(volume)) is false) return;
        try
        {
            core.SetVirtualHostNameToFolderMapping(HostOf(volume), volume, CoreWebView2HostResourceAccessKind.Allow);
            volumes.Add(volume);
        }
        catch (Exception ex) when (ex is ArgumentException or IOException or UnauthorizedAccessException or System.Runtime.InteropServices.COMException)
        {
            Log.Warn($"Could not map {volume}; items on this drive can't be shown", ex);
        }
    }

    /// <summary>
    /// The URL of an item in the UI: https://vol-e.sniptoss.example/path. WebView2 reads the disk natively and also handles dragging the video's progress bar (Range requests).
    /// Only the drives used by the list are mapped, no other drive is touched. Paths over 260 characters can't be read by WebView2 and go through a short junction (LongPaths)
    /// </summary>
    public string UrlOf(string path)
    {
        if (LongPaths.TooLong(path) && LongPaths.AliasOf(path) is { } alias) return $"https://{LongPaths.Host}/{alias}";
        MapVolume(path);
        var volume = Path.GetPathRoot(path)!;
        var rest = path[volume.Length..].TrimStart('\\').Split('\\').Select(Uri.EscapeDataString);
        return $"https://{HostOf(volume)}/{string.Join('/', rest)}";
    }
}
