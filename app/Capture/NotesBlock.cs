using System.Windows;
using System.Windows.Media;

namespace SnipToss.App.Capture;

/// <summary>One note in the notes area: number (0 = no number circle, used for the overall comment), circle color, category, position, and the original text</summary>
sealed record NoteEntry(int Number, Color Color, string Category, string Where, string Body);

/// <summary>
/// The notes area below the image: number circle + a "category · position" line (the category in its category color) + the original text, wrapped to the image width; a closing paragraph can follow (the "Extra instructions" setting).
/// Shared by Screen Capture and the main app's Copy as Images, so the images from both look the same (Copy as Images is for web-based AI and chat apps).
/// s is the magnification: Screen Capture follows the display scale, Copy as Images follows the image width (the text grows with a large image, so it stays legible after an AI shrinks it)
/// </summary>
sealed class NotesBlock
{
    sealed record Item(int Number, Color Color, FormattedText Head, FormattedText Body);

    readonly List<Item> items;
    readonly Item? overall;
    readonly FormattedText? title;
    readonly FormattedText? extra;
    readonly double s;
    /// <summary>With two columns, the index of the first note in the right column; with one column = items.Count</summary>
    readonly int split;
    readonly double columnWidth;

    public int Width { get; }
    public int Height { get; }
    /// <summary>Split into two columns (so the image does not grow without limit when there are many notes)</summary>
    public bool TwoColumns => split < items.Count;

    NotesBlock(List<Item> items, Item? overall, FormattedText? title, FormattedText? extra, double s, int split, double columnWidth, int width, int height)
    {
        this.items = items;
        this.overall = overall;
        this.title = title;
        this.extra = extra;
        this.s = s;
        this.split = split;
        this.columnWidth = columnWidth;
        Width = width;
        Height = height;
    }

    /// <summary>
    /// The drawn text, one paragraph per item: the title, each note's "category · position" and original text, the overall comment, the closing paragraph. Used to compare against the text given to the AI;
    /// it contains the invisible characters added for line breaking (KeepPairs, KeepWords)
    /// </summary>
    internal IEnumerable<string> Texts()
    {
        if (title is not null) yield return title.Text;
        foreach (var i in overall is null ? items : items.Append(overall))
        {
            yield return i.Head.Text;
            yield return i.Body.Text;
        }
        if (extra is not null) yield return extra.Text;
    }

    /// <summary>The minimum width of the notes area (narrower and each line holds only a few characters); when the image is narrower, the notes area widens the whole image</summary>
    internal const int MinWidth = 420;

    /// <summary>Gap between columns</summary>
    const double Gutter = 24;

    const char WordJoiner = (char)0x2060, NoBreakSpace = (char)0xA0;

    /// <summary>
    /// Keeps pairs in the position text on one line (the notes area used to split them in Chinese, French, Spanish, Italian and Russian):
    /// a name and its number in "w=100" (as in browsers, a line may break after Han characters and kana, so a CJK name needs the joiner before "="), the letter and number in "y 17%–40%", and the two ends of "13%–38%" (a line may break after the dash).
    /// A zero-width, invisible WORD JOINER is added before "=" and after "–", and the space before a digit becomes a no-break space; used only in the drawn image, the text given to the AI is unchanged
    /// </summary>
    internal static string KeepPairs(string where)
    {
        var sb = new System.Text.StringBuilder(where.Length + 8);
        for (var i = 0; i < where.Length; i++)
        {
            var c = where[i];
            if (c == '=') sb.Append(WordJoiner);
            sb.Append(c == ' ' && i + 1 < where.Length && char.IsAsciiDigit(where[i + 1]) ? NoBreakSpace : c);
            if (c == '–') sb.Append(WordJoiner);
        }
        return sb.ToString();
    }

