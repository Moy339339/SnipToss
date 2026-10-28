using System.IO;
using SnipToss.App;
using SnipToss.App.Capture;

namespace AppTests;

/// <summary>
/// The parts of Screen Capture on the shell side that can be tested without opening the capture overlay:
/// wrongly typed settings values and failures when changing the shortcut.
/// The overlay itself (selection, mouse, Alt+F4) needs the overlay's test injection hooks, see layer 5 of ADR-0004
/// </summary>
public class CaptureTests
{
    [Fact]
    public void Wrongly_typed_settings_values_fall_back_to_defaults_without_throwing()
    {
        // GetValue<string>() used to throw on a number or an array, right inside the overlay's Start,
        // so the shortcut silently failed to open it every time
        using var dir = new TempDir();
        var path = dir.File("settings.json");
        File.WriteAllText(path, """
            { "Prefs": { "markColor": 5, "defaultCategory": [], "promptExtra": { "a": 1 }, "skipDirs": [1, "out", null], "kinds": { "image": "yes", "video": true } } }
            """);
        var s = Settings.LoadFrom(path);
        Assert.Equal("#ff6a3d", s.MarkColor);
        Assert.Equal("change", s.DefaultCategory);
        Assert.Equal("", s.PromptExtra);
        Assert.Equal(["out"], s.SkipDirs);
        // Non-boolean values use the default (images are listed by default), the same rule the UI uses when merging settings
        Assert.Equal(["image", "video"], s.EnabledKinds.Order());
    }

    [Fact]
    public void Well_formed_settings_values_are_read_as_they_are()
    {
        using var dir = new TempDir();
        var path = dir.File("settings.json");
        File.WriteAllText(path, """{ "Prefs": { "markColor": "#00ff00", "defaultCategory": "question", "promptExtra": "  用中文回复  " } }""");
        var s = Settings.LoadFrom(path);
        Assert.Equal("#00ff00", s.MarkColor);
        Assert.Equal("question", s.DefaultCategory);
        Assert.Equal("用中文回复", s.PromptExtra);
    }

    [Fact]
    public void Archive_file_name_has_no_language_or_spaces_uses_a_fixed_Gregorian_format_ignores_the_locale_and_numbers_same_second_files()
    {
        // The default calendar of the Thai locale is the Buddhist one, which used to put years like 2569 into the name;
        // file names carry no language (ADR-0001 item 8)
        var culture = System.Globalization.CultureInfo.CurrentCulture;
        try
        {
            System.Globalization.CultureInfo.CurrentCulture = new System.Globalization.CultureInfo("th-TH");
            var at = new DateTime(2026, 10, 22, 14, 3, 5);
            Assert.Equal("capture-2026-10-22_14-03-05.png", CaptureSession.FileName(at, 1));
            Assert.Equal("capture-2026-10-22_14-03-05-2.png", CaptureSession.FileName(at, 2));
        }
        finally
        {
            System.Globalization.CultureInfo.CurrentCulture = culture;
        }
    }

    [Fact]
    public void Notes_area_title_does_not_mention_number_matching_when_there_is_only_an_overall_comment()
    {
        Assert.Contains("序号", CaptureSession.NotesTitle(numbered: true), StringComparison.Ordinal);
        Assert.DoesNotContain("序号", CaptureSession.NotesTitle(numbered: false), StringComparison.Ordinal);
    }

    [Fact]
    public void Position_wording_formats_numbers_independently_of_the_system_locale()
    {
        // In some locales the minus sign is U+2212 (ICU); these numbers are never negative today, but the rule has to hold
        var culture = System.Globalization.CultureInfo.CurrentCulture;
        try
        {
            System.Globalization.CultureInfo.CurrentCulture = new System.Globalization.CultureInfo("sv-SE");
            var m = new Mark { Kind = Tool.Rect, Points = [new(-5, 10), new(1200, 30)] };
            Assert.Equal("区域 横贯画面上部（横 0%–100%、纵 1%–3%），x=-5 y=10 宽=1205 高=20 px", m.Where(new System.Windows.Rect(0, 0, 1200, 1000), (1200, 1000)));
        }
        finally
        {
            System.Globalization.CultureInfo.CurrentCulture = culture;
        }
    }

