using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using SnipToss.App;
using SnipToss.App.Capture;

namespace AppTests;

/// <summary>
/// Layout of the shell's native UI in languages with long text: the button row wraps when it does not fit,
/// coordinates in the notes area are not split across two lines, Korean wraps by word, and the error toast title wraps
/// </summary>
public class NativeUiTests
{
    const char WordJoiner = (char)0x2060, NoBreakSpace = (char)0xA0;

    static Button Fixed(double width, Dock dock)
    {
        var b = new Button { Width = width, Height = 32 };
        DockPanel.SetDock(b, dock);
        return b;
    }

    /// <summary>The top-left corner of each button after measuring and arranging (in the order they were added)</summary>
    static List<Point> Layout(ButtonRow row, double width)
    {
        row.Measure(new Size(width, double.PositiveInfinity));
        row.Arrange(new Rect(0, 0, width, row.DesiredSize.Height));
        return row.Children.Cast<UIElement>().Select(c => c.TranslatePoint(new Point(0, 0), row)).ToList();
    }

    [Fact]
    public void Button_row_that_fits_stays_on_one_line_left_buttons_left_right_buttons_right_the_first_added_rightmost()
    {
        CaptureTests.OnSta(() =>
        {
            var row = new ButtonRow();
            row.Children.Add(Fixed(100, Dock.Left));
            row.Children.Add(Fixed(80, Dock.Left));
            row.Children.Add(Fixed(90, Dock.Right)); // the primary button, rightmost
            row.Children.Add(Fixed(70, Dock.Right));
            Assert.Equal([new Point(0, 0), new Point(100, 0), new Point(410, 0), new Point(340, 0)], Layout(row, 500));
            Assert.Equal(32, row.DesiredSize.Height);
        });
    }

    [Fact]
    public void Button_row_that_does_not_fit_puts_each_group_on_its_own_line_the_right_group_stays_right_and_an_oversized_group_wraps()
    {
        // It used to be a DockPanel: in the French and Russian error windows the Continue and Restart buttons were squeezed out,
        // neither visible nor clickable
        CaptureTests.OnSta(() =>
        {
            var row = new ButtonRow();
            row.Children.Add(Fixed(200, Dock.Left));
            row.Children.Add(Fixed(150, Dock.Left));
            row.Children.Add(Fixed(90, Dock.Right));
            row.Children.Add(Fixed(110, Dock.Right));
            // 472 = the error window's width of 520 minus 24 on each side
            Assert.Equal([new Point(0, 0), new Point(200, 0), new Point(382, 40), new Point(272, 40)], Layout(row, 472));
            Assert.Equal(32 * 2 + 8, row.DesiredSize.Height);
            Assert.Equal([new Point(0, 0), new Point(0, 40), new Point(210, 80), new Point(100, 80)], Layout(row, 300));
            Assert.Equal(32 * 3 + 8 * 2, row.DesiredSize.Height);
        });
    }

    [Fact]
    public void Coordinates_in_the_notes_area_are_not_split_across_lines_name_and_number_letter_and_range_and_both_ends_of_a_range()
    {
        Assert.Equal($"x{WordJoiner}=50 y{WordJoiner}=50 宽{WordJoiner}=100 高{WordJoiner}=70 px", NotesBlock.KeepPairs("x=50 y=50 宽=100 高=70 px"));
        Assert.Equal($"(x{NoBreakSpace}13%–{WordJoiner}38%, y{NoBreakSpace}17%–{WordJoiner}40%)", NotesBlock.KeepPairs("(x 13%–38%, y 17%–40%)"));
    }

