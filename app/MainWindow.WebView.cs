using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Windows;
using System.Windows.Documents;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace SnipToss.App;

// The UI inside the main window (part of MainWindow): creating WebView2, allowing only our own UI, reloading when the UI process crashes, the "UI didn't start" watchdog and notice page, pushing messages to the UI
sealed partial class MainWindow
{
    static bool DevMode =>
#if DEBUG
        true;
#else
        Environment.GetEnvironmentVariable("SNIPTOSS_DEV_URL") is not null;
#endif

    async Task InitWebViewAsync()
    {
        // The 30 seconds count from here: when WebView2 shows its own error box, EnsureCoreWebView2Async never returns, and the watchdog used to wait for the page to start loading before timing, leaving the window black forever
        WatchReady();
        try
        {
            await web.EnsureCoreWebView2Async(await envTask);
            // Map the drives in the list once they've been checked (SetUpWebView): wait only a moment, and treat unfinished ones as not connected; they are mapped when a scan finds them connected, and the page reloads
            await Volumes.WaitAsync(settings.Library.Select(e => e.Path), Volumes.Patience);
            if (startupProbe is { } probe)
            {
                startupProbe = null;
                // What the command line brought in, once checked, is added to the list first so its drive is mapped together; with a slow network drive the UI comes up first and it is added once checked (same as opening from outside)
                if (await Task.WhenAny(probe, Task.Delay(Volumes.Patience)) == probe) Pending.Stash(Library.Add(settings, await probe));
                else AddWhenProbed(probe);
            }
            if (Content != web) return; // by the time we waited, the watchdog had already swapped in the notice page
            SetUpWebView(web.CoreWebView2);
        }
        catch (Exception ex)
        {
            // This used to be uncaught: with the WebView2 runtime missing or broken, or the data directory not writable, the program just crashed.
            // Errors in the second half (mapping the UI folder, creating the short-junction directory) used to show a "can continue" error window that left only a blank area when clicked; they now also become the notice page
            Log.Error("UI initialization failed", ex);
            ShowStartupProblem(ex);
        }
    }