    [Fact]
    public void Wording_for_a_note_with_several_marks_is_N_places_with_semicolons_one_place_is_unchanged_and_matches_the_main_apps_Copy_as_Text()
    {
        // ADR-0009: the first place plus those marked after it, in drawing order; the message is the main app's (ai.where.many),
        // golden files in tests/golden/handoff
        var sel = new System.Windows.Rect(0, 0, 1000, 500);
        var rect = new Mark { Kind = Tool.Rect, Points = [new(100, 400), new(300, 440)] };
        var pin = new Mark { Kind = Tool.Note, Points = [new(850, 425)], Lead = rect };
        var other = new Mark { Kind = Tool.Note, Points = [new(500, 250)] };
        List<Mark> all = [rect, other, pin];
        Assert.Equal(
            "2 处：区域 画面左下（横 10%–30%、纵 80%–88%），x=100 y=400 宽=200 高=40 px；位置 画面右下（横 85%、纵 85%），x=850 y=425 px",
            rect.WhereAll(all, sel, (1000, 500)));
        Assert.Equal(other.Where(sel, (1000, 500)), other.WhereAll(all, sel, (1000, 500)));
        Assert.Same(rect, pin.Head);
        Assert.Same(other, other.Head);
    }

    [Fact]
    public void When_the_places_have_different_colors_each_is_prefixed_with_its_color_so_it_matches_a_note_that_refers_to_a_color()
    {
        // A place gets its own color so the note can say "the yellow one…"; preset colors are written by name, custom color values as they are
        var sel = new System.Windows.Rect(0, 0, 1000, 500);
        var first = new Mark { Kind = Tool.Note, Color = ToolPrefs.Colors[0], Points = [new(100, 100)] };
        var second = new Mark { Kind = Tool.Note, Color = ToolPrefs.Colors[2], Points = [new(900, 400)], Lead = first };
        Assert.Equal(
            "2 处：（橙色）位置 画面左上（横 10%、纵 20%），x=100 y=100 px；（黄色）位置 画面右下（横 90%、纵 80%），x=900 y=400 px",
            first.WhereAll([first, second], sel, (1000, 500)));
        second.Color = System.Windows.Media.Color.FromRgb(0x12, 0x34, 0x56);
        Assert.StartsWith("2 处：（橙色）位置 ", first.WhereAll([first, second], sel, (1000, 500)));
        Assert.Contains("；（#123456）位置 ", first.WhereAll([first, second], sel, (1000, 500)));
        Assert.Equal("Yellow", Locale.In("en", "markColor.name", ("color", "yellow")));
    }

    [Fact]
    public void Mark_hit_testing_widens_lines_by_thickness_ignores_the_inside_of_boxes_and_uses_the_text_extent_for_text()
    {
        var rect = new Mark { Kind = Tool.Rect, Size = 2, Points = [new(100, 100), new(200, 200)] };
        Assert.True(rect.Hits(new(100, 150)));
        Assert.True(rect.Hits(new(95, 150))); // within half the line width + 4
        Assert.False(rect.Hits(new(94, 150)));
        Assert.False(rect.Hits(new(150, 150))); // inside the box: a new mark is drawn as usual
        var small = new Mark { Kind = Tool.Rect, Size = 2, Points = [new(100, 100), new(106, 106)] };
        Assert.True(small.Hits(new(103, 103))); // a small box counts as hit all over
        var ellipse = new Mark { Kind = Tool.Ellipse, Size = 2, Points = [new(100, 100), new(300, 200)] };
        Assert.True(ellipse.Hits(new(300, 150)));
        Assert.True(ellipse.Hits(new(200, 98)));
        Assert.False(ellipse.Hits(new(200, 150)));
        var arrow = new Mark { Kind = Tool.Arrow, Size = 4, Points = [new(100, 100), new(300, 100)] };
        Assert.True(arrow.Hits(new(200, 105)));
        Assert.False(arrow.Hits(new(200, 108)));
        Assert.True(arrow.Hits(new(295, 112))); // the arrow head
        var pen = new Mark { Kind = Tool.Pen, Size = 2, Points = [new(100, 100), new(150, 100), new(150, 150)] };
        Assert.True(pen.Hits(new(153, 125)));
        Assert.False(pen.Hits(new(125, 125)));
        Assert.False(new Mark { Kind = Tool.Mosaic, Size = 20, Points = [new(100, 100), new(200, 100)] }.Hits(new(150, 100)));
        OnSta(() =>
        {
            var text = new Mark { Kind = Tool.Text, Size = 18, Points = [new(100, 100)], Text = "Hello" };
            Assert.True(text.Hits(new(110, 110)));
            Assert.False(text.Hits(new(100, 140)));
        });
    }

    /// <summary>Global shortcuts need a window handle (WPF's HwndSource), so this runs on an STA thread</summary>
    internal static void OnSta(Action action)
    {
        Exception? error = null;
        var t = new Thread(() =>
        {
            try
            {
                action();
            }
            catch (Exception ex)
            {
                error = ex;
            }
        });
        t.SetApartmentState(ApartmentState.STA);
        t.Start();
        t.Join();
        if (error is not null) throw new Xunit.Sdk.XunitException(error.ToString());
    }

