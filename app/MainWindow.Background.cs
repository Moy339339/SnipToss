using System.Windows;
using System.Windows.Interop;
using System.Windows.Threading;
using SnipToss.App.Capture;
using static SnipToss.App.Native;

namespace SnipToss.App;

// The background half of the main window (part of MainWindow): the Screen Capture global hotkey, the tray, the capture entry point and settings; released on quit and shutdown
sealed partial class MainWindow
{
    void ReleaseBackground()
    {
        hotkey?.Dispose();
        tray?.Dispose();
        materials?.Dispose();
        annotationWatch?.Dispose();
        // The short junctions for long paths exist only while the app is open: if another tool deletes %LOCALAPPDATA%\SnipToss and happens to follow a junction, it would delete the user's items
        LongPaths.Clean();
    }

    /// <summary>Shutdown or logoff: no more hiding to the tray, really close (see SessionEnding in Program)</summary>
    public void PrepareForSessionEnd()
    {
        Log.Info("Shutdown or logoff, exiting");
        quitting = true;
        CaptureSession.Current?.Cancel();
    }

    // ---------- Background: the Screen Capture global hotkey, the tray ----------

    GlobalHotKey? hotkey;
    string? hotkeyError;
    /// <summary>
    /// At this start the default hotkey that would type a character was replaced: the UI shows a notice once (the replacement is already saved in settings, so the next start doesn't replace or announce it again).
    /// Handed out only once (TakeHotkeyMoved): not repeated when the page reloads (after a new drive is plugged in)
    /// </summary>
    object? hotkeyMoved;

    object? TakeHotkeyMoved()
    {
        var moved = hotkeyMoved;
        hotkeyMoved = null;
        return moved;
    }
    Tray? tray;
    /// <summary>The tray icon (null when absent); read by the shell tests' test hooks</summary>
    internal Tray? TrayIcon => tray;
    /// <summary>The capture hotkey; the shell tests' test hooks send it a "pressed"</summary>
    internal GlobalHotKey? HotKey => hotkey;
    MaterialWatcher? materials;
    bool quitting;

    /// <summary>The capture hotkey that is actually in effect (registered successfully), shown on the tray menu</summary>
    public string? ActiveHotkey => hotkey?.Current;

    void StartBackground()
    {
        hotkey = new GlobalHotKey(() => StartCapture(fromButton: false));
        AvoidTypingHotkey(hotkey);
        hotkeyError = hotkey.Set(settings.Capture.Hotkey);
        UpdateTray();
        // When started into the tray at login, the UI isn't loaded (no OnReady): after a few seconds the capture overlay is warmed up too, since pressing the hotkey to capture is exactly the case then
        var warm = new DispatcherTimer(TimeSpan.FromSeconds(5), DispatcherPriority.ApplicationIdle, (s, _) =>
        {
            ((DispatcherTimer)s!).Stop();
            WarmUpCapture();
        }, Dispatcher);
        warm.Start();
        // The capture hotkey failed to register (usually another program holds it): a tray balloon says so, and clicking it opens Settings → Screen Capture to pick another.
        // Before, only a red line in the settings page said so, and with autostart and no window open, pressing the hotkey did nothing with no explanation
        if (hotkeyError is not null)
        {
            Log.Warn($"Screen Capture hotkey could not be registered: {hotkeyError}");
            tray?.Say(Locale.T("shell.tray.hotkeyFailed"), Locale.T("shell.tray.hotkeyFailedBody", ("reason", hotkeyError)), () => OpenSettings("capture"));
        }
    }

    /// <summary>Warms up the capture overlay once the UI is idle (CaptureSession.WarmUp, done only once): after the UI is ready, or 5 seconds after startup (when in the tray), whichever comes first</summary>
    void WarmUpCapture() =>
        Dispatcher.InvokeAsync(() => CaptureSession.WarmUp(settings), DispatcherPriority.ApplicationIdle);

    /// <summary>The Settings page to open when the UI isn't loaded (started into the tray at login, where the UI loads only when the window is first shown); it is opened after loading (OnReady)</summary>
    string? pendingSettings;

    /// <summary>Opens the window and a Settings page (a tray balloon was clicked)</summary>
    void OpenSettings(string section)
    {
        ShowFromTray();
        if (readyLogged) Post(new { @event = "openSettings", section });
        else pendingSettings = section;
    }

