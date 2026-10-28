using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using SnipToss.App.Capture;

namespace AppTests;

/// <summary>
/// Mouse cursors of the capture overlay's drawing tools (app/Capture/Cursors.cs). The Pixelate cursor is a circle as large as
/// the brush: the built cursor is read back from the system to check that Windows neither shrank it to the system cursor size
/// nor clipped it (124 physical pixels for the thickest brush at 200%)
/// </summary>
public class ToolCursorTests
{
    [Theory]
    [InlineData(20, 1.0, 26)]
    [InlineData(32, 1.0, 38)]
    [InlineData(56, 1.0, 62)]
    [InlineData(32, 1.5, 56)]
    [InlineData(56, 2.0, 124)]
    [InlineData(56, 3.0, 186)]
    [InlineData(56, 5.0, 310)]
    public void Pixelate_cursor_is_a_circle_as_large_as_the_brush_with_its_hotspot_at_the_center_and_keeps_its_size(double brush, double scale, int size)
    {
        CaptureTests.OnSta(() =>
        {
            var (w, h, hotX, hotY, px) = Read(ToolCursors.For(Tool.Mosaic, Colors.OrangeRed, scale, brush)!);
            Assert.Equal((size, size), (w, h));
            Assert.Equal((size / 2, size / 2), (hotX, hotY));
            int Alpha(int x, int y) => px[(y * w + x) * 4 + 3];
            var c = size / 2;
            var r = (int)Math.Round(brush / 2 * scale);
            // The circle has a line (white, outlined in a dark edge); inside the circle and in the four corners it is transparent
            // so what is being pixelated shows through; the center has a white dot
            Assert.True(Alpha(c + r, c) > 128 && Alpha(c, c - r) > 128, "The circle should have a line");
            Assert.Equal(0, Alpha(c + r / 2, c));
            Assert.Equal(0, Alpha(0, 0));
            Assert.True(Alpha(c, c) > 200 && px[(c * w + c) * 4 + 2] > 150, "The center should have a white dot");
            Dump($"mosaic-cursor-{brush}-{scale * 100}.png", w, h, px);
        });
    }

    [Fact]
    public void Other_tools_keep_an_arrow_with_a_small_icon_regardless_of_brush_size()
    {
        CaptureTests.OnSta(() =>
        {
            var (w, h, hotX, hotY, _) = Read(ToolCursors.For(Tool.Rect, Colors.OrangeRed, 2, 56)!);
            Assert.Equal((64, 64, 4, 4), (w, h, hotX, hotY));
            var pin = Read(ToolCursors.For(Tool.Note, Colors.OrangeRed, 1, 56)!);
            Assert.Equal((32, 32, 2, 30), (pin.W, pin.H, pin.HotX, pin.HotY));
        });
    }

    [Fact]
    public void Cursors_are_cached_per_tool_color_and_scale_and_None_has_no_cursor()
    {
        CaptureTests.OnSta(() =>
        {
            // The same tool, color and scale is built once and handed out again
            var rect = ToolCursors.For(Tool.Rect, Colors.OrangeRed, 1, 20);
            Assert.NotNull(rect);
            Assert.Same(rect, ToolCursors.For(Tool.Rect, Colors.OrangeRed, 1, 20));
            // The brush width only matters for Pixelate: the other tools keep their cursor when it changes
            Assert.Same(rect, ToolCursors.For(Tool.Rect, Colors.OrangeRed, 1, 56));
            // A different color, scale or tool gives a new cursor
            Assert.NotSame(rect, ToolCursors.For(Tool.Rect, Colors.DodgerBlue, 1, 20));
            Assert.NotSame(rect, ToolCursors.For(Tool.Rect, Colors.OrangeRed, 1.5, 20));
            Assert.NotSame(rect, ToolCursors.For(Tool.Ellipse, Colors.OrangeRed, 1, 20));
            // The pin is cached the same way
            var pin = ToolCursors.For(Tool.Note, Colors.OrangeRed, 1, 20);
            Assert.Same(pin, ToolCursors.For(Tool.Note, Colors.OrangeRed, 1, 20));
            Assert.NotSame(pin, ToolCursors.For(Tool.Note, Colors.OrangeRed, 2, 20));

            // Pixelate has one cursor per brush width and scale (the color does not matter)
            foreach (var width in new[] { 20.0, 32.0, 56.0 })
            {
                var mosaic = ToolCursors.For(Tool.Mosaic, Colors.OrangeRed, 1, width);
                Assert.NotNull(mosaic);
                Assert.Same(mosaic, ToolCursors.For(Tool.Mosaic, Colors.OrangeRed, 1, width));
                Assert.Same(mosaic, ToolCursors.For(Tool.Mosaic, Colors.DodgerBlue, 1, width));
                Assert.NotSame(mosaic, ToolCursors.For(Tool.Mosaic, Colors.OrangeRed, 2, width));
            }
            Assert.NotSame(ToolCursors.For(Tool.Mosaic, Colors.OrangeRed, 1, 20), ToolCursors.For(Tool.Mosaic, Colors.OrangeRed, 1, 32));
            Assert.NotSame(ToolCursors.For(Tool.Mosaic, Colors.OrangeRed, 1, 32), ToolCursors.For(Tool.Mosaic, Colors.OrangeRed, 1, 56));

            // With no tool picked, the default cursor stays
            Assert.Null(ToolCursors.For(Tool.None, Colors.OrangeRed, 1, 20));
        });
    }

