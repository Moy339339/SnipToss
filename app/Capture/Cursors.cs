using System.IO;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace SnipToss.App.Capture;

/// <summary>
/// Mouse cursors for the drawing tools on the capture overlay, looking the same as in the main app (packages/web/src/cursors.ts): once a drawing tool is picked, the cursor becomes its small icon.
/// A rounded pointer with the tool icon in a small white circle at the lower right, in the mark color; the Pin tool uses a pin, the same shape as the numbered dot it places.
/// The pointer tip / pin tip is the hot spot. Pixelate is the exception: a circle as large as the brush, with its center as the hot spot (<see cref="Brush"/>). Drawn at the display's scale, so it stays sharp on high-DPI screens
/// </summary>
static class ToolCursors
{
    const string Pointer = "M2 2 L14.6 7.2 Q15.6 7.7 14.6 8.2 L10.3 9.8 Q10 10 9.8 10.3 L8.2 14.6 Q7.7 15.6 7.2 14.6 Z";
    const string Pin = "M2 30 V21.5 A8.5 8.5 0 1 1 10.5 30 Z";
    static readonly Color Halo = Color.FromArgb(0x42, 0, 0, 0);
    static readonly Dictionary<(Tool, Color, int), Cursor> cache = [];
    static readonly Dictionary<(double, int), Cursor> brushes = [];

    /// <summary>Margin left outside the Pixelate circle (DIP, so the dark outline fits)</summary>
    const int BrushPad = 3;

    /// <param name="brush">The current brush width (DIP); the Pixelate circle is drawn at this size</param>
    public static Cursor? For(Tool tool, Color color, double scale, double brush)
    {
        if (tool == Tool.None) return null;
        if (tool == Tool.Mosaic) return Brush(brush, scale);
        var size = (int)Math.Round(32 * scale);
        if (cache.TryGetValue((tool, color, size), out var c)) return c;
        var visual = new DrawingVisual();
        using (var dc = visual.RenderOpen())
        {
            dc.PushTransform(new ScaleTransform(size / 32.0, size / 32.0));
            if (tool == Tool.Note) DrawPin(dc, color);
            else DrawPointer(dc, color, Glyph(tool));
            dc.Pop();
        }
        var rtb = new RenderTargetBitmap(size, size, 96, 96, PixelFormats.Pbgra32);
        rtb.Render(visual);
        var hot = tool == Tool.Note ? new Point(2, 30) : new Point(2, 2);
        c = Build(new FormatConvertedBitmap(rtb, PixelFormats.Bgra32, null, 0), (int)Math.Round(hot.X * size / 32.0), (int)Math.Round(hot.Y * size / 32.0));
        cache[(tool, color, size)] = c;
        return c;
    }

    /// <summary>
    /// Pixelate: a circle as large as the brush, with its center as the hot spot (an arrow would not show how wide the stroke will be).
    /// A white line with dark edges on both sides, visible on white, black and colored backgrounds; a small dot at the center keeps the hot spot findable with a thin brush.
    /// The thickest setting at 200% is 124 physical pixels across: WPF builds the cursor from the .cur at its original size instead of shrinking it to the system cursor size (a unit test reads the cursor back from the system to check)
    /// </summary>
    static Cursor Brush(double brush, double scale)
    {
        var center = Math.Round(brush / 2) + BrushPad;
        var half = (int)Math.Round(center * scale); // the side length is even, so the center falls on a whole pixel
        if (brushes.TryGetValue((brush, half), out var c)) return c;
        var visual = new DrawingVisual();
        using (var dc = visual.RenderOpen())
        {
            dc.PushTransform(new ScaleTransform(half / center, half / center));
            var at = new Point(center, center);
            var dark = new SolidColorBrush(Color.FromArgb(0x8c, 0, 0, 0));
            dc.DrawEllipse(null, new Pen(dark, 3), at, brush / 2, brush / 2);
            dc.DrawEllipse(null, new Pen(dark, 2.6), at, 1.2, 1.2);
            dc.DrawEllipse(null, new Pen(Brushes.White, 1.2), at, brush / 2, brush / 2);
            dc.DrawEllipse(Brushes.White, null, at, 1.2, 1.2);
            dc.Pop();
        }
        var rtb = new RenderTargetBitmap(half * 2, half * 2, 96, 96, PixelFormats.Pbgra32);
        rtb.Render(visual);
        c = Build(new FormatConvertedBitmap(rtb, PixelFormats.Bgra32, null, 0), half, half);
        brushes[(brush, half)] = c;
        return c;
    }