    // Use combinations nobody normally uses, and unregister them all afterwards
    const string KeyA = "Ctrl+Alt+Shift+F11";
    const string KeyB = "Ctrl+Alt+Shift+F12";

    [Fact]
    public void Changing_the_shortcut_to_one_that_is_taken_keeps_the_old_one_working()
    {
        OnSta(() =>
        {
            using var mine = new GlobalHotKey(() => { });
            using var other = new GlobalHotKey(() => { });
            Assert.Null(mine.Set(KeyA));
            Assert.Null(other.Set(KeyB)); // "another program" holds B
            var error = mine.Set(KeyB);
            Assert.NotNull(error);
            Assert.Equal(KeyA, mine.Current); // it used to unregister A first, fail to register B, and end up with neither
            // A is really still registered: registering A again elsewhere fails
            using var third = new GlobalHotKey(() => { });
            Assert.NotNull(third.Set(KeyA));
        });
    }

    [Fact]
    public void Changing_the_shortcut_to_an_invalid_one_keeps_the_old_one_working()
    {
        OnSta(() =>
        {
            using var mine = new GlobalHotKey(() => { });
            Assert.Null(mine.Set(KeyA));
            Assert.NotNull(mine.Set("Ctrl+不存在的键"));
            Assert.NotNull(mine.Set("F9")); // no modifier key
            Assert.Equal(KeyA, mine.Current);
        });
    }

    [Fact]
    public void Shortcut_with_only_Shift_plus_a_letter_or_digit_is_rejected_but_Shift_plus_an_F_key_is_accepted()
    {
        // Once Shift+A is registered as a global shortcut, no program can type a capital A
        OnSta(() =>
        {
            using var mine = new GlobalHotKey(() => { });
            Assert.Null(mine.Set(KeyA));
            Assert.Contains("Ctrl、Alt 或 Win", mine.Set("Shift+A"));
            Assert.NotNull(mine.Set("Shift+5"));
            Assert.NotNull(mine.Set("Shift+Space"));
            Assert.Equal(KeyA, mine.Current);
            Assert.Null(mine.Set("Ctrl+Alt+Shift+F10"));
            Assert.Null(mine.Set(""));
        });
        Assert.True(GlobalHotKey.UsedForText(0x41)); // A
        Assert.False(GlobalHotKey.UsedForText(0x7A)); // F11
        Assert.False(GlobalHotKey.UsedForText(0x2C)); // PrintScreen
    }

    [Fact]
    public void Shortcut_with_only_Shift_plus_an_arrow_key_Home_End_page_keys_or_Insert_is_rejected_too()
    {
        // Shift+Left selects text and Shift+Insert pastes: once registered as a global shortcut they would stop working in every program
        OnSta(() =>
        {
            using var mine = new GlobalHotKey(() => { });
            foreach (var k in new[] { "Shift+Left", "Shift+Right", "Shift+Up", "Shift+Down", "Shift+Home", "Shift+End", "Shift+PageUp", "Shift+PageDown", "Shift+Insert" })
                Assert.Contains("Ctrl、Alt 或 Win", mine.Set(k));
            Assert.Null(mine.Current);
        });
        Assert.True(GlobalHotKey.UsedForText(0x25)); // ←
        Assert.True(GlobalHotKey.UsedForText(0x2D)); // Insert
        Assert.False(GlobalHotKey.UsedForText(0x13)); // Pause
    }

    [Fact]
    public void AltGr_the_keyboard_layout_is_checked_only_for_combinations_with_both_Ctrl_and_Alt_and_no_Win()
    {
        // Windows treats AltGr as Ctrl+Alt; a combination with Win, or missing one modifier, types nothing on any layout
        Assert.Equal("", GlobalHotKey.TypedChars("Ctrl+Shift+A"));
        Assert.Equal("", GlobalHotKey.TypedChars("Alt+Shift+A"));
        Assert.Equal("", GlobalHotKey.TypedChars("Win+Ctrl+Alt+A"));
        Assert.Equal("", GlobalHotKey.TypedChars("Ctrl+Alt+F11")); // F keys type nothing on any layout
        Assert.Equal("", GlobalHotKey.TypedChars("写错了"));
        Assert.All(GlobalHotKey.Fallbacks, k => Assert.Equal("", GlobalHotKey.TypedChars(k)));
    }

