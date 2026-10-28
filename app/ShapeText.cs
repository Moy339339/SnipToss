namespace SnipToss.App;

/// <summary>
/// The position wording for AI: "Region: top left of the frame (x 12%–52%, y 8%–18%), x=230 y=86 w=768 h=108 px": a plain-language bearing and percentages first, then the raw pixels.
/// Word for word the same as describeShape in the main app's core (packages/core/src/review.ts): both sides run the same golden file tests/golden/where.zh-CN.json,
/// and the wording lives in the ai.where.* messages (the capture overlay used to have its own set, "Rectangle (top-left x 100, y 50, 200×100 pixels)", so Copy as Images and the Screen Capture notes area said it differently).
/// Coordinates are normalized to 0–1 (like the notes file); size = the frame's size in pixels, and when unknown only percentages are given
/// </summary>
static class ShapeText
{
    public abstract record Shape;

    public sealed record Region(double X, double Y, double W, double H) : Shape;

    public sealed record Spot(double X, double Y) : Shape;

    public sealed record Arrow(double FromX, double FromY, double ToX, double ToY) : Shape;

    public sealed record Path(IReadOnlyList<(double X, double Y)> Points) : Shape;

    /// <summary>Same as JS's Math.round: .5 rounds up. C#'s Math.Round uses banker's rounding by default (2.5 → 2), so the two sides would differ by 1</summary>
    static long Round(double v) => (long)Math.Floor(v + 0.5);

    static long Pct(double v) => Round(Math.Min(1, Math.Max(0, v)) * 100);

    static readonly string[][] Places =
    [
        ["topLeft", "top", "topRight"],
        ["left", "center", "right"],
        ["bottomLeft", "bottom", "bottomRight"],
    ];

    static readonly string[] Across = ["top", "middle", "bottom"];
    static readonly string[] Down = ["left", "middle", "right"];

    /// <summary>The rough position in the frame (nine-grid). If w and h are given it is a region: very wide or very tall ones are described as spanning across / down</summary>
    static string PlaceName(double cx, double cy, double w = 0, double h = 0)
    {
        var col = cx < 1.0 / 3 ? 0 : cx > 2.0 / 3 ? 2 : 1;
        var row = cy < 1.0 / 3 ? 0 : cy > 2.0 / 3 ? 2 : 1;
        if (w >= 0.66 && h >= 0.66) return Locale.T("ai.where.most");
        if (w >= 0.66) return Locale.T($"ai.where.across.{Across[row]}");
        if (h >= 0.66) return Locale.T($"ai.where.down.{Down[col]}");
        return Locale.T($"ai.where.place.{Places[row][col]}");
    }

    public static string Describe(Shape shape, (int Width, int Height)? size)
    {
        string Px(double v, int total) => Round(v * total).ToString(System.Globalization.CultureInfo.InvariantCulture);
        string Span(double x, double y, double w, double h) =>
            Locale.T("ai.where.span", ("place", PlaceName(x + w / 2, y + h / 2, w, h)), ("x1", Pct(x)), ("x2", Pct(x + w)), ("y1", Pct(y)), ("y2", Pct(y + h)))
            + (size is { } z ? Locale.T("ai.where.spanPx", ("x", Px(x, z.Width)), ("y", Px(y, z.Height)), ("w", Px(w, z.Width)), ("h", Px(h, z.Height))) : "");
        string SpotText(double x, double y) => Locale.T("ai.where.spot", ("place", PlaceName(x, y)), ("x", Pct(x)), ("y", Pct(y)));
        switch (shape)
        {
            case Region r:
                return Locale.T("ai.where.rect", ("span", Span(r.X, r.Y, r.W, r.H)));
            case Spot p:
                return Locale.T("ai.where.point", ("spot", SpotText(p.X, p.Y)))
                    + (size is { } ps ? Locale.T("ai.where.pointPx", ("x", Px(p.X, ps.Width)), ("y", Px(p.Y, ps.Height))) : "");
            case Arrow a:
                return Locale.T("ai.where.arrow", ("from", SpotText(a.FromX, a.FromY)), ("to", SpotText(a.ToX, a.ToY)))
                    + (size is { } az
                        ? Locale.T("ai.where.arrowPx", ("x1", Px(a.FromX, az.Width)), ("y1", Px(a.FromY, az.Height)), ("x2", Px(a.ToX, az.Width)), ("y2", Px(a.ToY, az.Height)))
                        : "");
            case Path path:
                var x = path.Points.Min(q => q.X);
                var y = path.Points.Min(q => q.Y);
                return Locale.T("ai.where.path", ("span", Span(x, y, path.Points.Max(q => q.X) - x, path.Points.Max(q => q.Y) - y)));
            default:
                throw new ArgumentException($"Unknown shape: {shape}");
        }
    }
}
