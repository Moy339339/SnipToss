using System.Diagnostics;
using System.Windows.Interop;
using static SnipToss.App.Native;

namespace SnipToss.App.Capture;

/// <summary>
/// While a capture is open, notes in the log when another app takes the foreground from the overlay, or when another app's window appears above it
/// (a notification, a window brought to the front, the taskbar). Diagnostics only: nothing is changed, and the user sees nothing.
/// Driven by system events (no polling), hooked only while the overlay is up, at most <see cref="MaxLines"/> lines per capture
/// </summary>
sealed class OverlayWatch
{
    const uint EVENT_SYSTEM_FOREGROUND = 0x0003;
    const uint EVENT_OBJECT_SHOW = 0x8002;
    const uint WINEVENT_SKIPOWNPROCESS = 0x2;
    const uint GA_ROOT = 2;
    const uint GW_HWNDNEXT = 2;
    const int MaxLines = 20;

    readonly IReadOnlyList<CaptureOverlay> overlays;
    readonly WinEventProc proc; // kept alive for as long as the hooks are
    readonly IntPtr foregroundHook, showHook;
    readonly Stopwatch clock = Stopwatch.StartNew();
    int lines;

    public OverlayWatch(IReadOnlyList<CaptureOverlay> overlays)
    {
        this.overlays = overlays;
        proc = OnEvent;
        // Out of context (0): the callbacks come through this thread's message loop
        foregroundHook = SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, 0, proc, 0, 0, WINEVENT_SKIPOWNPROCESS);
        showHook = SetWinEventHook(EVENT_OBJECT_SHOW, EVENT_OBJECT_SHOW, 0, proc, 0, 0, WINEVENT_SKIPOWNPROCESS);
    }

    void OnEvent(IntPtr hook, uint eventType, IntPtr hwnd, int idObject, int idChild, uint thread, uint time)
    {
        if (lines >= MaxLines || hwnd == 0 || idObject != 0 /* OBJID_WINDOW */ || idChild != 0) return;
        try
        {
            if (eventType == EVENT_SYSTEM_FOREGROUND) Note($"took the foreground from the overlay: {Describe(hwnd)}");
            else if (GetAncestor(hwnd, GA_ROOT) == hwnd && IsWindowVisible(hwnd) && AboveOverlay(hwnd)) Note($"appeared above the overlay: {Describe(hwnd)}");
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException or System.ComponentModel.Win32Exception)
        {
            // The window or its process went away meanwhile: nothing to note
        }
    }

    /// <summary>Whether one of the overlays comes later in the Z order (top to bottom) than this window</summary>
    bool AboveOverlay(IntPtr hwnd)
    {
        var mine = overlays.Select(o => new WindowInteropHelper(o).Handle).Where(h => h != 0).ToHashSet();
        if (mine.Count == 0 || !GetWindowRect(hwnd, out var r) || r.Right <= r.Left || r.Bottom <= r.Top) return false;
        var steps = 0;
        for (var h = GetWindow(hwnd, GW_HWNDNEXT); h != 0 && steps < 2000; h = GetWindow(h, GW_HWNDNEXT), steps++)
            if (mine.Contains(h)) return true;
        return false;
    }

    /// <summary>The app (process name), window class and size: enough to tell a notification from the taskbar or an app window, without the window's title</summary>
    static string Describe(IntPtr hwnd)
    {
        _ = GetWindowThreadProcessId(hwnd, out var pid);
        string app;
        try
        {
            using var p = Process.GetProcessById(pid);
            app = p.ProcessName;
        }
        catch (ArgumentException)
        {
            app = "(exited)";
        }
        var buffer = new char[128];
        var cls = new string(buffer, 0, Math.Max(0, GetClassName(hwnd, buffer, buffer.Length)));
        var size = GetWindowRect(hwnd, out var r) ? $"{r.Right - r.Left}×{r.Bottom - r.Top} at {r.Left},{r.Top}" : "no size";
        return $"{app}, {cls}, {size}";
    }

    void Note(string what)
    {
        lines++;
        Log.Info($"Screen Capture, {clock.ElapsedMilliseconds} ms after opening: another app {what}{(lines == MaxLines ? " (no more of these for this capture)" : "")}");
    }

    /// <summary>Unhooks (on the thread that hooked, as the system requires)</summary>
    public void Stop()
    {
        if (foregroundHook != 0) UnhookWinEvent(foregroundHook);
        if (showHook != 0) UnhookWinEvent(showHook);
    }
}
