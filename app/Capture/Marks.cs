using System.Globalization;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace SnipToss.App.Capture;

/// <summary>Tools on the screenshot. Note = place a numbered dot and write a note (the main app's Pin tool)</summary>
enum Tool
{
    None,
    Rect,
    Ellipse,
    Arrow,
    Pen,
    Mosaic,
    Text,
    Note,
}

/// <summary>One thing drawn on the screenshot. Coordinates are DIPs in the overlay window (multiplied by the scale when composited into the image)</summary>
sealed class Mark
{
    public Tool Kind;
    public Color Color;
    /// <summary>Line width; for text, the font size; for Pixelate, the brush width</summary>
    public double Size;
    /// <summary>Rectangle / ellipse / arrow: start and end points; pen / Pixelate: a series of points; text / numbered dot: one point (the text's top-left corner)</summary>
    public List<Point> Points = [];
    /// <summary>The text the Text tool writes on the image</summary>
    public string Text = "";
    /// <summary>The note for the AI; only a mark with one gets a number</summary>
    public string Note = "";
    /// <summary>The note's category (change / remove / add / question), same as the main app's notes</summary>
    public string Category = "change";
    public int Number;
    /// <summary>The number shown while its note is being written (not saved yet): while writing you can see what is being marked, and the numbered dot especially needs it, or clicking would show nothing</summary>
    public int PendingNumber;

    /// <summary>
    /// When one note marks several places, the places marked afterwards point to the first one (the note's text, category and number are kept on the first place, docs/adr/0009-several-places.md).
    /// It is null for the first place and for marks without a note. A later place is always ordered after the first
    /// </summary>
    public Mark? Lead;

    /// <summary>Which note this place belongs to: a later place belongs to the first, any other to itself</summary>
    public Mark Head => Lead ?? this;

    public bool HasNote => Number > 0;

    /// <summary>The order in which it was added to the screenshot (assigned by the state machine): undo compares it with color changes to see which is later</summary>
    public int Seq;

    public Rect Bounds
    {
        get
        {
            if (Points.Count == 0) return Rect.Empty;
            var r = new Rect(Points[0], Points[0]);
            foreach (var p in Points) r.Union(p);
            return r;
        }
    }

    /// <summary>Too small to count (an accidental click)</summary>
    public bool IsTiny => Kind switch
    {
        Tool.Rect or Tool.Ellipse => Bounds.Width < 4 || Bounds.Height < 4,
        Tool.Arrow => (Points[^1] - Points[0]).Length < 8,
        Tool.Pen or Tool.Mosaic => Points.Count < 2,
        Tool.Text => Text.Trim().Length == 0,
        _ => false,
    };

    /// <summary>
    /// Whether the point is on this mark (a hit selects it so its color can change): lines use half the thickness plus 4, the arrowhead is handled separately, text uses the text's extent.
    /// Pixelate has no color and does not count; a numbered dot only counts on its number circle (the state machine uses <see cref="MarkPainter.BadgeCenter"/>, which clamps it into the selection)
    /// </summary>
    public bool Hits(Point p)
    {
        var tolerance = Size / 2 + 4;
        switch (Kind)
        {
            case Tool.Rect:
                var outer = Bounds;
                outer.Inflate(tolerance, tolerance);
                var inner = Bounds;
                inner.Inflate(-tolerance, -tolerance); // empty when the rectangle is too small: the whole rectangle counts
                return outer.Contains(p) && !inner.Contains(p);
            case Tool.Ellipse:
                return EllipseDistance(Bounds, p) <= tolerance;
            case Tool.Arrow:
                // The head is at most twice the line width plus 5 wide (MarkPainter.DrawArrow)
                return SegmentDistance(p, Points[0], Points[^1]) <= tolerance || (p - Points[^1]).Length <= 2 * Size + 9;
            case Tool.Pen:
                if (Points.Count == 1) return (p - Points[0]).Length <= tolerance;
                for (var i = 1; i < Points.Count; i++)
                    if (SegmentDistance(p, Points[i - 1], Points[i]) <= tolerance) return true;
                return false;
            case Tool.Text:
                var text = MarkPainter.TextBounds(this);
                text.Inflate(2, 2);
                return text.Contains(p);
            default:
                return false;
        }
    }

    static double SegmentDistance(Point p, Point a, Point b)
    {
        var ab = b - a;
        var t = ab.LengthSquared < 1e-9 ? 0 : Math.Clamp(Vector.Multiply(p - a, ab) / ab.LengthSquared, 0, 1);
        return (p - (a + ab * t)).Length;
    }

