using System.Globalization;
using System.Windows.Media;

namespace SnipToss.App.Capture;

/// <summary>
/// Color helpers shared by the capture overlay, the color picker and the composited image: #rrggbb text, HSV for the picker,
/// and which colors are too light for white text (the same rule as isLightMark in packages/core, checked against the same samples in tests)
/// </summary>
static class ColorMath
{
    /// <summary>"#rrggbb" (lowercase, the form stored in settings and notes files)</summary>
    public static string Hex(Color c) => $"#{c.R:x2}{c.G:x2}{c.B:x2}";

    /// <summary>"#rrggbb" or "rrggbb" (either case, surrounding spaces ignored); null for anything else</summary>
    public static Color? Parse(string? s)
    {
        var t = s?.Trim().TrimStart('#') ?? "";
        if (t.Length != 6 || !int.TryParse(t, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var v)) return null;
        return Color.FromRgb((byte)(v >> 16), (byte)(v >> 8), (byte)v);
    }

    /// <summary>
    /// Light enough that white text on it cannot be read (white, very pale custom colors): numbers drawn on it use dark text.
    /// The test is OKLab lightness above 0.9, so the preset yellow (about 0.85) keeps its white number
    /// </summary>
    public static bool IsLight(Color c) => OkLightness(c) > 0.9;

    /// <summary>The dark text used on light marks (the window background color of the app)</summary>
    public static readonly Color DarkInk = Color.FromRgb(0x14, 0x14, 0x16);

    /// <summary>OKLab lightness L (0–1) of an sRGB color</summary>
    public static double OkLightness(Color c)
    {
        static double Lin(byte v)
        {
            var x = v / 255.0;
            return x <= 0.04045 ? x / 12.92 : Math.Pow((x + 0.055) / 1.055, 2.4);
        }
        double r = Lin(c.R), g = Lin(c.G), b = Lin(c.B);
        var l = Math.Cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
        var m = Math.Cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
        var s = Math.Cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
        return 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
    }

    /// <summary>Hue 0–360, saturation and value 0–1</summary>
    public static (double H, double S, double V) ToHsv(Color c)
    {
        double r = c.R / 255.0, g = c.G / 255.0, b = c.B / 255.0;
        var max = Math.Max(r, Math.Max(g, b));
        var min = Math.Min(r, Math.Min(g, b));
        var d = max - min;
        double h = 0;
        if (d > 0)
        {
            if (max == r) h = 60 * ((g - b) / d % 6);
            else if (max == g) h = 60 * ((b - r) / d + 2);
            else h = 60 * ((r - g) / d + 4);
        }
        if (h < 0) h += 360;
        return (h, max == 0 ? 0 : d / max, max);
    }

    public static Color FromHsv(double h, double s, double v)
    {
        h = ((h % 360) + 360) % 360;
        s = Math.Clamp(s, 0, 1);
        v = Math.Clamp(v, 0, 1);
        var c = v * s;
        var x = c * (1 - Math.Abs(h / 60 % 2 - 1));
        var m = v - c;
        var (r, g, b) = (int)(h / 60) switch
        {
            0 => (c, x, 0.0),
            1 => (x, c, 0.0),
            2 => (0.0, c, x),
            3 => (0.0, x, c),
            4 => (x, 0.0, c),
            _ => (c, 0.0, x),
        };
        static byte B(double t) => (byte)Math.Round(Math.Clamp(t, 0, 1) * 255);
        return Color.FromRgb(B(r + m), B(g + m), B(b + m));
    }
}