    void SetUpWebView(CoreWebView2 core)
    {

        var s = core.Settings;
        s.IsStatusBarEnabled = false;
        s.IsZoomControlEnabled = false;
        s.IsPasswordAutosaveEnabled = false;
        s.IsGeneralAutofillEnabled = false;
        s.AreDevToolsEnabled = DevMode;
        s.AreDefaultContextMenusEnabled = DevMode;
        // Block browser shortcuts such as F5 reload and Ctrl+P print, so it behaves like an app rather than a web page
        s.AreBrowserAcceleratorKeysEnabled = DevMode;
        // Areas with app-region: drag in the UI (the blank part of the title bar) act as the system title bar: dragging moves the window, double-click maximizes, right-click shows the system menu, dragging to a screen edge snaps
        s.IsNonClientRegionSupportEnabled = true;

        core.NewWindowRequested += (_, e) => e.Handled = true;
        // Clipboard (copy for AI, pasting screenshots later): for our own UI, allow directly without the browser's "allow?" prompt.
        // WebView2 counts writes that don't directly follow a click as ClipboardRead too
        core.PermissionRequested += (_, e) =>
        {
            if (e.PermissionKind == CoreWebView2PermissionKind.ClipboardRead && IsOwnUi(e.Uri)) e.State = CoreWebView2PermissionState.Allow;
        };
        var uiDir = Path.Combine(AppContext.BaseDirectory, "ui");
        // UI folder missing (incomplete install, quarantined by antivirus): WebView2 only reports "path not found" without saying which, so the notice page and the log name it
        if (!Directory.Exists(uiDir)) throw new DirectoryNotFoundException($"UI folder not found: {uiDir}");
        core.SetVirtualHostNameToFolderMapping(AppHost, uiDir, CoreWebView2HostResourceAccessKind.Allow);
        // Item paths over 260 characters are read through the short junctions here (LongPaths); clear the ones made last time first
        LongPaths.Clean();
        Directory.CreateDirectory(LongPaths.Root);
        core.SetVirtualHostNameToFolderMapping(LongPaths.Host, LongPaths.Root, CoreWebView2HostResourceAccessKind.Allow);
        // Images the shell converted to PNG (TIFF, HEIC, DecodedImages) are read through here; the cache is cleaned once in the background
        Directory.CreateDirectory(DecodedImages.Dir);
        core.SetVirtualHostNameToFolderMapping(DecodedImages.Host, DecodedImages.Dir, CoreWebView2HostResourceAccessKind.Allow);
        _ = Task.Run(DecodedImages.Prune);
        // Merge duplicate entries saved by the old "add the subfolder first, then the parent" order (now they're merged at add time)
        if (Library.Tidy(settings, p => Volumes.Known(p) == true) is > 0 and var tidied) Log.Info($"Library: {tidied} entries inside other folder entries were merged away");
        // Map the drives of the list's items first (mapping is reliable only for later navigations, see UrlOf); only those checked and confirmed connected (InitWebViewAsync just checked)
        foreach (var e in settings.Library.Where(e => Volumes.Known(e.Path) == true)) MapVolume(e.Path);

        var bridge = new Bridge(core, this, OnReady);
        core.WebMessageReceived += bridge.OnMessage;
        core.NavigationStarting += (_, e) =>
        {
            // Only our own UI is allowed in the window: other addresses (a dragged-in link, an external link clicked somewhere) aren't opened in the app, otherwise the UI would be gone and only a restart would help.
            // The drives of the items are mapped as virtual hosts in full (UrlOf); this check, with the content security policy, makes sure only our own UI can read them
            if (!IsOwnUi(e.Uri))
            {
                e.Cancel = true;
                Log.Warn($"Blocked navigation to another address: {e.Uri}");
                return;
            }
            volumesAtLoad = new(volumes, StringComparer.OrdinalIgnoreCase);
            reloadQueued = false;
            WatchReady();
            Pending.Navigating();
            if (hotkeyPaused)
            {
                Log.Info("Page reloaded while recording the hotkey: Screen Capture hotkey restored");
                PauseHotkey(false);
            }
        };
        // The UI files didn't load (files missing from the ui folder, or the dev server isn't running in development): replace with the notice page rather than leaving a blank window. A navigation interrupted by a new one (a reload) doesn't count
        core.NavigationCompleted += (_, e) =>
        {
            if (e.IsSuccess || e.WebErrorStatus == CoreWebView2WebErrorStatus.OperationCanceled || !IsOwnUi(core.Source)) return;
            UiNotLoaded("shell.ui.loadFailed", ("status", e.WebErrorStatus.ToString()), ("code", e.HttpStatusCode));
        };
        core.DocumentTitleChanged += (_, _) => Title = WindowTitle(IsOwnUi(core.Source) ? core.DocumentTitle : null);
        core.ProcessFailed += OnProcessFailed;
        // Items changed externally (an agent edited an image according to the notes): the UI rescans itself; when the window returns to the foreground, look right away
        materials = new MaterialWatcher(Dispatcher, settings, entries => Post(new { @event = "materialsChanged", entries }));
        if (!IsVisible) materials.Pause(true);
        Activated += (_, _) => materials.WindowActivated();
        core.Navigate(Environment.GetEnvironmentVariable("SNIPTOSS_DEV_URL") ?? $"https://{AppHost}/index.html");
    }

    readonly Queue<DateTime> renderCrashes = new();