    /// <summary>Distance from a point to the ellipse outline (first-order approximation: |f| / |∇f|, exact for a circle)</summary>
    static double EllipseDistance(Rect b, Point p)
    {
        double rx = Math.Max(b.Width / 2, 1), ry = Math.Max(b.Height / 2, 1);
        double dx = p.X - (b.X + b.Width / 2), dy = p.Y - (b.Y + b.Height / 2);
        var r = Math.Sqrt(dx * dx / (rx * rx) + dy * dy / (ry * ry));
        if (r < 1e-9) return Math.Min(rx, ry);
        var grad = Math.Sqrt(dx * dx / (rx * rx * rx * rx) + dy * dy / (ry * ry * ry * ry)) / r;
        return Math.Abs(r - 1) / grad;
    }

    /// <summary>Where the number is drawn: top-left corner for a rectangle or ellipse, the tail for an arrow, the starting point for a pen stroke, and the dot itself for a numbered dot</summary>
    public Point BadgeAt => Kind switch
    {
        Tool.Rect or Tool.Ellipse => Bounds.TopLeft,
        _ => Points[0],
    };

    /// <summary>
    /// How its position is described in the text given to the AI, the same scheme as the main app (ShapeText): sel = the selection (DIPs; it is the screenshot), size = the screenshot's size in physical pixels.
    /// A rectangle or ellipse is described by its bounding region, a pen stroke or Pixelate by its bounding box, and text or a numbered dot by that point
    /// </summary>
    public string Where(Rect sel, (int Width, int Height) size)
    {
        (double X, double Y) N(Point p) => ((p.X - sel.X) / sel.Width, (p.Y - sel.Y) / sel.Height);
        ShapeText.Shape shape;
        switch (Kind)
        {
            case Tool.Rect or Tool.Ellipse:
                var (x, y) = N(Bounds.TopLeft);
                shape = new ShapeText.Region(x, y, Bounds.Width / sel.Width, Bounds.Height / sel.Height);
                break;
            case Tool.Pen or Tool.Mosaic:
                shape = new ShapeText.Path(Points.Select(N).ToList());
                break;
            case Tool.Arrow:
                var (fx, fy) = N(Points[0]);
                var (tx, ty) = N(Points[^1]);
                shape = new ShapeText.Arrow(fx, fy, tx, ty);
                break;
            default:
                var (px, py) = N(Points[0]);
                shape = new ShapeText.Spot(px, py);
                break;
        }
        return ShapeText.Describe(shape, size);
    }

    /// <summary>
    /// How the places this note marks (itself + the ones marked after it, in drawing order) are described: one place is the same as <see cref="Where"/>, several read "3 places — Region: …; Point: …" (the message is the main app's ai.where.many).
    /// When the places differ in color, each one is prefixed with its color, "(Yellow) Point: …": users change colors so that the note can say which place gets which change
    /// </summary>
    public string WhereAll(IEnumerable<Mark> all, Rect sel, (int Width, int Height) size)
    {
        var places = all.Where(x => x.Head == this).ToList();
        if (places.Count <= 1) return Where(sel, size);
        var colored = places.Select(p => p.Color).Distinct().Count() > 1;
        var list = string.Join(
            Locale.T("ai.where.manySeparator"),
            places.Select(p => colored ? Locale.T("ai.where.colored", ("color", ToolPrefs.Name(p.Color)), ("where", p.Where(sel, size))) : p.Where(sel, size)));
        return Locale.T("ai.where.many", ("count", places.Count), ("list", list));
    }
}

/// <summary>The four note categories; names and colors match the main app (CATEGORY_LABEL in core, --cat-* in styles.css)</summary>
static class Categories
{
    public static readonly string[] Keys = ["change", "remove", "add", "question"];

    /// <summary>The category name (messages category.*, following the UI language); an unknown key is treated as Change</summary>
    public static string Label(string key) => Locale.T("category." + Valid(key));

    public static Color Color(string key) => key switch
    {
        "remove" => System.Windows.Media.Color.FromRgb(0xff, 0x90, 0x90),
        "add" => System.Windows.Media.Color.FromRgb(0x6f, 0xdc, 0x9f),
        "question" => System.Windows.Media.Color.FromRgb(0xff, 0xc8, 0x61),
        _ => System.Windows.Media.Color.FromRgb(0xb3, 0x9d, 0xff), // --cat-change (purple: blue is kept for interaction)
    };

    public static string Valid(string? key) => Keys.Contains(key) ? key! : "change";
}

