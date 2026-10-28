using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using static SnipToss.App.Native;

namespace SnipToss.App;

// The window frame (part of MainWindow): saving the position, the Window menu (minimize, maximize, full screen, always on top), the self-drawn title bar, the dark border
sealed partial class MainWindow
{
    /// <summary>Whether it was maximized before minimizing (used when saving the position, see WindowPlacement.From)</summary>
    bool maximizedBeforeMinimize;
    System.Windows.Threading.DispatcherTimer? placementTimer;

    void SavePlacement()
    {
        placementTimer?.Stop();
        if (fullscreen is not null || !IsLoaded) return; // the position during full screen doesn't count (the pre-fullscreen one is restored in ExitFullscreen)
        if (WindowPlacement.From(this, maximizedBeforeMinimize) is { } p) settings.Update(s => s.Placement = p);
    }

    /// <summary>
    /// Saves the position once, 2 seconds after moving or resizing stops: it used to be saved only on closing the window or hiding to the tray, so when the process was ended from Task Manager or crashed, the latest position was lost.
    /// Not saved while hidden (Hide also raises these events)
    /// </summary>
    void SavePlacementSoon()
    {
        if (!IsVisible) return;
        placementTimer ??= new System.Windows.Threading.DispatcherTimer(TimeSpan.FromSeconds(2), System.Windows.Threading.DispatcherPriority.Background, (_, _) => SavePlacement(), Dispatcher);
        placementTimer.Stop();
        placementTimer.Start();
    }


    // ---------- The Window menu: minimize, maximize, full screen, always on top ----------

    /// <summary>How the window looked before full screen, restored on exit; null = not in full screen</summary>
    (WindowState state, WindowStyle style, ResizeMode resize)? fullscreen;

    public object State() => new { maximized = ShowsMaximized(WindowState, fullscreen is not null, maximizedBeforeMinimize), fullscreen = fullscreen is not null, topmost = Topmost };

    /// <summary>
    /// Whether the maximize button should show "Restore". A minimized window counts as the state it will be restored to: when called back from the taskbar the WebView2 size is unchanged and the UI gets no resize,
    /// so the button relies entirely on the state returned at the minimize (it used to answer "not maximized", so a maximized window restored with the button still on "Maximize" and the top-edge handle showing up). Full screen doesn't count as maximized
    /// </summary>
    internal static bool ShowsMaximized(WindowState state, bool fullscreen, bool maximizedBeforeMinimize) =>
        !fullscreen && (state == WindowState.Maximized || (state == WindowState.Minimized && maximizedBeforeMinimize));

    /// <summary>
    /// Window name (what the taskbar, Alt+Tab and screen readers read): with an item open it is "hero.png - 超级批注", like document apps on Windows; with none open or before the UI is up, just the product name.
    /// page is the UI's title; if the UI hasn't set one, WebView2 gives the URL, which isn't used
    /// </summary>
    internal static string WindowTitle(string? page) =>
        string.IsNullOrWhiteSpace(page) || page == AppName || page.Contains(AppHost, StringComparison.OrdinalIgnoreCase) ? AppName : $"{page} - {AppName}";

    public object Command(string action)
    {
        switch (action)
        {
            case "minimize":
                WindowState = WindowState.Minimized;
                break;
            case "maximize":
                if (fullscreen is null) WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;
                break;
            case "fullscreen":
                if (fullscreen is null) EnterFullscreen();
                else ExitFullscreen();
                break;
            case "topmost":
                Topmost = !Topmost;
                settings.Update(s => s.Topmost = Topmost);
                break;
            case "resetLayout":
                // Menu "View → Reset Layout": the window returns to its default size, centered on the screen it is on now (the UI restores the two side panels' widths itself)
                if (fullscreen is not null) ExitFullscreen();
                if ((Displays.OfWindow(new WindowInteropHelper(this).Handle) ?? Displays.Primary()) is { } display)
                {
                    var (rect, maximize) = WindowPlacement.DefaultOn(display, WindowPlacement.MinDip);
                    WindowPlacement.Place(this, rect, maximize);
                }
                if (WindowPlacement.From(this) is { } p) settings.Update(s => s.Placement = p);
                break;
            case "close":
                Dispatcher.InvokeAsync(Close); // send the reply back first, then close (when keep-in-tray is on, closing means hiding to the tray)
                break;
            case "quit":
                Dispatcher.InvokeAsync(Quit);
                break;
            default:
                throw new ArgumentException($"Unsupported window action: {action}");
        }
        return State();
    }