    [Fact]
    public void WPF_honours_WORD_JOINER_so_the_width_label_equals_sign_and_number_move_to_the_next_line_together()
    {
        // A break is normally allowed after "宽": when the width only fits "一二三四 宽", without the joiner it wraps as "一二三四 宽 / =100"
        // and with it as "一二三四 / 宽=100", which makes the widest line narrower
        CaptureTests.OnSta(() =>
        {
            // max = 0: unlimited width (MaxTextWidth does not accept very large numbers)
            FormattedText Text(string s, double max = 0)
            {
                var t = MarkPainter.Text(s, 14, Brushes.White, 1);
                if (max > 0) t.MaxTextWidth = max;
                return t;
            }
            var room = Text("一二三四 宽").WidthIncludingTrailingWhitespace + 1;
            var plain = Text("一二三四 宽=100", room);
            var kept = Text(NotesBlock.KeepPairs("一二三四 宽=100"), room);
            Assert.True(plain.Height > 20 && kept.Height > 20, "Both wrap onto two lines");
            Assert.True(kept.Width < plain.Width - 7, $"With it, the widest line should get narrower: {kept.Width} / {plain.Width}");
            // Takes no width: when everything fits on one line both are equally wide
            Assert.Equal(Text("宽=100").Width, Text(NotesBlock.KeepPairs("宽=100")).Width, 3);
        });
    }

    [Fact]
    public void Korean_wraps_by_word_no_break_inside_a_word_spaces_and_punctuation_still_break_and_text_without_Hangul_is_unchanged()
    {
        var j = WordJoiner;
        Assert.Equal($"진{j}단 정{j}보{j}를 복{j}사", KeepWords.Of("진단 정보를 복사"));
        Assert.Equal($"Enter 키{j}를 (설{j}정 → 일{j}반)", KeepWords.Of("Enter 키를 (설정 → 일반)"));
        Assert.Equal($"3{j}개", KeepWords.Of("3개"));
        Assert.Equal("批注尚未复制：再次按 Esc", KeepWords.Of("批注尚未复制：再次按 Esc"));
        Assert.Equal("Copy diagnostic info", KeepWords.Of("Copy diagnostic info"));
    }

    [Fact]
    public void Japanese_katakana_words_do_not_break_in_the_middle_hiragana_and_kanji_still_can()
    {
        var j = WordJoiner;
        // "クリップボード" used to be split as "クリップボー / ド"
        Assert.Equal($"メ{j}モ付きの画像をク{j}リ{j}ッ{j}プ{j}ボ{j}ー{j}ドにコ{j}ピ{j}ーしました", KeepWords.Of("メモ付きの画像をクリップボードにコピーしました"));
        Assert.Equal("画像を保存しました", KeepWords.Of("画像を保存しました"));
    }

    [Fact]
    public void Error_toast_title_wraps_and_does_not_run_under_the_close_button()
    {
        CaptureTests.OnSta(() =>
        {
            var content = Toast.ErrorContent("Copied the screenshot and overall comment, but the screenshot file couldn't be saved", "detail", null, null, () => { });
            content.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
            content.Arrange(new Rect(content.DesiredSize));
            var title = Descendants(content).OfType<TextBlock>().First(t => t.FontWeight == FontWeights.SemiBold);
            Assert.Equal(TextWrapping.Wrap, title.TextWrapping);
            var close = Descendants(content).OfType<Button>().Single(b => b.IsCancel);
            var titleRight = title.TranslatePoint(new Point(title.ActualWidth, 0), content).X;
            Assert.True(titleRight <= close.TranslatePoint(new Point(0, 0), content).X, "The title's right edge does not pass the close button's left edge");
        });
    }

    [Fact]
    public void Completion_toast_sits_in_the_center_of_the_work_area()
    {
        // 1920 × 1080 with a 48 taskbar: work area 1920 × 1032; window 400 × 110
        // (24 on every side is left for the shadow, so a centered window means a centered card)
        Assert.Equal((760, 461), Toast.Place(new Int32Rect(0, 0, 1920, 1032), 400, 110));
        // A screen to the left of the primary one (negative coordinates) and offset upward
        Assert.Equal((-3840 + 1620, -200 + 961), Toast.Place(new Int32Rect(-3840, -200, 3840, 2088), 600, 165));
        // Window larger than the work area: pinned to its top-left, never off screen
        Assert.Equal((0, 0), Toast.Place(new Int32Rect(0, 0, 800, 600), 1000, 900));
    }

    static IEnumerable<object> Descendants(object node)
    {
        if (node is not DependencyObject d) yield break;
        foreach (var child in LogicalTreeHelper.GetChildren(d))
        {
            yield return child;
            foreach (var x in Descendants(child)) yield return x;
        }
    }
}