/// <summary>
/// Draws the marks. The live display on the overlay and the final composited image use the same code, so what you see is what gets copied
/// </summary>
static class MarkPainter
{
    /// <summary>The font for text on the overlay and in the composited image: same as the shell's other native UI, with CJK fonts following the UI language (UiFonts)</summary>
    public static FontFamily Font => UiFonts.Current;

    /// <param name="pixelated">The pixelated version of the whole display (DIP size = <paramref name="monitor"/>)</param>
    /// <param name="keepInside">The number must not be drawn outside this range (the screenshot's selection), or compositing would crop it in half</param>
    /// <param name="zoom">How many times the screenshot was enlarged when compositing (a small selection): positions scale with it, while line width, text and the number circle are scaled back by it, so they keep their usual size</param>
    public static void Draw(DrawingContext dc, Mark m, ImageSource? pixelated, Rect monitor, Rect keepInside, double pixelsPerDip, double zoom = 1)
    {
        var brush = Frozen(new SolidColorBrush(m.Color));
        var pen = new Pen(brush, m.Size / zoom) { StartLineCap = PenLineCap.Round, EndLineCap = PenLineCap.Round, LineJoin = PenLineJoin.Round };
        pen.Freeze();
        switch (m.Kind)
        {
            case Tool.Rect:
                dc.DrawRectangle(null, pen, m.Bounds);
                break;
            case Tool.Ellipse:
                var b = m.Bounds;
                dc.DrawEllipse(null, pen, new Point(b.X + b.Width / 2, b.Y + b.Height / 2), b.Width / 2, b.Height / 2);
                break;
            case Tool.Arrow:
                DrawArrow(dc, brush, m.Points[0], m.Points[^1], m.Size / zoom);
                break;
            case Tool.Pen:
                dc.DrawGeometry(null, pen, Polyline(m.Points));
                break;
            case Tool.Mosaic:
                if (pixelated is null || m.Points.Count == 0) break;
                // A pen or Pixelate stroke with a single point counts as an accidental click and is dropped (IsTiny), so there are always two or more points here
                var stroke = new Pen(Brushes.Black, m.Size) { StartLineCap = PenLineCap.Round, EndLineCap = PenLineCap.Round, LineJoin = PenLineJoin.Round };
                dc.PushClip(Polyline(m.Points).GetWidenedPathGeometry(stroke));
                dc.DrawImage(pixelated, monitor);
                dc.Pop();
                break;
            case Tool.Text:
                if (m.Points.Count > 0) dc.DrawText(Text(m.Text, m.Size / zoom, brush, pixelsPerDip), m.Points[0]);
                break;
        }
        // Places marked afterwards draw the first place's number (one note, one number)
        var number = m.Head.HasNote ? m.Head.Number : m.Head.PendingNumber;
        if (number > 0) DrawBadge(dc, number, m.Color, BadgeCenter(m, keepInside), pixelsPerDip, 10 / zoom);
    }

    /// <summary>
    /// The center of the number circle: the mark's number position, clamped into the selection (at least 10 from the edge, or compositing would crop it in half).
    /// Drawing and hit-testing both use it: hit-testing used to use the unclamped position, so for a rectangle right in the selection's corner the number was drawn 10 inside yet could not be clicked
    /// </summary>
    public static Point BadgeCenter(Mark m, Rect keepInside) => Clamp(m.BadgeAt, keepInside, 10);

    /// <summary>The number: a solid circle with white text, looking the same as the numbers on the main app's canvas</summary>
    public static void DrawBadge(DrawingContext dc, int number, Color color, Point center, double pixelsPerDip, double radius = 10)
    {
        var fill = Frozen(new SolidColorBrush(color));
        // The white ring scales with the circle (when the screenshot is enlarged for compositing the circle is scaled back; a ring that did not shrink would become a thick white band)
        var ring = new Pen(Frozen(new SolidColorBrush(Color.FromArgb(0xcc, 0xff, 0xff, 0xff))), 1.5 * radius / 10);
        ring.Freeze();
        dc.DrawEllipse(fill, ring, center, radius, radius);
        var text = Text(number.ToString(CultureInfo.InvariantCulture), radius * 1.2, Brushes.White, pixelsPerDip, bold: true);
        dc.DrawText(text, new Point(center.X - text.Width / 2, center.Y - text.Height / 2));
    }

    /// <summary>The area a text mark covers (drawn at Points[0], the top-left corner)</summary>
    public static Rect TextBounds(Mark m)
    {
        var t = Text(m.Text, m.Size, Brushes.White, 1);
        return new Rect(m.Points[0], new Size(t.WidthIncludingTrailingWhitespace, t.Height));
    }