    void EnterFullscreen()
    {
        fullscreen = (WindowState, WindowStyle, ResizeMode);
        WindowPlacement.FitMinSize(this); // if the screen is smaller than the minimum size, full screen still covers just this screen
        // Go back to Normal first and then maximize; only then does a borderless maximize cover the taskbar
        WindowState = WindowState.Normal;
        WindowStyle = WindowStyle.None;
        ResizeMode = ResizeMode.NoResize;
        WindowState = WindowState.Maximized;
    }

    void ExitFullscreen()
    {
        if (fullscreen is not { } was) return;
        fullscreen = null;
        WindowStyle = was.style;
        ResizeMode = was.resize;
        WindowState = was.state == WindowState.Maximized ? WindowState.Maximized : WindowState.Normal;
    }

    // ---------- The self-drawn title bar ----------

    /// <summary>
    /// The title bar is drawn by the UI itself, and the menu bar sits at the very top of the window. The approach is the same as Windows Terminal's:
    /// when computing the client area (WM_NCCALCSIZE), let the system compute as usual, then pull the top edge back up to the top of the window: only the system title bar is removed,
    /// and the system border on the left, right and bottom stays as is (on Win10/11 it is invisible; it is the ring around the window where resizing happens, and it carries the shadow).
    /// When maximized, the window extends past the screen by one border width on every side, so the top edge leaves the same amount, so that the UI starts at the top of the screen; full screen has no border, nothing to leave.
    /// Dragging the window relies on app-region: drag in the UI (IsNonClientRegionSupportEnabled); pulling the top edge up to change the height is in StartResize.
    /// (WPF's WindowChrome was tried: it lays the whole window out as the client area, so WebView2 is a ring larger than the real client area and the right and bottom edges are cut off)
    /// </summary>
    void DropSystemTitleBar()
    {
        var hwnd = new WindowInteropHelper(this).Handle;
        HwndSource.FromHwnd(hwnd).AddHook((IntPtr h, int msg, IntPtr wParam, IntPtr lParam, ref bool handled) =>
        {
            if (systemTitleBar) return IntPtr.Zero;
            // The system window menu came up (Alt+Space, right-clicking blank space on the title bar): tell the UI to close its own menu. The Space of Alt+Space is taken by the system menu,
            // so the UI only sees Alt pressed and released, takes it for a lone Alt entering the menu bar, and the system menu would leave "File" open behind it
            if (msg == 0x0211 /* WM_ENTERMENULOOP */) Post(new { @event = "systemMenu" });
            if (msg != 0x0083 /* WM_NCCALCSIZE */ || wParam == IntPtr.Zero) return IntPtr.Zero;
            var before = Marshal.PtrToStructure<Native.NCCALCSIZE_PARAMS>(lParam).rgrc0;
            Native.DefWindowProc(h, msg, wParam, lParam);
            var p = Marshal.PtrToStructure<Native.NCCALCSIZE_PARAMS>(lParam);
            var frame = p.rgrc0.Left - before.Left; // how wide the left border is; 0 in full screen (borderless)
            var zoomed = Native.IsZoomed(h);
            p.rgrc0.Top = before.Top + (zoomed ? frame : 0);
            if (zoomed && frame > 0 && Displays.OfWindow(h) is { } display)
                p.rgrc0 = LeaveAutoHideRoom(p.rgrc0, Displays.AutoHideTaskbars(display.Bounds));
            Marshal.StructureToPtr(p, lParam, false);
            handled = true;
            return IntPtr.Zero;
        });
        // Make the system recompute the border with the new algorithm
        Native.SetWindowPos(hwnd, IntPtr.Zero, 0, 0, 0, 0, 0x0020 /* FRAMECHANGED */ | 0x0001 | 0x0002 | 0x0004 | 0x0010 /* NOSIZE NOMOVE NOZORDER NOACTIVATE */);
    }