    /// <summary>Reads the cursor back from the system: size, hotspot, pixels (BGRA, top to bottom)</summary>
    static (int W, int H, int HotX, int HotY, byte[] Px) Read(Cursor cursor)
    {
        var handle = (SafeHandle)typeof(Cursor).GetProperty("Handle", BindingFlags.NonPublic | BindingFlags.Instance)!.GetValue(cursor)!;
        Assert.True(GetIconInfo(handle.DangerousGetHandle(), out var info));
        try
        {
            Assert.NotEqual(0, GetObject(info.HbmColor, Marshal.SizeOf<GdiBitmap>(), out var bmp));
            var header = new BitmapInfoHeader { Size = Marshal.SizeOf<BitmapInfoHeader>(), Width = bmp.Width, Height = -bmp.Height, Planes = 1, BitCount = 32 };
            var px = new byte[bmp.Width * bmp.Height * 4];
            var dc = GetDC(IntPtr.Zero);
            try
            {
                Assert.Equal(bmp.Height, GetDIBits(dc, info.HbmColor, 0, (uint)bmp.Height, px, ref header, 0));
            }
            finally
            {
                _ = ReleaseDC(IntPtr.Zero, dc);
            }
            return (bmp.Width, bmp.Height, info.XHotspot, info.YHotspot, px);
        }
        finally
        {
            DeleteObject(info.HbmColor);
            DeleteObject(info.HbmMask);
        }
    }

    /// <summary>
    /// When SNIPTOSS_TEST_DUMP is set, saves the cursor composited over white, black and colored backgrounds
    /// so it can be checked at a glance on each
    /// </summary>
    static void Dump(string name, int w, int h, byte[] px)
    {
        var dir = Environment.GetEnvironmentVariable("SNIPTOSS_TEST_DUMP");
        if (string.IsNullOrEmpty(dir)) return;
        byte[][] grounds = [[255, 255, 255], [0, 0, 0], [60, 140, 230], [120, 200, 120]];
        var outW = w * grounds.Length;
        var o = new byte[outW * h * 4];
        for (var g = 0; g < grounds.Length; g++)
            for (var y = 0; y < h; y++)
                for (var x = 0; x < w; x++)
                {
                    int s = (y * w + x) * 4, d = (y * outW + g * w + x) * 4;
                    var a = px[s + 3] / 255.0;
                    for (var k = 0; k < 3; k++) o[d + k] = (byte)Math.Round(px[s + k] * a + grounds[g][k] * (1 - a));
                    o[d + 3] = 255;
                }
        var encoder = new PngBitmapEncoder();
        encoder.Frames.Add(BitmapFrame.Create(BitmapSource.Create(outW, h, 96, 96, PixelFormats.Bgra32, null, o, outW * 4)));
        using var file = File.Create(Path.Combine(dir, name));
        encoder.Save(file);
    }

    [StructLayout(LayoutKind.Sequential)]
    struct IconInfo
    {
        public int FIcon;
        public int XHotspot;
        public int YHotspot;
        public IntPtr HbmMask;
        public IntPtr HbmColor;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct GdiBitmap
    {
        public int Type;
        public int Width;
        public int Height;
        public int WidthBytes;
        public short Planes;
        public short BitsPixel;
        public IntPtr Bits;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct BitmapInfoHeader
    {
        public int Size;
        public int Width;
        public int Height;
        public short Planes;
        public short BitCount;
        public int Compression;
        public int SizeImage;
        public int XPelsPerMeter;
        public int YPelsPerMeter;
        public int ClrUsed;
        public int ClrImportant;
    }

    [DllImport("user32.dll")]
    static extern bool GetIconInfo(IntPtr icon, out IconInfo info);

    [DllImport("user32.dll")]
    static extern IntPtr GetDC(IntPtr hwnd);

    [DllImport("user32.dll")]
    static extern int ReleaseDC(IntPtr hwnd, IntPtr dc);

    [DllImport("gdi32.dll")]
    static extern int GetObject(IntPtr obj, int size, out GdiBitmap bmp);

    [DllImport("gdi32.dll")]
    static extern int GetDIBits(IntPtr dc, IntPtr bmp, uint start, uint lines, byte[] bits, ref BitmapInfoHeader info, uint usage);

    [DllImport("gdi32.dll")]
    static extern bool DeleteObject(IntPtr obj);
}
