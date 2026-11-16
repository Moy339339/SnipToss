using System.Reflection;
using System.Windows;
using System.Windows.Controls;
using SnipToss.App.Capture;

namespace AppTests;

/// <summary>
/// The input method's composition underline in the capture overlay (ImeUnderline): WPF's own one is turned off (it loops forever on a
/// composition holding a line break), and ours walks the lines of any composition, line breaks included, in bounded time
/// </summary>
public class ImeUnderlineTests
{
    const string Sentence = "标题的字现在有点挤，和下面那张图之间最好再留一点空隙吧。按钮的颜色也可以再深一些，跟整体的风格对得上。大概就是这么个意思，你先改一版看看。";

    /// <summary>
    /// WPF draws nothing for an input method attribute that reads as empty: after the switch every lookup answers with one, so no composition
    /// adorner is ever made. Fails when a .NET upgrade renames these WPF internals (the switch then logs and does nothing)
    /// </summary>
    [Fact]
    public void Wpf_composition_underline_is_turned_off()
    {
        Assert.True(ImeUnderline.DisableWpfUnderline());
        var framework = typeof(TextBox).Assembly;
        var ranges = framework.GetType("System.Windows.Documents.TextServicesDisplayAttributePropertyRanges", throwOnError: true)!;
        var lookup = ranges.GetMethod("GetDisplayAttribute", BindingFlags.NonPublic | BindingFlags.Static)!;
        foreach (var atom in new[] { 0, 1, 7, 12345 })
        {
            var attribute = lookup.Invoke(null, [atom]);
            Assert.NotNull(attribute);
            Assert.Equal(true, attribute!.GetType().GetMethod("IsEmptyAttribute", BindingFlags.NonPublic | BindingFlags.Instance)!.Invoke(attribute, null));
        }
    }

    [Theory]
    [InlineData("CR LF")]
    [InlineData("LF")]
    [InlineData("paragraph separator")]
    public void Underline_covers_a_composition_across_a_line_break(string kind)
    {
        var lineBreak = kind switch
        {
            "CR LF" => $"{(char)0x0D}{(char)0x0A}",
            "LF" => $"{(char)0x0A}",
            _ => $"{(char)0x2029}",
        };
        CaptureTests.OnSta(() =>
        {
            var text = Sentence[..20] + lineBreak + Sentence[20..];
            var box = LaidOut(text);
            var started = DateTime.UtcNow;
            var lines = ImeUnderline.Lines(box, 0, text.Length);
            Assert.True(DateTime.UtcNow - started < TimeSpan.FromSeconds(2));
            // One underline per visual line, none of them under the line break itself
            Assert.Equal(box.LineCount, lines.Count);
            Assert.All(lines, l => Assert.True(l.To.X > l.From.X));
            // The first line ends where its 20 characters end, well short of the box's width
            Assert.True(lines[0].To.X < lines[1].To.X);
            // Lines go down the box
            for (var i = 1; i < lines.Count; i++) Assert.True(lines[i].From.Y > lines[i - 1].From.Y);
        });
    }

    [Fact]
    public void Underline_covers_only_the_composition()
    {
        CaptureTests.OnSta(() =>
        {
            var box = LaidOut("已经上屏的文字" + Sentence);
            var lines = ImeUnderline.Lines(box, 7, Sentence.Length);
            var whole = ImeUnderline.Lines(box, 0, box.Text.Length);
            Assert.Equal(whole.Count, lines.Count);
            // Starts after the committed text on the first line, and ends where the text ends
            Assert.True(lines[0].From.X > whole[0].From.X);
            Assert.Equal(whole[^1].To.X, lines[^1].To.X, 3);
            Assert.Empty(ImeUnderline.Lines(box, 3, 0));
            Assert.Empty(ImeUnderline.Lines(box, box.Text.Length + 5, 3));
        });
    }

    /// <summary>
    /// A wrapping text box like the overlay's note box, laid out in a window off screen (a text box lays out its lines only once its template
    /// is applied in a shown window). The window stays open for the test's thread, which ends with it
    /// </summary>
    static TextBox LaidOut(string text)
    {
        var box = new TextBox { Width = 330, TextWrapping = TextWrapping.Wrap, AcceptsReturn = true, FontSize = 13, Text = text };
        var window = new Window
        {
            Content = box,
            SizeToContent = SizeToContent.WidthAndHeight,
            WindowStyle = WindowStyle.None,
            ShowInTaskbar = false,
            ShowActivated = false,
            Left = -10000,
            Top = -10000,
        };
        window.Show();
        window.UpdateLayout();
        return box;
    }
}