    [Fact]
    public void AltGr_checking_this_computers_layout_never_yields_control_characters()
    {
        // US and Chinese layouts have no AltGr: Ctrl+Alt+letter types nothing; with an AltGr layout what is typed must be
        // a visible character, not a control character like Ctrl+A
        var typed = GlobalHotKey.TypedChars("Ctrl+Alt+A");
        Assert.All(typed, c => Assert.True(c >= 0x20));
    }

    [Fact]
    public void When_the_default_shortcut_types_characters_the_first_fallback_that_types_nothing_and_registers_is_used()
    {
        var tried = new List<string>();
        // The first one is taken by another program
        var to = GlobalHotKey.PickFallback(_ => "", k =>
        {
            tried.Add(k);
            return k != GlobalHotKey.Fallbacks[0];
        });
        Assert.Equal(GlobalHotKey.Fallbacks[1], to);
        Assert.Equal(GlobalHotKey.Fallbacks[..2], tried);
        // Ones that type characters are not even tried
        Assert.Equal(GlobalHotKey.Fallbacks[2], GlobalHotKey.PickFallback(k => k == GlobalHotKey.Fallbacks[2] ? "" : "ą", _ => true));
        // None works: no shortcut is used
        Assert.Equal("", GlobalHotKey.PickFallback(_ => "", _ => false));
    }

    [Fact]
    public void Every_fallback_default_shortcut_parses_and_can_be_registered()
    {
        OnSta(() =>
        {
            using var mine = new GlobalHotKey(() => { });
            foreach (var k in GlobalHotKey.Fallbacks)
            {
                Assert.True(GlobalHotKey.TryParse(k, out _, out _), k);
                // Being taken by another screenshot tool on the machine running the tests is fine, as long as the notation itself is valid
                var error = mine.Set(k);
                Assert.True(error is null || error.Contains("占用"), $"{k}: {error}");
            }
            mine.Set("");
        });
    }

    [Fact]
    public void A_small_selection_with_a_notes_area_below_is_enlarged_by_a_whole_factor_up_to_4_and_a_wide_enough_one_is_not_enlarged()
    {
        // When only a button is selected the screenshot used to sit small in the top-left of a 420-wide dark canvas
        Assert.Equal(4, CaptureSession.Zoom(60, 420));
        Assert.Equal(3, CaptureSession.Zoom(140, 420));
        Assert.Equal(1, CaptureSession.Zoom(300, 420));
        Assert.Equal(1, CaptureSession.Zoom(1920, 420));
        Assert.Equal(4, CaptureSession.Zoom(10, 840)); // however small, it is enlarged at most 4 times
    }

    [Fact]
    public void Pixel_enlargement_turns_each_pixel_into_a_k_by_k_block_with_sharp_edges()
    {
        OnSta(() =>
        {
            // 2×1: red on the left, blue on the right
            var src = System.Windows.Media.Imaging.BitmapSource.Create(2, 1, 96, 96, System.Windows.Media.PixelFormats.Bgra32, null,
                new byte[] { 0, 0, 255, 255, 255, 0, 0, 255 }, 8);
            var big = CaptureSession.Enlarge(src, 3);
            Assert.Equal((6, 3), (big.PixelWidth, big.PixelHeight));
            var px = new byte[6 * 3 * 4];
            big.CopyPixels(px, 6 * 4, 0);
            for (var y = 0; y < 3; y++)
            {
                Assert.Equal(255, px[(y * 6 + 2) * 4 + 2]); // column 3 is still red
                Assert.Equal(255, px[(y * 6 + 3) * 4 + 0]); // column 4 is blue, with no blended color in between
                Assert.Equal(0, px[(y * 6 + 3) * 4 + 2]);
            }
        });
    }

    /// <summary>
    /// Pixelate cells are 12 DIP on screen: they used to be a fixed 12 physical pixels, which at 200% left only 6 DIP per cell
    /// and the text was still legible
    /// </summary>
    [Theory]
    [InlineData(1.0, 12)]
    [InlineData(1.25, 15)]
    [InlineData(1.5, 18)]
    [InlineData(2.0, 24)]
    public void Pixelate_cell_is_12_DIP_grows_with_the_scale_and_a_partial_cell_at_the_bottom_right_uses_its_actual_size(double scale, int block)
    {
        OnSta(() =>
        {
            // 2.5 cells wide and 1.5 cells high; each pixel has B = x and G = y
            int w = block * 5 / 2, h = block * 3 / 2;
            var src = System.Windows.Media.Imaging.BitmapSource.Create(w, h, 96, 96, System.Windows.Media.PixelFormats.Bgra32, null,
                Enumerable.Range(0, w * h).SelectMany(i => new byte[] { (byte)(i % w), (byte)(i / w), 0, 255 }).ToArray(), w * 4);
            var mosaic = (System.Windows.Media.Imaging.BitmapSource)MarkPainter.Pixelate(src, scale);
            var px = new byte[w * h * 4];
            mosaic.CopyPixels(px, w * 4, 0);
            (int B, int G) At(int x, int y) => (px[(y * w + x) * 4], px[(y * w + x) * 4 + 1]);
            // First row: each run of one color is exactly one cell wide, and the last run is the remaining half cell
            var runs = new List<int> { 1 };
            for (var x = 1; x < w; x++)
                if (At(x, 0) == At(x - 1, 0)) runs[^1]++;
                else runs.Add(1);
            Assert.Equal(new[] { block, block, w - 2 * block }, runs);
            // Each cell is the average of its own block (rounded down); the bottom-right block is less than a full cell
            // and is averaged over its actual width and height
            Assert.Equal(((block - 1) / 2, (block - 1) / 2), At(0, 0));
            Assert.Equal(((2 * block + w - 1) / 2, (block + h - 1) / 2), At(w - 1, h - 1));
        });
    }