    /// <param name="imageHeight">The height of the screenshot above: when one column of notes is taller than it and the image is wide enough for two columns, split into two (omitted = no columns; Copy as Images has only one note per image)</param>
    public static NotesBlock Build(IReadOnlyList<NoteEntry> entries, NoteEntry? overall, string? title, string? extra, int imageWidth, double s, int imageHeight = int.MaxValue)
    {
        var width = Math.Max(imageWidth, (int)Math.Ceiling(MinWidth * s));
        var pad = 16 * s;
        var light = new SolidColorBrush(Color.FromRgb(0xe8, 0xe8, 0xea));
        var muted = new SolidColorBrush(Color.FromRgb(0x8a, 0x8a, 0x92));
        FormattedText Para(string text, double maxWidth, Brush brush, double size)
        {
            var t = MarkPainter.Text(text, size * s, brush, 1);
            t.MaxTextWidth = Math.Max(40, maxWidth);
            t.LineHeight = size * s * 1.55;
            return t;
        }
        // "Change · Region: … x=100 y=100 w=200 h=100 px": the category in its category color, the position in gray text
        FormattedText Head(string category, string rest, double textWidth)
        {
            var label = KeepWords.Of(Categories.Label(category));
            var t = Para(rest.Length > 0 ? $"{label} · {KeepPairs(KeepWords.Of(rest))}" : label, textWidth, muted, 12);
            t.SetForegroundBrush(new SolidColorBrush(Categories.Color(category)), 0, label.Length);
            t.SetFontWeight(FontWeights.SemiBold, 0, label.Length);
            return t;
        }
        Item ItemOf(NoteEntry e, double columnWidth) =>
            new(e.Number, e.Color, Head(e.Category, e.Where, columnWidth - 28 * s), Para(e.Body, columnWidth - 28 * s, light, 14));

        var head = title is null ? null : Para(KeepWords.Of(title), width - pad * 2, muted, 12);
        var tail = string.IsNullOrWhiteSpace(extra) ? null : Para(extra.Trim(), width - pad * 2, light, 14);
        var fixedHeight = pad + (head is null ? 0 : head.Height + 12 * s) + (tail is null ? 0 : tail.Height + 12 * s) + pad - 12 * s;

        // Lay out in one column first; if that is taller than the screenshot, the width fits two columns (each at least a bit over half of MinWidth) and there is more than one note: re-lay out in two columns, keeping their heights as even as possible
        var one = width - pad * 2;
        var list = entries.Select(e => ItemOf(e, one)).ToList();
        var over = overall is null ? null : ItemOf(overall, one);
        var height = fixedHeight + list.Sum(i => ItemHeight(i, s)) + (over is null ? 0 : ItemHeight(over, s));
        var split = list.Count;
        var columnWidth = one;
        var half = (one - Gutter * s) / 2;
        if (height > imageHeight && list.Count > 1 && half >= MinWidth * s * 0.6)
        {
            list = entries.Select(e => ItemOf(e, half)).ToList();
            over = overall is null ? null : ItemOf(overall, one);
            var heights = list.Select(i => ItemHeight(i, s)).ToList();
            var total = heights.Sum();
            // Fill the left column until it passes half (numbers read top to bottom, then left to right)
            double left = 0;
            split = 0;
            while (split < list.Count - 1 && left + heights[split] / 2 < total / 2) left += heights[split++];
            split = Math.Max(1, split);
            var columns = Math.Max(heights.Take(split).Sum(), heights.Skip(split).Sum());
            height = fixedHeight + columns + (over is null ? 0 : ItemHeight(over, s));
            columnWidth = half;
        }
        return new NotesBlock(list, over, head, tail, s, split, columnWidth, width, (int)Math.Ceiling(height));
    }

    public void Draw(DrawingContext dc, int canvasWidth)
    {
        dc.DrawRectangle(new SolidColorBrush(Color.FromRgb(0x1b, 0x1b, 0x1e)), null, new Rect(0, 0, canvasWidth, Height));
        dc.DrawRectangle(new SolidColorBrush(Color.FromRgb(0x2c, 0x2c, 0x31)), null, new Rect(0, 0, canvasWidth, Math.Max(1, Math.Round(s))));
        var pad = 16 * s;
        var y = pad;
        if (title is not null)
        {
            dc.DrawText(title, new Point(pad, y));
            y += title.Height + 12 * s;
        }
        var top = y;
        double bottom = y;
        for (var i = 0; i < items.Count; i++)
        {
            // Two columns: the right column starts at the note at split, back at the top
            if (i == split && TwoColumns) y = top;
            var x = i < split ? pad : pad + columnWidth + Gutter * s;
            var item = items[i];
            if (item.Number > 0) MarkPainter.DrawBadge(dc, item.Number, item.Color, new Point(x + 10 * s, y + item.Head.Height / 2), 1, 10 * s);
            y = DrawItem(dc, item, x + 28 * s, y);
            bottom = Math.Max(bottom, y);
        }
        y = bottom;
        if (overall is not null) y = DrawItem(dc, overall, pad + 28 * s, y);
        if (extra is not null) dc.DrawText(extra, new Point(pad, y));
    }

    double DrawItem(DrawingContext dc, Item item, double x, double y)
    {
        dc.DrawText(item.Head, new Point(x, y));
        y += item.Head.Height + 2 * s;
        dc.DrawText(item.Body, new Point(x, y));
        return y + item.Body.Height + 12 * s;
    }

    static double ItemHeight(Item item, double s) => item.Head.Height + 2 * s + item.Body.Height + 12 * s;
}