    /// <summary>
    /// A default hotkey that was never recorded would type a character in an installed keyboard layout (AltGr, see <see cref="GlobalHotKey.TypedChars(string)"/>): replace it with one that doesn't clash, and tell the user once.
    /// A hotkey the user recorded is left alone; the settings page says which character it will block
    /// </summary>
    void AvoidTypingHotkey(GlobalHotKey keys)
    {
        var old = settings.Capture.Hotkey;
        if (settings.Capture.HotkeyCustom) return;
        var typed = GlobalHotKey.TypedChars(old);
        if (typed.Length == 0) return;
        var to = GlobalHotKey.PickFallback(GlobalHotKey.TypedChars, k => keys.Set(k) is null);
        settings.Update(s => s.Capture.Hotkey = to);
        hotkeyMoved = new { from = old, to, typed };
        Log.Info($"Screen Capture hotkey {old} would type '{typed}' in an installed keyboard layout; changed to {(to.Length > 0 ? to : "(none)")}");
    }

    /// <summary>At login (--tray) the window isn't shown, only the tray</summary>
    public bool StartedInTray { get; init; }

    /// <summary>
    /// The tray icon exists only while "keep in the tray after closing the window" is on (when it's off, closing the window quits, and an icon would be pointless).
    /// An instance started at login always needs an icon, otherwise it can't be seen or quit
    /// </summary>
    void UpdateTray()
    {
        if (settings.Capture.KeepInTray || StartedInTray) tray ??= new Tray(this);
        else
        {
            tray?.Dispose();
            tray = null;
        }
    }

    void HideToTray()
    {
        Post(new { @event = "windowHidden" }); // the UI pauses any playing video
        if (fullscreen is not null) ExitFullscreen();
        SavePlacement();
        Hide();
        if (!settings.Capture.TrayHintShown)
        {
            var key = hotkey?.Current is { } k ? Locale.T("shell.tray.hotkeyHint", ("keys", GlobalHotKey.Pretty(k))) : "";
            tray?.Say(Locale.T("shell.tray.stillRunning", ("app", AppName)), Locale.T("shell.tray.stillRunningBody", ("hotkeyHint", key)));
            settings.Update(s => s.Capture.TrayHintShown = true);
        }
    }

    public void ShowFromTray()
    {
        if (!IsVisible) ShowWithoutFlash();
        if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
        Activate();
    }

    const int DWMWA_CLOAK = 13;
    DispatcherTimer? uncloak;

    /// <summary>
    /// Brings back a hidden window (tray, hidden during capture): first tell the desktop compositor not to draw it (DWMWA_CLOAK), then reveal it once the UI has painted.
    /// A plain Show often flashes a pure white frame first (WebView2 has just resumed and not painted yet; common both when called back from the tray and when restored after a capture)
    /// </summary>
    void ShowWithoutFlash()
    {
        var hwnd = new WindowInteropHelper(this).EnsureHandle();
        int on = 1;
        _ = DwmSetWindowAttribute(hwnd, DWMWA_CLOAK, ref on, sizeof(int));
        Show();
        uncloak?.Stop();
        uncloak = new DispatcherTimer(TimeSpan.FromMilliseconds(100), DispatcherPriority.Background, (_, _) =>
        {
            uncloak!.Stop();
            int off = 0;
            _ = DwmSetWindowAttribute(hwnd, DWMWA_CLOAK, ref off, sizeof(int));
        }, Dispatcher);
    }

    /// <summary>Really quit (tray menu "Exit", menu "File → Exit")</summary>
    public void Quit()
    {
        quitting = true;
        CaptureSession.Current?.Cancel();
        Close();
    }