    /// <summary>
    /// Something happened to a WebView2 process. If the UI process crashed: reload (notes are saved as soon as they're written; the list and selected item recover themselves after loading);
    /// if it crashes three times within a minute, stop reloading automatically and show the notice page instead, to avoid flashing endlessly. If the whole browser process is gone: the control is dead and only restarting the app helps
    /// </summary>
    void OnProcessFailed(object? sender, CoreWebView2ProcessFailedEventArgs e)
    {
        Log.Error($"WebView2 process failed: {e.ProcessFailedKind}, reason {e.Reason}, exit code {e.ExitCode}, {e.ProcessDescription}");
        switch (e.ProcessFailedKind)
        {
            case CoreWebView2ProcessFailedKind.BrowserProcessExited:
                UiNotLoaded("shell.ui.processExited");
                break;
            case CoreWebView2ProcessFailedKind.RenderProcessExited:
                var now = DateTime.Now;
                renderCrashes.Enqueue(now);
                while (renderCrashes.Count > 0 && now - renderCrashes.Peek() > TimeSpan.FromMinutes(1)) renderCrashes.Dequeue();
                if (renderCrashes.Count >= 3) UiNotLoaded("shell.ui.crashLoop"); // log it: the log tells whether it stopped or reloaded again
                else web.CoreWebView2?.Reload();
                break;
            // The UI is unresponsive (RenderProcessUnresponsive): WebView2 waits for it to recover itself, a log entry is enough; the rest are GPU and other helper processes, which WebView2 restarts itself
        }
    }

    System.Windows.Threading.DispatcherTimer? readyWatch;

    /// <summary>
    /// 30 seconds after the UI starts to be created, and after each page starts loading, it still hasn't said "ready" (the UI's ready): WebView2 didn't come up or the UI script didn't run (corrupt files, blocked), and the user only sees a blank area.
    /// Replace it with the notice page (restart, exit, open log). Not counted while the window is hidden (nothing renders when hidden in the tray; it keeps waiting once shown again); ignored in development (it may be stopped at a breakpoint)
    /// </summary>
    void WatchReady()
    {
        if (DevMode) return;
        readyWatch ??= new System.Windows.Threading.DispatcherTimer(TimeSpan.FromSeconds(30), System.Windows.Threading.DispatcherPriority.Background, (_, _) =>
        {
            if (!IsVisible) return;
            readyWatch!.Stop();
            UiNotLoaded("shell.ui.timeout");
        }, Dispatcher);
        readyWatch.Stop();
        readyWatch.Start();
    }

    /// <summary>The UI can't start: the text on the notice page (a message). The log records the same sentence in English, regardless of the UI language (ADR-0001 item 13)</summary>
    void UiNotLoaded(string key, params (string Name, object Value)[] args)
    {
        readyWatch?.Stop();
        Log.Error(Locale.In("en", key, args));
        ShowStartupProblem(null, Locale.T(key, args));
    }