    [Fact]
    public void Notes_area_taller_than_the_screenshot_splits_into_two_columns_when_wide_enough_to_get_shorter_and_a_narrow_image_stays_single_column()
    {
        OnSta(() =>
        {
            var body = string.Join("", Enumerable.Repeat("标题的字号再大一点，颜色改成品牌蓝。", 4));
            var entries = Enumerable.Range(1, 8).Select(n => new NoteEntry(n, System.Windows.Media.Colors.OrangeRed, "change", $"矩形区域（左上角 x {n}, y {n}，10×10 像素）", body)).ToList();
            var tall = NotesBlock.Build(entries, null, "批注", null, 1200, 1);
            var two = NotesBlock.Build(entries, null, "批注", null, 1200, 1, imageHeight: 300);
            Assert.False(tall.TwoColumns);
            Assert.True(two.TwoColumns);
            Assert.True(two.Height < tall.Height * 0.75, $"{two.Height} vs {tall.Height}");
            // Narrow image (minimum notes area width): two columns would leave only a few characters per line, so no split
            Assert.False(NotesBlock.Build(entries, null, "批注", null, 420, 1, imageHeight: 100).TwoColumns);
            // Only one entry: no split
            Assert.False(NotesBlock.Build(entries.Take(1).ToList(), null, "批注", null, 1200, 1, imageHeight: 10).TwoColumns);
        });
    }

    [Fact]
    public void Compose_enlarges_and_centers_a_small_selection_and_coordinates_in_the_notes_refer_to_the_enlarged_image()
    {
        OnSta(() =>
        {
            // A 200×100 "screen" with an 80×30 selection (as if only a button were framed) and a drawn box carrying a note
            var screen = System.Windows.Media.Imaging.BitmapSource.Create(200, 100, 96, 96, System.Windows.Media.PixelFormats.Bgra32, null,
                Enumerable.Range(0, 200 * 100).SelectMany(i => new byte[] { (byte)(i % 200), 120, 200, 255 }).ToArray(), 200 * 4);
            var monitor = new MonitorShot(new System.Windows.Int32Rect(0, 0, 200, 100), 1, screen);
            var sel = new System.Windows.Rect(20, 30, 80, 30);
            var marks = Enumerable.Range(1, 3).Select(n => new Mark
            {
                Kind = Tool.Rect,
                Color = System.Windows.Media.Colors.OrangeRed,
                Size = 2,
                Points = [new(25 + n * 10, 35), new(35 + n * 10, 45)],
                Note = $"第 {n} 处：按钮文字改成「保存草稿」",
                Number = n,
            }).ToList();
            var result = new CaptureResult(monitor, sel, marks, "", "change", null, new System.Windows.Rect(0, 0, 200, 100));
            var out1 = CaptureSession.Compose(result, notesInImage: true, promptExtra: "");
            // 80 wide would need 5 times to reach 420, capped at 4 times: 320 wide, drawn in the middle of a 420-wide image
            Assert.Equal(420, out1.Size.w);
            Assert.True(out1.Size.h > 30 * 4);
            var dump = Environment.GetEnvironmentVariable("SNIPTOSS_TEST_DUMP");
            if (!string.IsNullOrEmpty(dump)) File.WriteAllBytes(Path.Combine(dump, "compose-small.png"), out1.Png);
            // Without attached notes: not enlarged, original size
            Assert.Equal((80, 30), CaptureSession.Compose(result, notesInImage: false, promptExtra: "").Size);
        });
    }

