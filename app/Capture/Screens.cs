using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using static SnipToss.App.Native;

namespace SnipToss.App.Capture;

/// <summary>One display: its screen coordinates (physical pixels), its scale, and the picture at the moment the shortcut was pressed</summary>
sealed record MonitorShot(Int32Rect Bounds, double Scale, BitmapSource Shot);

/// <summary>Screen grabbing and window lookup. Coordinates are always physical pixels (the app is PerMonitorV2, so system scaling cannot fool it)</summary>
static class Screens
{
    /// <summary>Grab one image per display (a frozen picture to select and mark up afterwards)</summary>
    public static List<MonitorShot> CaptureAll()
    {
#if TEST_HOOKS
        if (CaptureFakes.Monitors is { } fake) return fake();
#endif
        var monitors = new List<(IntPtr handle, RECT rect)>();
        EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (h, _, r, _) =>
        {
            monitors.Add((h, Marshal.PtrToStructure<RECT>(r)));
            return true;
        }, IntPtr.Zero);

        var shots = new List<MonitorShot>();
        var screen = GetDC(IntPtr.Zero);
        try
        {
            foreach (var (handle, r) in monitors)
            {
                var w = r.Right - r.Left;
                var h = r.Bottom - r.Top;
                if (w <= 0 || h <= 0) continue;
                _ = GetDpiForMonitor(handle, 0 /* MDT_EFFECTIVE_DPI */, out var dpi, out _); // on failure dpi is 0, and the code below uses a scale of 1
                shots.Add(new(new Int32Rect(r.Left, r.Top, w, h), dpi > 0 ? dpi / 96.0 : 1, Grab(screen, r.Left, r.Top, w, h)));
            }
        }
        finally
        {
            _ = ReleaseDC(IntPtr.Zero, screen);
        }
        return shots;
    }

    static BitmapSource Grab(IntPtr screen, int x, int y, int w, int h)
    {
        var mem = CreateCompatibleDC(screen);
        var bmp = CreateCompatibleBitmap(screen, w, h);
        var old = SelectObject(mem, bmp);
        try
        {
            // CAPTUREBLT: layered windows (tooltips, some menus) are captured too
            // On failure the result is a black image (for example on the lock screen or after a remote desktop disconnects): log it, so a "the screenshot is black" report can be traced
            if (!BitBlt(mem, 0, 0, w, h, screen, x, y, 0x00CC0020 /* SRCCOPY */ | 0x40000000 /* CAPTUREBLT */))
                Log.Warn($"Screen grab failed (BitBlt, error code {Marshal.GetLastPInvokeError()}), region {x},{y} {w}×{h}");
            SelectObject(mem, old);
            var src = Imaging.CreateBitmapSourceFromHBitmap(bmp, IntPtr.Zero, Int32Rect.Empty, BitmapSizeOptions.FromEmptyOptions());
            // Convert to Bgra32: cropping, compositing and the clipboard all use this format afterwards
            var converted = new FormatConvertedBitmap(src, PixelFormats.Bgra32, null, 0);
            var frozen = new WriteableBitmap(converted);
            frozen.Freeze();
            return frozen;
        }
        finally
        {
            DeleteObject(bmp);
            DeleteDC(mem);
        }
    }

    /// <summary>
    /// The visible windows on screen, top to bottom (Z order). Hovering highlights the topmost one and a click selects it (as in other screenshot tools).
    /// Skips: windows of the ownProcessId process (0 = skip none), minimized ones, ones the system hides (DWM cloaked, such as windows on other virtual desktops), and transparent layers that cannot be clicked
    /// </summary>
    public static List<Int32Rect> WindowRects(int ownProcessId)
    {
#if TEST_HOOKS
        if (CaptureFakes.Windows is { } fake) return [.. fake];
#endif
        var list = new List<Int32Rect>();
        EnumWindows((hwnd, lParam) =>
        {
            // Cheap checks first: most top-level windows are hidden, and Accept rejects them anyway, so skip the DWM calls for them
            var visible = IsWindowVisible(hwnd);
            var minimized = IsIconic(hwnd);
            if (!visible || minimized) return true;
            _ = GetWindowThreadProcessId(hwnd, out var pid);
            if (pid == ownProcessId) return true;
            var ex = GetWindowLongPtr(hwnd, -20 /* GWL_EXSTYLE */).ToInt64();
            // On failure DWM leaves nothing to go by: treat the window as not cloaked
            if (DwmGetWindowAttribute(hwnd, 14 /* DWMWA_CLOAKED */, out int cloaked, 4) != 0) cloaked = 0;
            // The bounds that are actually visible (without the invisible resize border around a Windows 10/11 window);
            // when neither source gives bounds, the window has no size and is skipped
            var hasBounds = DwmGetWindowAttribute(hwnd, 9 /* DWMWA_EXTENDED_FRAME_BOUNDS */, out RECT r, Marshal.SizeOf<RECT>()) == 0 || GetWindowRect(hwnd, out r);
            var width = hasBounds ? r.Right - r.Left : 0;
            var height = hasBounds ? r.Bottom - r.Top : 0;
            if (Accept(visible, minimized, ex, cloaked, width, height))
                list.Add(new Int32Rect(r.Left, r.Top, width, height));
            return true;
        }, IntPtr.Zero);
        return list;
    }

    /// <summary>
    /// Whether a window can be hovered and selected: visible, not minimized, not a transparent layer that cannot be clicked (WS_EX_TRANSPARENT),
    /// not hidden by the system (DWM cloaked is non-zero, as for windows on other virtual desktops) and at least 8 × 8 physical pixels.
    /// Other extended style bits (topmost, tool window) do not matter
    /// </summary>
    internal static bool Accept(bool visible, bool minimized, long exStyle, int cloaked, int width, int height) =>
        visible && !minimized && (exStyle & 0x20 /* WS_EX_TRANSPARENT */) == 0 && cloaked == 0 && width >= 8 && height >= 8;

    /// <summary>The scale of the display containing this screen point (physical pixels); 1 if it cannot be read</summary>
    public static double ScaleAt(int x, int y)
    {
#if TEST_HOOKS
        if (CaptureFakes.Monitors is not null) return 1;
#endif
        var monitor = MonitorFromPoint(new POINT { X = x, Y = y }, 2 /* MONITOR_DEFAULTTONEAREST */);
        return GetDpiForMonitor(monitor, 0 /* MDT_EFFECTIVE_DPI */, out var dpi, out _) == 0 && dpi > 0 ? dpi / 96.0 : 1;
    }

    /// <summary>The pointer position on screen (physical pixels); null if it cannot be read</summary>
    public static (int X, int Y)? Cursor()
    {
#if TEST_HOOKS
        if (CaptureFakes.Monitors is not null) return CaptureFakes.Cursor;
#endif
        return GetCursorPos(out var p) ? (p.X, p.Y) : null;
    }
}
