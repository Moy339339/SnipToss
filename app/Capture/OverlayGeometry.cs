using System.Windows;

namespace SnipToss.App.Capture;

/// <summary>
/// Geometry of the capture overlay (split out of CaptureOverlay as pure functions that xUnit can test): selection handles, which handle is under the pointer, resizing,
/// snapping to physical pixels, nudging the selection, Shift-drawn squares, and where the toolbar and note box go.
/// All coordinates are DIPs in the overlay window; scale = this display's scale (physical pixels / DIP); full = the bounds of this display (the overlay window)
/// </summary>
static class OverlayGeometry
{
    /// <summary>The 8 handles: 0 top-left, 1 top-middle, 2 top-right, 3 right-middle, 4 bottom-right, 5 bottom-middle, 6 bottom-left, 7 left-middle</summary>
    public static Point[] HandlePoints(Rect r) =>
    [
        r.TopLeft, new(r.X + r.Width / 2, r.Top), r.TopRight, new(r.Right, r.Y + r.Height / 2),
        r.BottomRight, new(r.X + r.Width / 2, r.Bottom), r.BottomLeft, new(r.Left, r.Y + r.Height / 2),
    ];

    /// <summary>Which handle the pointer is on: within 6 of a handle square; within 4 of an edge (not just its small middle square) also grabs, counting as that edge's middle handle. Returns -1 for neither</summary>
    public static int HitHandle(Rect sel, Point p)
    {
        var pts = HandlePoints(sel);
        for (var i = 0; i < 8; i++)
            if (Math.Abs(p.X - pts[i].X) <= 6 && Math.Abs(p.Y - pts[i].Y) <= 6) return i;
        const double edge = 4;
        var inX = p.X >= sel.Left && p.X <= sel.Right;
        var inY = p.Y >= sel.Top && p.Y <= sel.Bottom;
        if (inX && Math.Abs(p.Y - sel.Top) <= edge) return 1;
        if (inX && Math.Abs(p.Y - sel.Bottom) <= edge) return 5;
        if (inY && Math.Abs(p.X - sel.Left) <= edge) return 7;
        if (inY && Math.Abs(p.X - sel.Right) <= edge) return 3;
        return -1;
    }

    /// <summary>Drag handle h to p: dragging past the opposite side flips the rectangle (it is built from two corners)</summary>
    public static Rect Resized(Rect r, int h, Point p)
    {
        double l = r.Left, t = r.Top, rt = r.Right, b = r.Bottom;
        if (h is 0 or 6 or 7) l = p.X;
        if (h is 2 or 3 or 4) rt = p.X;
        if (h is 0 or 1 or 2) t = p.Y;
        if (h is 4 or 5 or 6) b = p.Y;
        return new Rect(new Point(l, t), new Point(rt, b));
    }

    /// <summary>Snap to physical pixels: the captured image has crisp edges and the pixel readout is an integer</summary>
    public static Point Snap(Point p, double scale) => new(Math.Round(p.X * scale) / scale, Math.Round(p.Y * scale) / scale);

    public static Point Clamp(Point p, Rect full) => new(Math.Clamp(p.X, full.Left, full.Right), Math.Clamp(p.Y, full.Top, full.Bottom));

    /// <summary>Arrow keys nudge the selection: dx, dy are physical pixels (1 pixel on a 150% display is 2/3 DIP), and the whole selection stays on the screen</summary>
    public static Rect Nudge(Rect sel, double dx, double dy, double scale, Rect full)
    {
        sel.X = Math.Clamp(sel.X + dx / scale, full.Left, full.Right - sel.Width);
        sel.Y = Math.Clamp(sel.Y + dy / scale, full.Top, full.Bottom - sel.Height);
        return sel;
    }

    /// <summary>
    /// Shift held while drawing a rectangle or ellipse: draws a square from the start o toward p, with the side taken from the longer of the two sides, but never past the selection.
    /// Otherwise, with the start near the selection edge, the opposite corner lands outside it and the "width × height" given to the AI is larger than the image
    /// </summary>
    public static Point SquareCorner(Point o, Point p, Rect sel)
    {
        var dx = p.X >= o.X ? 1 : -1;
        var dy = p.Y >= o.Y ? 1 : -1;
        var side = Math.Max(Math.Abs(p.X - o.X), Math.Abs(p.Y - o.Y));
        var roomX = dx > 0 ? sel.Right - o.X : o.X - sel.Left;
        var roomY = dy > 0 ? sel.Bottom - o.Y : o.Y - sel.Top;
        side = Math.Max(0, Math.Min(side, Math.Min(roomX, roomY)));
        return new Point(o.X + dx * side, o.Y + dy * side);
    }

    /// <summary>
    /// Where the toolbar goes: right-aligned below the selection; above it if there is no room below; inside the selection at the bottom if neither fits.
    /// The sub-toolbar (color, thickness) sits on the outer side of the toolbar and is absent when subbar's height is 0. At least 4 from the screen edge
    /// </summary>
    public static (Point Toolbar, Point Subbar) ToolbarAt(Rect sel, Size toolbar, Size subbar, Rect full)
    {
        var need = toolbar.Height + (subbar.Height > 0 ? subbar.Height + 6 : 0);
        var x = Math.Clamp(sel.Right - toolbar.Width, full.Left + 4, Math.Max(full.Left + 4, full.Right - 4 - toolbar.Width));
        double y;
        var below = false;
        if (sel.Bottom + 8 + need <= full.Bottom - 4)
        {
            y = sel.Bottom + 8;
            below = true;
        }
        else if (sel.Top - 8 - need >= full.Top + 4) y = sel.Top - 8 - toolbar.Height;
        else y = sel.Bottom - 8 - toolbar.Height;
        var sx = Math.Clamp(x, full.Left + 4, Math.Max(full.Left + 4, full.Right - 4 - subbar.Width));
        return (new Point(x, y), new Point(sx, below ? y + toolbar.Height + 6 : y - 6 - subbar.Height));
    }

    /// <summary>Where the note box goes: first to the right of anchor (the mark grown by a margin, or the toolbar), else to its left, else below (above if that does not fit either); at least 8 from the screen edge</summary>
    public static Point NoteAt(Rect anchor, Size size, Rect full)
    {
        var x = anchor.Right + 8;
        if (x + size.Width > full.Right - 8) x = anchor.Left - 8 - size.Width;
        var y = anchor.Top;
        if (x < full.Left + 8)
        {
            x = Math.Clamp(anchor.Left, full.Left + 8, full.Right - 8 - size.Width);
            y = anchor.Bottom + 8;
            if (y + size.Height > full.Bottom - 8) y = anchor.Top - 8 - size.Height;
        }
        return new Point(x, Math.Clamp(y, full.Top + 8, full.Bottom - 8 - size.Height));
    }
}