    /// <summary>
    /// When maximized (not full screen), leave 2 pixels on the edge where an auto-hide taskbar sits (same approach as Windows Terminal):
    /// when the UI covers the whole screen the system takes it for a full-screen app, and the taskbar doesn't pop up when the mouse moves to the screen edge
    /// </summary>
    internal static Native.RECT LeaveAutoHideRoom(Native.RECT client, (bool Left, bool Top, bool Right, bool Bottom) autoHide)
    {
        const int room = 2;
        if (autoHide.Left) client.Left += room;
        if (autoHide.Top) client.Top += room;
        if (autoHide.Right) client.Right -= room;
        if (autoHide.Bottom) client.Bottom -= room;
        return client;
    }

    /// <summary>The system title bar has been put back (the UI is gone, see RestoreSystemTitleBar)</summary>
    bool systemTitleBar;

    /// <summary>
    /// When the UI can't start and is replaced by a native notice page (ShowStartupProblem), put the system title bar back: the self-drawn title bar lives in the UI, so without the UI the window has no ×, no minimize,
    /// and can't be dragged (for example when WebView2 is missing). In full screen, exit full screen first so the title bar can show
    /// </summary>
    void RestoreSystemTitleBar()
    {
        ExitFullscreen();
        if (systemTitleBar) return;
        systemTitleBar = true;
        Native.SetWindowPos(new WindowInteropHelper(this).Handle, IntPtr.Zero, 0, 0, 0, 0, 0x0020 /* FRAMECHANGED */ | 0x0001 | 0x0002 | 0x0004 | 0x0010 /* NOSIZE NOMOVE NOZORDER NOACTIVATE */);
    }

    /// <summary>
    /// The thin line / two corners at the top of the UI were pressed: hand over to the system to start resizing (same as holding the system border).
    /// WebView2 covers the whole window, so the window itself never receives the mouse for these spots; the UI forwards them
    /// </summary>
    public void StartResize(string edge)
    {
        var hit = edge switch
        {
            "top" => (IntPtr)12, // HTTOP
            "topleft" => (IntPtr)13,
            "topright" => (IntPtr)14,
            _ => throw new ArgumentException($"Invalid window edge: {edge}"),
        };
        if (WindowState != WindowState.Normal) return;
        // Send the reply back first, then enter the system's resize loop (it holds the thread until the mouse is released)
        Dispatcher.InvokeAsync(() =>
        {
            var hwnd = new WindowInteropHelper(this).Handle;
            Native.ReleaseCapture();
            Native.SendMessage(hwnd, 0x00A1 /* WM_NCLBUTTONDOWN */, hit, IntPtr.Zero);
        });
    }
}

/// <summary>
/// Windows 11 dark window border (the system title bar is gone; this manages the border color). The system menu (Alt+Space) doesn't follow it and stays the default light Windows one:
/// making it dark needs uxtheme's undocumented SetPreferredAppMode, which changes the whole process and turns the system's open-file dialog half dark, half light, so it isn't done
/// </summary>
static class DarkChrome
{
    const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;
    const int DWMWA_BORDER_COLOR = 34;
    const int DWMWA_CAPTION_COLOR = 35;
    const int DWMWA_TEXT_COLOR = 36;

    public static void Apply(Window window, Color bg)
    {
        // High-contrast theme is on: the title bar and border follow the system colors instead of switching to dark
        if (SystemParameters.HighContrast) return;
        // Cosmetic only: an old system that doesn't support one of the attributes returns an error code, which doesn't matter
        var hwnd = new WindowInteropHelper(window).Handle;
        int on = 1;
        _ = DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, ref on, sizeof(int));
        int caption = bg.R | (bg.G << 8) | (bg.B << 16); // COLORREF is 0x00BBGGRR
        _ = DwmSetWindowAttribute(hwnd, DWMWA_CAPTION_COLOR, ref caption, sizeof(int));
        int border = 0x2c | (0x2c << 8) | (0x31 << 16);
        _ = DwmSetWindowAttribute(hwnd, DWMWA_BORDER_COLOR, ref border, sizeof(int));
        int text = 0xd0 | (0xd0 << 8) | (0xd4 << 16);
        _ = DwmSetWindowAttribute(hwnd, DWMWA_TEXT_COLOR, ref text, sizeof(int));
    }
}