    [Fact]
    public void Compose_with_many_notes_on_a_wide_image_splits_the_notes_into_two_columns_numbered_from_the_left_column_to_the_right()
    {
        OnSta(() =>
        {
            var screen = System.Windows.Media.Imaging.BitmapSource.Create(1000, 300, 96, 96, System.Windows.Media.PixelFormats.Bgra32, null,
                Enumerable.Range(0, 1000 * 300).SelectMany(i => new byte[] { 90, (byte)(i % 1000 / 4), 60, 255 }).ToArray(), 1000 * 4);
            var monitor = new MonitorShot(new System.Windows.Int32Rect(0, 0, 1000, 300), 1, screen);
            var marks = Enumerable.Range(1, 8).Select(n => new Mark
            {
                Kind = Tool.Rect,
                Color = System.Windows.Media.Colors.OrangeRed,
                Size = 2,
                Points = [new(n * 110, 60), new(n * 110 + 80, 140)],
                Note = n % 3 == 0 ? $"第 {n} 处的图标换成线性风格，和工具栏其余图标保持一致；描边 1.5 像素，圆角 2 像素" : $"第 {n} 处文字改短一些",
                Category = n == 4 ? "question" : "change",
                Number = n,
            }).ToList();
            var result = new CaptureResult(monitor, new System.Windows.Rect(0, 0, 1000, 220), marks, "整体颜色再亮一点", "change", null, new System.Windows.Rect(0, 0, 1000, 300));
            var output = CaptureSession.Compose(result, notesInImage: true, promptExtra: "");
            Assert.Equal(1000, output.Size.w);
            var dump = Environment.GetEnvironmentVariable("SNIPTOSS_TEST_DUMP");
            if (!string.IsNullOrEmpty(dump)) File.WriteAllBytes(Path.Combine(dump, "compose-many.png"), output.Png);
        });
    }

    [Fact]
    public void The_notes_area_and_the_text_for_AI_agree_entry_by_entry_on_category_position_and_original_text()
    {
        // The "category · where" and the original text drawn in the notes area under the image can be found verbatim in the text for AI.
        // That holds for the entry with two places in different colors too (each place carries its color)
        OnSta(() =>
        {
            var screen = System.Windows.Media.Imaging.BitmapSource.Create(400, 200, 96, 96, System.Windows.Media.PixelFormats.Bgra32, null,
                new byte[400 * 200 * 4], 400 * 4);
            var sel = new System.Windows.Rect(0, 0, 400, 200);
            var monitor = new MonitorShot(new System.Windows.Int32Rect(0, 0, 400, 200), 1, screen);
            var first = new Mark { Kind = Tool.Rect, Color = System.Windows.Media.Colors.OrangeRed, Size = 2, Points = [new(20, 20), new(120, 80)], Note = "标题字号再大一点", Number = 1 };
            var second = new Mark
            {
                Kind = Tool.Arrow,
                Color = System.Windows.Media.Colors.OrangeRed,
                Size = 2,
                Points = [new(300, 150), new(250, 100)],
                Note = "这两处为什么颜色不一样？",
                Category = "question",
                Number = 2,
            };
            var again = new Mark { Kind = Tool.Ellipse, Color = System.Windows.Media.Colors.Gold, Size = 2, Points = [new(200, 120), new(260, 180)], Lead = second };
            var words = new Mark { Kind = Tool.Text, Color = System.Windows.Media.Colors.White, Size = 16, Points = [new(10, 170)], Text = "草稿" };
            var marks = new List<Mark> { first, second, again, words };
            var result = new CaptureResult(monitor, sel, marks, "整体再亮一点", "add", null, sel);
            var notes = marks.Where(m => m.HasNote).ToList();

            var drawn = CaptureSession.NotesPanel(result, notes, 400, 200, 1, 1, "").Texts().Select(Plain).ToList();
            var lines = CaptureSession.HandoffText(result, notes, null, (400, 200), "").Split('\n').Select(l => Plain(l.TrimEnd('\r'))).ToList();
            foreach (var m in notes)
            {
                var label = Categories.Label(m.Category);
                var head = Assert.Single(drawn, t => t.StartsWith(label + " · ", StringComparison.Ordinal));
                var line = Assert.Single(lines, l => l.StartsWith($"{m.Number}. ", StringComparison.Ordinal));
                Assert.Contains(head, line, StringComparison.Ordinal);
                Assert.Contains(m.Note, drawn);
                Assert.EndsWith(m.Note, line, StringComparison.Ordinal);
            }
            Assert.Contains("2 处", lines.Single(l => l.StartsWith("2. ", StringComparison.Ordinal)), StringComparison.Ordinal);
            // The overall comment is laid out differently on the two sides (notes area "category · overall comment (no position)",
            // text "overall comment · category: original"), but category and original text are the same
            var overall = Categories.Label("add");
            Assert.Contains(drawn, t => t.StartsWith(overall + " · ", StringComparison.Ordinal));
            Assert.Contains("整体再亮一点", drawn);
            Assert.Contains(lines, l => l.Contains(overall, StringComparison.Ordinal) && l.EndsWith("整体再亮一点", StringComparison.Ordinal));
            // Text marks without a note are listed on neither side
            Assert.DoesNotContain(drawn, t => t.Contains("草稿", StringComparison.Ordinal));
            Assert.DoesNotContain(lines, l => l.Contains("草稿", StringComparison.Ordinal));
        });

        // Strip the invisible characters the notes area adds for line wrapping (NotesBlock.KeepPairs, KeepWords) before comparing
        static string Plain(string s) => s.Replace(((char)0x2060).ToString(), "", StringComparison.Ordinal).Replace((char)0xA0, ' ');
    }