    /// <summary>
    /// When the UI can't start or the browser process is gone, the window is replaced with a native notice page and the system title bar comes back (×, minimize, drag; dragging blank space also moves the window)
    /// </summary>
    void ShowStartupProblem(Exception? ex, string? what = null)
    {
        readyWatch?.Stop();
        Title = AppName; // the UI is gone, so stop showing the item that was open
        RestoreSystemTitleBar();
        var runtimeMissing = ex is WebView2RuntimeNotFoundException;
        var panel = new System.Windows.Controls.StackPanel
        {
            MaxWidth = 560,
            Margin = new Thickness(32),
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        var app = ("app", (object)AppName);
        panel.Children.Add(NativeUi.Title(Locale.T(runtimeMissing ? "shell.ui.runtimeTitle" : "shell.ui.title", app)));
        panel.Children.Add(NativeUi.Body(Locale.T(runtimeMissing ? "shell.ui.runtimeBody" : "shell.ui.failedBody", ("what", what ?? Locale.T("shell.ui.notStarted")))));
        if (ex is not null) panel.Children.Add(NativeUi.Detail($"{ex.GetType().Name}: {ex.Message}"));
        var buttons = new ButtonRow();
        var left = System.Windows.Controls.Dock.Left;
        var right = System.Windows.Controls.Dock.Right;
        buttons.Children.Add(NativeUi.MakeButton(Locale.T("app.error.openLog"), false, _ => Crash.OpenLogFolder(), left));
        if (ex is not null) buttons.Children.Add(NativeUi.CopyDiagnosticsButton(ex, left));
        buttons.Children.Add(NativeUi.MakeButton(Locale.T("shell.button.exit"), false, _ => Quit(), right));
        buttons.Children.Add(NativeUi.MakeButton(Locale.T("shell.button.restart"), !runtimeMissing, _ => Crash.Restart(), right));
        if (runtimeMissing)
        {
            buttons.Children.Add(NativeUi.MakeButton(Locale.T("shell.button.downloadWebView2"), true, _ =>
            {
                try
                {
                    Process.Start(new ProcessStartInfo("https://go.microsoft.com/fwlink/p/?LinkId=2124703") { UseShellExecute = true });
                }
                catch (Exception open)
                {
                    Log.Warn("Could not open the download page", open);
                }
            }, right));
        }
        panel.Children.Add(buttons);
        var page = new System.Windows.Controls.Border { Background = NativeUi.Bg, Child = panel };
        page.MouseLeftButtonDown += (_, e) =>
        {
            if (e.OriginalSource is not System.Windows.Controls.Button && e.ButtonState == System.Windows.Input.MouseButtonState.Pressed) DragMove();
        };
        TextElement.SetForeground(page, NativeUi.Text);
        TextElement.SetFontFamily(page, NativeUi.UiFont);
        TextElement.SetFontSize(page, 13);
        Content = page;
        ShowFromTray();
    }

    /// <summary>
    /// Automatic update check after startup (Updates): only if enabled in Settings and at least a day since the last check; a new version is sent to the UI (updateAvailable), which shows a hint on the title bar without a popup interruption.
    /// Not checked in test instances (tests don't go online); if it can't be checked (offline, repository not public) it only logs, and tries again at the next start
    /// </summary>
    async Task AutoCheckUpdatesAsync()
    {
        if (AppPaths.IsTestInstance || !settings.UpdateCheck) return;
        if (settings.UpdatesCheckedAt is { } last && DateTime.UtcNow - last < TimeSpan.FromHours(20)) return;
        await Task.Delay(TimeSpan.FromSeconds(5)); // don't compete with startup
        var r = await Updates.CheckAsync();
        Bridge.UpdateReply(r);
        if (r.Error is not null) return;
        settings.Update(s => s.UpdatesCheckedAt = DateTime.UtcNow);
        if (r.Newer is { } n) Post(new { @event = "updateAvailable", version = n.Version, url = n.Url, prerelease = n.Prerelease });
    }
    /// <summary>This address is our own UI (the packaged ui, or the dev server SNIPTOSS_DEV_URL points at in development)</summary>
    internal static bool IsOwnUi(string uri)
    {
        if (!Uri.TryCreate(uri, UriKind.Absolute, out var u)) return false;
        if (u.Host.Equals(AppHost, StringComparison.OrdinalIgnoreCase)) return true;
        return Environment.GetEnvironmentVariable("SNIPTOSS_DEV_URL") is { } dev && Uri.TryCreate(dev, UriKind.Absolute, out var d) && d.Authority == u.Authority;
    }


    void Post(object payload) => web.CoreWebView2?.PostWebMessageAsJson(System.Text.Json.JsonSerializer.Serialize(payload));


    void OnReady()
    {
        readyWatch?.Stop();
        if (pendingSettings is { } section)
        {
            pendingSettings = null;
            Post(new { @event = "openSettings", section });
        }
        // Performance budget: record how many milliseconds "startup → UI ready" took (when SNIPTOSS_PERF_LOG points at a file)
        if (readyLogged) return;
        readyLogged = true;
        _ = AutoCheckUpdatesAsync();
        WarmUpCapture();
        var total = (DateTime.Now - Process.GetCurrentProcess().StartTime).TotalMilliseconds;
        Perf.Record(string.Create(CultureInfo.InvariantCulture, $"Process start → UI ready {total:F0} ms ({sinceStart.ElapsedMilliseconds} ms after the window was constructed)"));
    }
}