    /// <summary>
    /// Starts Screen Capture. When clicked from the button in the window: hide this window first (the Hide This Window While Capturing setting), wait until the desktop compositor has really taken it down (a frame or two), then capture, then bring it back.
    /// Hotkey / tray: capture the screen as it is now (if the window is in front it is captured too)
    /// </summary>
    /// <param name="fromTray">Clicked from the tray menu: wait the same moment, so the tray menu is gone from the screen before capturing (it used to capture immediately, and the menu could end up in the image)</param>
    public void StartCapture(bool fromButton, bool fromTray = false)
    {
        var hide = fromButton && settings.Capture.HideWindow && IsVisible && WindowState != WindowState.Minimized;
        if (!hide)
        {
            if (!fromTray)
            {
                CaptureSession.Start(settings);
                return;
            }
            var later = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(180) };
            later.Tick += (_, _) =>
            {
                later.Stop();
                CaptureSession.Start(settings);
            };
            later.Start();
            return;
        }
        Post(new { @event = "windowHidden" }); // same as hiding to the tray: the window is gone, so a playing video stops instead of keeping playing sound in the background
        Hide();
        var wait = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(180) };
        wait.Tick += (_, _) =>
        {
            wait.Stop();
            // If the capture overlay doesn't come up, Start cleans up itself (logs, calls done), and the window is still brought back
            CaptureSession.Start(settings, ShowFromTray);
        };
        wait.Start();
    }

    // Settings → Screen Capture
    public object CaptureState() => new
    {
        hotkey = settings.Capture.Hotkey,
        hotkeyError,
        hotkeyTypes = GlobalHotKey.TypedChars(settings.Capture.Hotkey),
        hotkeyMoved = TakeHotkeyMoved(),
        keepInTray = settings.Capture.KeepInTray,
        hideWindow = settings.Capture.HideWindow,
        notesInImage = settings.Capture.NotesInImage,
        folder = settings.Capture.Folder ?? "",
        defaultFolder = CaptureSettings.DefaultFolder,
        autostart = Autostart.IsOn(),
    };

    public object SetCapture(System.Text.Json.JsonElement a)
    {
        string? Str(string name) => a.TryGetProperty(name, out var v) && v.ValueKind == System.Text.Json.JsonValueKind.String ? v.GetString() : null;
        bool? Bool(string name) => a.TryGetProperty(name, out var v) && v.ValueKind is System.Text.Json.JsonValueKind.True or System.Text.Json.JsonValueKind.False ? v.GetBoolean() : null;
        var newKey = Str("hotkey")?.Trim();
        // Try to register the hotkey first and save it only if that worked (it used to save first and register after, so an occupied one was written to settings and failed again at the next start)
        string? keyError = null;
        if (newKey is not null && hotkey is not null) keyError = hotkey.Set(newKey);
        settings.Update(s =>
        {
            if (newKey is not null && keyError is null)
            {
                s.Capture.Hotkey = newKey;
                s.Capture.HotkeyCustom = true;
            }
            if (Bool("keepInTray") is { } tray) s.Capture.KeepInTray = tray;
            if (Bool("hideWindow") is { } hide) s.Capture.HideWindow = hide;
            if (Bool("notesInImage") is { } notes) s.Capture.NotesInImage = notes;
            if (Str("folder") is { } folder) s.Capture.Folder = folder.Trim().Length > 0 ? folder.Trim() : null;
        });
        if (newKey is not null) hotkeyError = keyError;
        if (Bool("keepInTray") is not null) UpdateTray();
        if (Bool("autostart") is { } auto) Autostart.Set(auto);
        return CaptureState();
    }

    /// <summary>
    /// The interface language changed (in Settings, ADR-0001 item 6): the shell's resident text follows (the window title, tray, context menu); if the hotkey failed to register, the reason is restated in the new language.
    /// The capture overlay and error windows fetch their text each time they open, so nothing to do there
    /// </summary>
    void ApplyLanguage()
    {
        Title = WindowTitle(web.CoreWebView2 is { } core && IsOwnUi(core.Source) ? core.DocumentTitle : null);
        tray?.Relabel();
        if (hotkeyError is not null && !hotkeyPaused) hotkeyError = hotkey?.Set(settings.Capture.Hotkey);
        try
        {
            ShellIntegration.RefreshLabel();
        }
        catch (Exception ex) when (ex is UnauthorizedAccessException or System.Security.SecurityException or System.IO.IOException)
        {
            Log.Warn("Could not update the Explorer context menu text", ex);
        }
    }

    /// <summary>When the UI records a new hotkey the old one is stopped first, otherwise pressing the old keys would start a capture directly</summary>
    public void PauseHotkey(bool pause)
    {
        hotkeyPaused = pause;
        hotkeyError = hotkey?.Set(pause ? null : settings.Capture.Hotkey);
    }

    /// <summary>The UI is recording a hotkey (the old one is paused). If the page reloads meanwhile, the recording box is gone and can't send "done recording": restored on load</summary>
    bool hotkeyPaused;
}