    [Fact]
    public void Shift_drawn_squares_stay_inside_the_selection()
    {
        // With the start near the selection edge the opposite corner used to land outside it,
        // and the width × height handed to the AI exceeded the image
        var sel = new System.Windows.Rect(0, 0, 400, 300);
        var o = new System.Windows.Point(350, 100);
        // Dragging down-right: only 50 is left on the right, so the square's side is 50
        Assert.Equal(new System.Windows.Point(400, 150), OverlayGeometry.SquareCorner(o, new System.Windows.Point(390, 260), sel));
        // Dragging down-left: there is room on the left, the side is the longer of the two (160), and 200 is left below
        Assert.Equal(new System.Windows.Point(190, 260), OverlayGeometry.SquareCorner(o, new System.Windows.Point(300, 260), sel));
        // Dragging up-left: only 100 is left above
        Assert.Equal(new System.Windows.Point(250, 0), OverlayGeometry.SquareCorner(o, new System.Windows.Point(100, 80), sel));
    }

    [Fact]
    public void Hit_testing_a_number_badge_uses_the_position_it_is_drawn_at()
    {
        // A box right at the selection's top-left corner: the badge is clamped 10 into the selection, and both drawing and hit-testing
        // use the clamped position (hit-testing used to use the unclamped one and missed)
        var sel = new System.Windows.Rect(100, 100, 400, 300);
        var m = new Mark { Kind = Tool.Rect, Points = [new(100, 100), new(200, 180)] };
        Assert.Equal(new System.Windows.Point(110, 110), MarkPainter.BadgeCenter(m, sel));
        var inside = new Mark { Kind = Tool.Rect, Points = [new(150, 150), new(200, 180)] };
        Assert.Equal(new System.Windows.Point(150, 150), MarkPainter.BadgeCenter(inside, sel));
    }

    [Fact]
    public void Clearing_the_shortcut_means_none_is_used()
    {
        OnSta(() =>
        {
            using var mine = new GlobalHotKey(() => { });
            Assert.Null(mine.Set(KeyA));
            Assert.Null(mine.Set(""));
            Assert.Null(mine.Current);
            using var other = new GlobalHotKey(() => { });
            Assert.Null(other.Set(KeyA)); // released, so someone else can use it
        });
    }

    [Fact]
    public void Error_toast_has_a_close_button_a_clickable_path_selectable_raw_text_and_opens_the_log()
    {
        // An error toast used to fade out after two and a half seconds like a success one, could not be clicked,
        // and its archive path could not be selected
        OnSta(() =>
        {
            var closed = false;
            var content = Toast.ErrorContent("无法将截图放入剪贴板", "剪贴板可能正被其他程序占用。截图已保存，单击下方路径可在文件夹中显示：", @"C:\截图批注\a.png", "OpenClipboard Failed (0x800401D0)", () => closed = true);
            var all = Descendants(content).ToList();
            var close = all.OfType<System.Windows.Controls.Button>().Single(b => b.IsCancel); // Esc triggers it too
            close.RaiseEvent(new System.Windows.RoutedEventArgs(System.Windows.Controls.Primitives.ButtonBase.ClickEvent));
            Assert.True(closed);
            var link = all.OfType<System.Windows.Documents.Hyperlink>().Single();
            Assert.Equal(@"C:\截图批注\a.png", new System.Windows.Documents.TextRange(link.ContentStart, link.ContentEnd).Text);
            var raw = all.OfType<System.Windows.Controls.TextBox>().Single();
            Assert.True(raw.IsReadOnly);
            Assert.Equal("OpenClipboard Failed (0x800401D0)", raw.Text);
            Assert.Contains(all.OfType<System.Windows.Controls.Button>(), b => Equals(b.Content, "打开日志文件夹"));

            // With no path and no raw text: only the message and the buttons
            var bare = Descendants(Toast.ErrorContent("无法启动截图批注", "截屏时出错。请重新按快捷键。", null, null, () => { })).ToList();
            Assert.Empty(bare.OfType<System.Windows.Documents.Hyperlink>());
            Assert.Empty(bare.OfType<System.Windows.Controls.TextBox>());
        });
    }

