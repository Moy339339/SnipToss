using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using static SnipToss.App.Native;

namespace SnipToss.App;

/// <summary>
/// The main window's position and size (Placement in settings): physical pixels, in virtual-desktop coordinates, same as GetWindowRect (including the invisible system border around it);
/// when maximized or minimized, the restored one is recorded.
/// It used to record and apply DIPs, always converted with the primary screen's scaling: with two screens of different scaling, or a scaling changed without signing out (the system DPI only changes after sign-out),
/// position and size didn't match: at 150% on the second screen "Reset Layout" put the window outside the second screen, and with the primary at 200% the window was larger than the screen.
/// Now everything is computed in physical pixels and converted with the scaling of the screen the window is on (Display), and SetWindowPos places the window
/// </summary>
sealed class WindowPlacement
{
    public double Left { get; set; } = double.NaN;
    public double Top { get; set; } = double.NaN;
    public double Width { get; set; } = 1360;
    public double Height { get; set; } = 860;
    public bool Maximized { get; set; }

    /// <summary>The window's minimum size (DIP). When the screen is smaller than it (a portrait screen at high scaling) the screen wins, see MinSizeOn</summary>
    public static readonly Size MinDip = new(960, 600);

    /// <summary>The window's current position (null before the window is created)</summary>
    /// <param name="maximizedBeforeMinimize">Whether it was maximized before minimizing (the window remembers): while minimized WindowState is Minimized,
    /// and it used to be saved as "not maximized", so maximize → minimize → exit → the next open wasn't maximized</param>
    public static WindowPlacement? From(Window w, bool maximizedBeforeMinimize = false)
    {
        var hwnd = new WindowInteropHelper(w).Handle;
        if (hwnd == IntPtr.Zero) return null;
        Rect r;
        if (w.WindowState == WindowState.Normal && GetWindowRect(hwnd, out var now))
            r = new(now.Left, now.Top, now.Right - now.Left, now.Bottom - now.Top);
        else
        {
            var wp = new WINDOWPLACEMENT { length = Marshal.SizeOf<WINDOWPLACEMENT>() };
            if (!GetWindowPlacement(hwnd, ref wp)) return null;
            // The restored position is in "work area coordinates": the origin is the top-left of the primary screen's work area (it differs from screen coordinates by an offset when the taskbar is at the top or left)
            var origin = Displays.Primary()?.Work.TopLeft ?? new Point();
            var n = wp.rcNormalPosition;
            r = new(n.Left + origin.X, n.Top + origin.Y, n.Right - n.Left, n.Bottom - n.Top);
        }
        var maximized = w.WindowState == WindowState.Maximized || (w.WindowState == WindowState.Minimized && maximizedBeforeMinimize);
        return new() { Left = r.Left, Top = r.Top, Width = r.Width, Height = r.Height, Maximized = maximized };
    }

    /// <summary>
    /// Where the window goes on open (physical pixels) and whether to maximize: if the recorded one is still reachable it is put back (shrunk to fit if it doesn't fit),
    /// otherwise (first open, second screen unplugged, resolution changed) the default layout on the screen the mouse is on
    /// </summary>
    internal (Rect Rect, bool Maximize) Target(IReadOnlyList<Display> displays, Display? atCursor, Size minDip)
    {
        var saved = new Rect(Left, Top, Width, Height);
        if (!double.IsNaN(Left) && Reachable(saved, displays)) return (Fit(saved, displays, minDip), Maximized);
        if ((atCursor ?? (displays.Count > 0 ? displays[0] : null)) is { } d) return DefaultOn(d, minDip);
        return (new Rect(0, 0, Width, Height), false); // not even one screen could be found: can't happen, give something usable
    }

    /// <summary>
    /// Whether the window is still reachable: its title bar strip (the top 40 DIP) overlaps the work area of some screen by at least 100 × 20 DIP of draggable space (converted with that screen's scaling).
    /// It used to check only whether it touched the outer frame of the whole virtual desktop: showing just 1 pixel, or sitting in the blank left by two screens of different heights, both counted as "on screen", and the window couldn't be dragged back
    /// </summary>
    internal static bool Reachable(Rect window, IEnumerable<Display> displays) =>
        displays.Any(d =>
        {
            var bar = TitleBar(window, d);
            var hit = Rect.Intersect(bar, d.Work);
            return !hit.IsEmpty && hit.Width >= Math.Min(100 * d.Scale, window.Width) && hit.Height >= Math.Min(20 * d.Scale, bar.Height);
        });

    static Rect TitleBar(Rect window, Display d) => new(window.Left, window.Top, window.Width, Math.Min(40 * d.Scale, window.Height));