    public static FormattedText Text(string s, double size, Brush brush, double pixelsPerDip, bool bold = false) =>
        new(s, CultureInfo.CurrentUICulture, FlowDirection.LeftToRight,
            new Typeface(Font, FontStyles.Normal, bold ? FontWeights.SemiBold : FontWeights.Normal, FontStretches.Normal), size, brush, pixelsPerDip);

    static void DrawArrow(DrawingContext dc, Brush brush, Point from, Point to, double width)
    {
        var v = to - from;
        var len = v.Length;
        if (len < 1) return;
        v /= len;
        var normal = new Vector(-v.Y, v.X);
        // The arrowhead grows with the line width, and shrinks for a very short arrow
        var headLen = Math.Min(len * 0.6, 4 * width + 10);
        var headHalf = headLen * 0.5;
        var neck = to - v * headLen;
        var pen = new Pen(brush, width) { StartLineCap = PenLineCap.Round, EndLineCap = PenLineCap.Flat };
        pen.Freeze();
        dc.DrawLine(pen, from, neck + v * 1); // extends 1 into the head so no seam shows at the joint
        var head = new StreamGeometry();
        using (var g = head.Open())
        {
            g.BeginFigure(to, true, true);
            g.LineTo(neck + normal * headHalf, true, true);
            g.LineTo(neck - normal * headHalf, true, true);
        }
        head.Freeze();
        var join = new Pen(brush, 1) { LineJoin = PenLineJoin.Round };
        join.Freeze();
        dc.DrawGeometry(brush, join, head);
    }

    public static StreamGeometry Polyline(IReadOnlyList<Point> points)
    {
        var g = new StreamGeometry();
        using (var c = g.Open())
        {
            c.BeginFigure(points[0], false, false);
            if (points.Count == 1) c.LineTo(points[0] + new Vector(0.01, 0), true, true);
            for (var i = 1; i < points.Count; i++) c.LineTo(points[i], true, true);
        }
        g.Freeze();
        return g;
    }

    /// <summary>How wide one Pixelate block is (DIP): measured as seen on screen, so at 150% a block is 18 physical pixels and at 200% it is 24</summary>
    public const int MosaicBlock = 12;

    /// <summary>
    /// The pixelated version of the whole display: each block of <see cref="MosaicBlock"/> × scale physical pixels is filled with its average color (block by block, like a typical mosaic).
    /// It used to be fixed at 12 physical pixels: at 200% a block was only 6 on screen, and pixelated email addresses and phone numbers were still legible.
    /// Computed by hand instead of WPF scaling: RenderTargetBitmap does not do nearest-neighbor, so scaling back up gives a blur instead of blocks
    /// </summary>
    /// <param name="scale">This display's scale (physical pixels / DIP)</param>
    public static ImageSource Pixelate(BitmapSource shot, double scale)
    {
        var block = Math.Max(1, (int)Math.Round(MosaicBlock * scale));
        int w = shot.PixelWidth, h = shot.PixelHeight, stride = w * 4;
        var px = new byte[stride * h];
        shot.CopyPixels(px, stride, 0);
        for (var by = 0; by < h; by += block)
            for (var bx = 0; bx < w; bx += block)
            {
                int bw = Math.Min(block, w - bx), bh = Math.Min(block, h - by);
                long b = 0, g = 0, r = 0;
                for (var y = by; y < by + bh; y++)
                    for (int i = y * stride + bx * 4, end = i + bw * 4; i < end; i += 4)
                    {
                        b += px[i];
                        g += px[i + 1];
                        r += px[i + 2];
                    }
                var n = bw * bh;
                byte ab = (byte)(b / n), ag = (byte)(g / n), ar = (byte)(r / n);
                for (var y = by; y < by + bh; y++)
                    for (int i = y * stride + bx * 4, end = i + bw * 4; i < end; i += 4)
                    {
                        px[i] = ab;
                        px[i + 1] = ag;
                        px[i + 2] = ar;
                        px[i + 3] = 255;
                    }
            }
        var result = BitmapSource.Create(w, h, 96, 96, PixelFormats.Bgra32, null, px, stride);
        result.Freeze();
        return result;
    }

    static Point Clamp(Point p, Rect r, double margin) =>
        r.IsEmpty ? p : new(Math.Clamp(p.X, r.Left + margin, Math.Max(r.Left + margin, r.Right - margin)), Math.Clamp(p.Y, r.Top + margin, Math.Max(r.Top + margin, r.Bottom - margin)));

    static T Frozen<T>(T f) where T : Freezable
    {
        f.Freeze();
        return f;
    }
}