    [Theory]
    [InlineData(true, false, 0x0L, 0, 800, 600, true)] // an ordinary window
    [InlineData(true, false, 0x8L, 0, 800, 600, true)] // WS_EX_TOPMOST does not matter
    [InlineData(true, false, 0x80L, 0, 800, 600, true)] // neither does WS_EX_TOOLWINDOW
    [InlineData(true, false, 0x0L, 0, 8, 8, true)] // the smallest size that is still taken
    [InlineData(false, false, 0x0L, 0, 800, 600, false)] // not visible
    [InlineData(true, true, 0x0L, 0, 800, 600, false)] // minimized
    [InlineData(true, false, 0x20L, 0, 800, 600, false)] // WS_EX_TRANSPARENT: a layer that cannot be clicked
    [InlineData(true, false, 0x28L, 0, 800, 600, false)] // transparent stays out even with other bits set
    [InlineData(true, false, 0x0L, 2, 800, 600, false)] // cloaked (DWM_CLOAKED_SHELL: a window on another virtual desktop)
    [InlineData(true, false, 0x0L, 1, 800, 600, false)] // cloaked by its app
    [InlineData(true, false, 0x0L, 0, 7, 600, false)] // too narrow
    [InlineData(true, false, 0x0L, 0, 800, 7, false)] // too short
    [InlineData(true, false, 0x0L, 0, 0, 0, false)] // no bounds could be read
    public void Window_lookup_takes_only_visible_clickable_windows_that_are_not_minimized_cloaked_or_tiny(
        bool visible, bool minimized, long exStyle, int cloaked, int width, int height, bool expected)
    {
        Assert.Equal(expected, Screens.Accept(visible, minimized, exStyle, cloaked, width, height));
    }

    [Fact]
    public void Window_lookup_on_a_real_window_skips_it_while_cloaked_and_takes_it_again_once_uncloaked()
    {
        // The theory above checks the rule only; this goes through EnumWindows and DWM for real. The shell reports a window on another
        // virtual desktop as cloaked (DWM_CLOAKED_SHELL); a window cloaked by its own app sets the same attribute, so the lookup reads both alike
        OnSta(() =>
        {
            // Off every screen, never activated and kept out of the taskbar: nothing shows on the desktop while this runs
            using var probe = new System.Windows.Interop.HwndSource(new System.Windows.Interop.HwndSourceParameters("window lookup probe")
            {
                PositionX = -7000,
                PositionY = -7000,
                Width = 300,
                Height = 200,
                WindowStyle = unchecked((int)0x90000000), // WS_POPUP | WS_VISIBLE
                ExtendedWindowStyle = 0x08000080, // WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW
            });
            var hwnd = probe.Handle;
            Assert.Equal(0, Native.DwmGetWindowAttribute(hwnd, 9 /* DWMWA_EXTENDED_FRAME_BOUNDS */, out Native.RECT r, System.Runtime.InteropServices.Marshal.SizeOf<Native.RECT>()));
            var bounds = new System.Windows.Int32Rect(r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top);
            Assert.Contains(bounds, Screens.WindowRects(0));
            Assert.DoesNotContain(bounds, Screens.WindowRects(Environment.ProcessId)); // the process's own windows can be left out

            var on = 1;
            Assert.Equal(0, Native.DwmSetWindowAttribute(hwnd, 13 /* DWMWA_CLOAK */, ref on, 4));
            Assert.Equal(0, Native.DwmGetWindowAttribute(hwnd, 14 /* DWMWA_CLOAKED */, out int cloaked, 4));
            Assert.NotEqual(0, cloaked);
            Assert.DoesNotContain(bounds, Screens.WindowRects(0));

            var off = 0;
            Assert.Equal(0, Native.DwmSetWindowAttribute(hwnd, 13, ref off, 4));
            Assert.Contains(bounds, Screens.WindowRects(0));
        });
    }

    static IEnumerable<object> Descendants(object node)
    {
        if (node is not System.Windows.DependencyObject d) yield break;
        foreach (var child in System.Windows.LogicalTreeHelper.GetChildren(d))
        {
            yield return child;
            foreach (var x in Descendants(child)) yield return x;
        }
    }
}