    static string[] Glyph(Tool tool) => tool switch
    {
        Tool.Rect => Icons.Rect,
        Tool.Ellipse => Icons.Ellipse,
        Tool.Arrow => Icons.Arrow,
        Tool.Pen => Icons.Pen,
        Tool.Text => Icons.Text,
        _ => [],
    };

    static void DrawPointer(DrawingContext dc, Color color, string[] glyph)
    {
        var shape = Geometry.Parse(Pointer);
        dc.DrawGeometry(null, new Pen(new SolidColorBrush(Halo), 3.6) { LineJoin = PenLineJoin.Round }, shape);
        dc.DrawGeometry(new SolidColorBrush(color), new Pen(Brushes.White, 1.6) { LineJoin = PenLineJoin.Round }, shape);
        dc.DrawEllipse(new SolidColorBrush(Halo), null, new Point(18.5, 18.5), 7.8, 7.8);
        dc.DrawEllipse(Brushes.White, null, new Point(18.5, 18.5), 7, 7);
        // The tool icon (16 units) is scaled to 0.6 to fit in the small circle
        dc.PushTransform(new MatrixTransform(0.6, 0, 0, 0.6, 13.7, 13.7));
        var ink = new SolidColorBrush(color);
        var pen = new Pen(ink, 2.4) { StartLineCap = PenLineCap.Round, EndLineCap = PenLineCap.Round, LineJoin = PenLineJoin.Round };
        foreach (var d in glyph)
        {
            if (d.StartsWith('F')) dc.DrawGeometry(ink, null, Geometry.Parse(d[1..]));
            else dc.DrawGeometry(null, pen, Geometry.Parse(d));
        }
        dc.Pop();
    }

    static void DrawPin(DrawingContext dc, Color color)
    {
        var shape = Geometry.Parse(Pin);
        dc.DrawGeometry(null, new Pen(new SolidColorBrush(Halo), 3.6) { LineJoin = PenLineJoin.Round }, shape);
        dc.DrawGeometry(new SolidColorBrush(color), new Pen(Brushes.White, 1.6) { LineJoin = PenLineJoin.Round }, shape);
        dc.DrawEllipse(Brushes.White, null, new Point(10.5, 21.5), 2.6, 2.6);
    }

    /// <summary>Bitmap → .cur (32-bit DIB + a fully transparent AND mask), handed to WPF's Cursor(Stream)</summary>
    static Cursor Build(BitmapSource bmp, int hotX, int hotY)
    {
        int w = bmp.PixelWidth, h = bmp.PixelHeight, stride = w * 4;
        var px = new byte[stride * h];
        bmp.CopyPixels(px, stride, 0);
        var maskStride = (w + 31) / 32 * 4;
        using var ms = new MemoryStream();
        using (var bw = new BinaryWriter(ms, System.Text.Encoding.ASCII, leaveOpen: true))
        {
            var imageSize = 40 + stride * h + maskStride * h;
            // ICONDIR: type 2 = cursor
            bw.Write((ushort)0);
            bw.Write((ushort)2);
            bw.Write((ushort)1);
            // ICONDIRENTRY: width and height (256 is written as 0), hot spot, data size and offset
            bw.Write((byte)(w >= 256 ? 0 : w));
            bw.Write((byte)(h >= 256 ? 0 : h));
            bw.Write((byte)0);
            bw.Write((byte)0);
            bw.Write((ushort)hotX);
            bw.Write((ushort)hotY);
            bw.Write(imageSize);
            bw.Write(22);
            // BITMAPINFOHEADER: the height is written doubled (color + mask)
            bw.Write(40);
            bw.Write(w);
            bw.Write(h * 2);
            bw.Write((ushort)1);
            bw.Write((ushort)32);
            bw.Write(0);
            bw.Write(stride * h + maskStride * h);
            bw.Write(0);
            bw.Write(0);
            bw.Write(0);
            bw.Write(0);
            // Pixels run bottom to top
            for (var y = h - 1; y >= 0; y--) bw.Write(px, y * stride, stride);
            bw.Write(new byte[maskStride * h]);
        }
        ms.Position = 0;
        return new Cursor(ms);
    }
}