    /// <summary>
    /// The recorded window is larger than the work area of the screen its title bar is on (an external monitor swapped for a laptop, resolution lowered, scaling raised): shrink to the work area and move in, so the bottom and right edges don't extend off-screen.
    /// One that fits is left as is (one deliberately placed partly off-screen is not touched)
    /// </summary>
    internal static Rect Fit(Rect window, IEnumerable<Display> displays, Size minDip)
    {
        // The title bar overlapping a screen the most decides which screen it is on
        var d = displays.Select(d => (d, hit: Rect.Intersect(TitleBar(window, d), d.Work)))
            .Where(x => !x.hit.IsEmpty)
            .OrderByDescending(x => x.hit.Width * x.hit.Height)
            .Select(x => x.d)
            .FirstOrDefault();
        if (d is null || (window.Width <= d.Work.Width && window.Height <= d.Work.Height)) return window;
        var a = d.Work;
        var min = MinSizeOn(d, minDip);
        var width = Math.Max(Math.Round(min.Width * d.Scale), Math.Min(window.Width, a.Width));
        var height = Math.Max(Math.Round(min.Height * d.Scale), Math.Min(window.Height, a.Height));
        var left = Math.Max(a.Left, Math.Min(window.Left, a.Right - width));
        var top = Math.Max(a.Top, Math.Min(window.Top, a.Bottom - height));
        return new Rect(left, top, width, height);
    }

    /// <summary>
    /// The default layout (physical pixels): 80% of the work area's width and 85% of its height on this screen (computed in DIP), centered; at most 1920 × 1200 DIP (beyond that only the canvas gets wider and the proportions of the three columns fall apart),
    /// not below the window's minimum size; if the screen is smaller than the normal minimum size it fills the work area and maximizes. Used on first open and by the menu "View → Reset Layout".
    /// The default widths of the side panels are in the UI (Panels.tsx: library 260, notes 320)
    /// </summary>
    internal static (Rect Rect, bool Maximize) DefaultOn(Display d, Size minDip)
    {
        var work = d.WorkDip;
        var min = MinSizeOn(d, minDip);
        var width = Math.Clamp(Math.Round(work.Width * 0.8), min.Width, Math.Max(min.Width, 1920));
        var height = Math.Clamp(Math.Round(work.Height * 0.85), min.Height, Math.Max(min.Height, 1200));
        double w = Math.Min(Math.Round(width * d.Scale), d.Work.Width), h = Math.Min(Math.Round(height * d.Scale), d.Work.Height);
        var rect = new Rect(Math.Round(d.Work.X + (d.Work.Width - w) / 2), Math.Round(d.Work.Y + (d.Work.Height - h) / 2), w, h);
        return (rect, minDip.Width > work.Width || minDip.Height > work.Height);
    }

    /// <summary>
    /// The window's minimum size on this screen (DIP): normally minDip; if the screen's work area is smaller than it (for example a 1200-wide portrait screen at 150% is only 800 DIP wide) the work area wins,
    /// otherwise maximize, full screen and the default layout would all extend off-screen
    /// </summary>
    internal static Size MinSizeOn(Display d, Size minDip) =>
        new(Math.Min(minDip.Width, Math.Floor(d.WorkDip.Width)), Math.Min(minDip.Height, Math.Floor(d.WorkDip.Height)));

    /// <summary>The window's minimum size follows the screen it is on (MinSizeOn): called after moving to another screen or changing the scaling</summary>
    public static void FitMinSize(Window w)
    {
        var hwnd = new WindowInteropHelper(w).Handle;
        if (hwnd == IntPtr.Zero || Displays.OfWindow(hwnd) is not { } d) return;
        var min = MinSizeOn(d, MinDip);
        if (w.MinWidth != min.Width) w.MinWidth = min.Width;
        if (w.MinHeight != min.Height) w.MinHeight = min.Height;
    }

    /// <summary>
    /// Places the window at r (physical pixels), then maximizes if asked. Move first, then set the size: moving to a screen with different scaling makes the system resize once proportionally (WM_DPICHANGED);
    /// the size is set in physical pixels only after that finishes and the window has taken that screen's scaling, which is how it ends up exactly r
    /// </summary>
    public static void Place(Window w, Rect r, bool maximize)
    {
        var hwnd = new WindowInteropHelper(w).Handle;
        if (hwnd == IntPtr.Zero) return;
        if (w.WindowState != WindowState.Normal) w.WindowState = WindowState.Normal;
        const uint keep = 0x0004 /* NOZORDER */ | 0x0010 /* NOACTIVATE */;
        int x = (int)Math.Round(r.X), y = (int)Math.Round(r.Y);
        SetWindowPos(hwnd, IntPtr.Zero, x, y, 0, 0, keep | 0x0001 /* NOSIZE */);
        FitMinSize(w);
        SetWindowPos(hwnd, IntPtr.Zero, x, y, (int)Math.Round(r.Width), (int)Math.Round(r.Height), keep);
        if (maximize) w.WindowState = WindowState.Maximized;
    }
}
