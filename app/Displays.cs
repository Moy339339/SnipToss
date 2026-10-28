using System.Runtime.InteropServices;
using System.Windows;
using static SnipToss.App.Native;

namespace SnipToss.App;

/// <summary>
/// One display: the bounds of the whole screen and of its work area (minus the taskbar), in physical pixels, in virtual-desktop coordinates; Scale is this screen's scaling (DPI / 96).
/// Window placement is always computed from it: each screen has its own scaling, and no single DIP coordinate system is valid for all of them
/// </summary>
sealed record Display(Rect Bounds, Rect Work, double Scale)
{
    /// <summary>The work area's width and height in DIPs at this screen's scaling (the size the UI can actually use)</summary>
    public Size WorkDip => new(Work.Width / Scale, Work.Height / Scale);
}

/// <summary>The displays currently connected (queried every time: plugging a display in or out, changing the scaling, or moving the taskbar can all change them)</summary>
static class Displays
{
    const uint DefaultToNearest = 2, DefaultToPrimary = 1;

    public static List<Display> All()
    {
        var handles = new List<IntPtr>();
        EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (h, _, _, _) =>
        {
            handles.Add(h);
            return true;
        }, IntPtr.Zero);
        return [.. handles.Select(Of).OfType<Display>()];
    }

    /// <summary>The screen the window is (mostly) on</summary>
    public static Display? OfWindow(IntPtr hwnd) => Of(MonitorFromWindow(hwnd, DefaultToNearest));

    /// <summary>The screen the mouse is on (the window goes here on first open)</summary>
    public static Display? AtCursor() => GetCursorPos(out var p) ? Of(MonitorFromPoint(p, DefaultToNearest)) : Primary();

    public static Display? Primary() => Of(MonitorFromPoint(new POINT(), DefaultToPrimary));

    static Display? Of(IntPtr monitor)
    {
        var info = new MONITORINFO { cbSize = Marshal.SizeOf<MONITORINFO>() };
        if (monitor == IntPtr.Zero || !GetMonitorInfo(monitor, ref info)) return null;
        // If the scaling can't be read, assume 100%
        var scale = GetDpiForMonitor(monitor, 0 /* MDT_EFFECTIVE_DPI */, out var dpi, out _) == 0 && dpi > 0 ? dpi / 96.0 : 1;
        return new(ToRect(info.rcMonitor), ToRect(info.rcWork), scale);
    }

    static Rect ToRect(RECT r) => new(r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top);

    /// <summary>
    /// Which edges of this screen have an auto-hide taskbar (ABM_GETAUTOHIDEBAREX): a maximized window has to leave a little room on that edge,
    /// otherwise it covers the whole screen, the system takes it for a full-screen app, and the taskbar won't pop up when the mouse moves to that edge
    /// </summary>
    public static (bool Left, bool Top, bool Right, bool Bottom) AutoHideTaskbars(Rect bounds)
    {
        bool On(uint edge)
        {
            var data = new APPBARDATA
            {
                cbSize = Marshal.SizeOf<APPBARDATA>(),
                uEdge = edge,
                rc = new RECT { Left = (int)bounds.Left, Top = (int)bounds.Top, Right = (int)bounds.Right, Bottom = (int)bounds.Bottom },
            };
            return SHAppBarMessage(0x0000000B /* ABM_GETAUTOHIDEBAREX */, ref data) != UIntPtr.Zero;
        }
        return (On(0 /* ABE_LEFT */), On(1 /* ABE_TOP */), On(2 /* ABE_RIGHT */), On(3 /* ABE_BOTTOM */));
    }
}
