using System.Text.Json.Nodes;
using System.Windows;
using SnipToss.App;

namespace AppTests;

/// <summary>Whether the window position is still reachable, and how the shell reads the item types from the UI settings</summary>
public class WindowAndPrefsTests
{
    // Two screens (100%): a 1920×1040 work area on the left and 1280×984 on the right, offset down by 200
    // (staggered heights leave a blank region below the left screen and above the right one)
    static readonly Display[] Screens = [At(new(0, 0, 1920, 1040)), At(new(1920, 200, 1280, 984))];

    static Display At(Rect work, double scale = 1) => new(work, work, scale);

    static readonly Size Min = WindowPlacement.MinDip;

    // Primary screen 2560×1440 (48 taskbar) at 100%, and to its right a portrait secondary screen 1200×1920 at 150%, offset up by 240
    static readonly Display Main = new(new(0, 0, 2560, 1440), new(0, 0, 2560, 1392), 1);
    static readonly Display Portrait150 = new(new(2560, -240, 1200, 1920), new(2560, -240, 1200, 1872), 1.5);

    [Fact]
    public void A_window_on_a_screen_is_reachable() => Assert.True(WindowPlacement.Reachable(new Rect(100, 100, 1360, 860), Screens));

    [Fact]
    public void A_title_bar_with_only_a_pixel_or_two_showing_is_not_reachable()
    {
        // Touching the bounding box of the whole virtual desktop used to count as being on screen
        Assert.False(WindowPlacement.Reachable(new Rect(-1359, 100, 1360, 860), Screens));
        Assert.False(WindowPlacement.Reachable(new Rect(100, 1039, 1360, 860), Screens));
    }

    [Fact]
    public void A_window_in_the_blank_region_left_by_staggered_screens_is_not_reachable()
    {
        // The region above the right screen (1920..3200 × 0..200) is inside the bounding box but on no screen
        Assert.False(WindowPlacement.Reachable(new Rect(2100, 20, 900, 600), Screens));
    }

    [Fact]
    public void Spanning_two_screens_with_part_of_the_title_bar_on_a_screen_is_reachable() => Assert.True(WindowPlacement.Reachable(new Rect(1800, 300, 1000, 700), Screens));

    // Restoring a remembered window: if it is larger than the work area of the screen holding its title bar, it is shrunk to fit

    [Fact]
    public void A_window_that_fits_is_left_as_it_is() => Assert.Equal(new Rect(100, 100, 1360, 860), WindowPlacement.Fit(new Rect(100, 100, 1360, 860), Screens, Min));

    [Fact]
    public void A_window_that_fits_and_deliberately_extends_a_little_past_the_edge_is_left_alone_too() =>
        Assert.Equal(new Rect(1200, 100, 1360, 860), WindowPlacement.Fit(new Rect(1200, 100, 1360, 860), Screens, Min));

    [Fact]
    public void A_window_larger_than_the_screen_is_shrunk_to_the_work_area_and_moved_in() =>
        Assert.Equal(new Rect(0, 0, 1920, 1040), WindowPlacement.Fit(new Rect(100, 100, 6000, 4000), Screens, Min));

    [Fact]
    public void A_window_that_is_merely_too_wide_is_narrowed_within_the_right_screen_holding_its_title_bar_with_its_left_edge_at_the_screen_edge() =>
        Assert.Equal(new Rect(1920, 250, 1280, 700), WindowPlacement.Fit(new Rect(2000, 250, 1600, 700), Screens, Min));

    [Fact]
    public void A_screen_smaller_than_the_minimum_size_gets_the_whole_work_area_and_nothing_extends_off_screen() =>
        Assert.Equal(new Rect(0, 0, 800, 500), WindowPlacement.Fit(new Rect(0, 0, 1360, 860), [At(new Rect(0, 0, 800, 500))], Min));

    // Coordinates and sizes are always physical pixels, converted with the scale of the screen the window is on
    // (they used to use the primary screen's scale, which put the window off screen when the secondary screen's scale differed)

    [Fact]
    public void Default_layout_on_a_100_percent_primary_screen_is_80_percent_wide_and_85_percent_tall_of_the_work_area_centered() =>
        Assert.Equal((new Rect(320, 104, 1920, 1183), false), WindowPlacement.DefaultOn(Main, Min));

    [Fact]
    public void Default_layout_on_a_200_percent_primary_screen_is_computed_in_DIP_then_converted_to_physical_pixels_and_is_not_larger_than_the_screen()
    {
        // Using the system scale at sign-in (100%) gave 1920 × 1183 DIP, which became 3840 × 2366 on a 200% screen, larger than the screen
        var main200 = Main with { Scale = 2 };
        var (rect, maximize) = WindowPlacement.DefaultOn(main200, Min);
        Assert.Equal(new Rect(256, 96, 2048, 1200), rect); // 80% × 85% of 1280 × 696 DIP = 1024 × 592, and the height is at least 600
        Assert.False(maximize);
    }

    [Fact]
    public void Default_layout_on_a_150_percent_secondary_screen_narrower_than_the_minimum_fills_its_work_area_maximized_and_stays_on_screen()
    {
        // A 1200-wide portrait screen at 150% is only 800 DIP wide, narrower than the minimum width of 960.
        // Restoring the default layout used to put the window's left edge at x=4020 (beyond the right edge of the secondary screen)
        var (rect, maximize) = WindowPlacement.DefaultOn(Portrait150, Min);
        Assert.Equal(new Rect(2560, -240 + (1872 - 1592) / 2, 1200, 1592), rect); // height: 85% of 1248 DIP ≈ 1061 DIP = 1592 pixels
        Assert.True(maximize);
        Assert.True(Portrait150.Work.Contains(rect));
    }

    [Fact]
    public void Minimum_size_is_normally_960x600_and_follows_the_screen_when_the_screen_is_smaller()
    {
        Assert.Equal(new Size(960, 600), WindowPlacement.MinSizeOn(Main, Min));
        Assert.Equal(new Size(800, 600), WindowPlacement.MinSizeOn(Portrait150, Min));
        Assert.Equal(new Size(640, 348), WindowPlacement.MinSizeOn(Main with { Scale = 4 }, Min));
    }

    [Fact]
    public void A_remembered_window_wider_than_a_150_percent_secondary_screen_is_shrunk_into_it()
    {
        // Before exit it was on the secondary screen, 1440 pixels wide (= 960 DIP × 1.5), while that screen is only 1200 wide:
        // after reopening it used to stick out 360 on the right
        var r = WindowPlacement.Fit(new Rect(2680, -200, 1440, 1100), [Main, Portrait150], Min);
        Assert.True(Portrait150.Work.Contains(r), r.ToString(System.Globalization.CultureInfo.InvariantCulture));
        Assert.Equal(1200, r.Width);
    }

    [Fact]
    public void Reachability_uses_the_title_bar_height_at_that_screens_scale()
    {
        // On a 150% screen the title bar is 60 pixels high: with the window's top edge 25 pixels above the bottom of the work area
        // (y = 1632), less than 20 DIP (30 pixels) shows
        Assert.False(WindowPlacement.Reachable(new Rect(2700, 1632 - 25, 1000, 800), [Portrait150]));
        Assert.True(WindowPlacement.Reachable(new Rect(2700, 1632 - 40, 1000, 800), [Portrait150]));
    }

    [Fact]
    public void On_open_with_no_remembered_position_the_default_layout_is_used_on_the_screen_under_the_mouse()
    {
        var (rect, maximize) = new WindowPlacement().Target([Main, Portrait150], Portrait150, Min);
        Assert.True(Portrait150.Work.Contains(rect));
        Assert.True(maximize);
    }

    [Fact]
    public void On_open_a_reachable_remembered_position_is_restored_and_maximized_as_remembered()
    {
        var saved = new WindowPlacement { Left = 120, Top = 80, Width = 1200, Height = 760, Maximized = true };
        Assert.Equal((new Rect(120, 80, 1200, 760), true), saved.Target([Main, Portrait150], Portrait150, Min));
    }

    [Fact]
    public void When_maximized_the_edge_with_an_auto_hide_taskbar_leaves_2_pixels_free()
    {
        var client = new Native.RECT { Left = 0, Top = 0, Right = 2560, Bottom = 1440 };
        var bottom = MainWindow.LeaveAutoHideRoom(client, (false, false, false, true));
        Assert.Equal((0, 0, 2560, 1438), (bottom.Left, bottom.Top, bottom.Right, bottom.Bottom));
        var none = MainWindow.LeaveAutoHideRoom(client, (false, false, false, false));
        Assert.Equal((0, 0, 2560, 1440), (none.Left, none.Top, none.Right, none.Bottom));
        var leftTop = MainWindow.LeaveAutoHideRoom(client, (true, true, false, false));
        Assert.Equal((2, 2, 2560, 1440), (leftTop.Left, leftTop.Top, leftTop.Right, leftTop.Bottom));
    }

    static Settings WithPrefs(string json) => new() { Prefs = JsonNode.Parse(json) as JsonObject };

    [Fact]
    public void Item_types_with_no_stored_settings_list_images_and_videos_but_not_PDF_or_PPT() =>
        Assert.Equal(["image", "video"], WithPrefs("{}").EnabledKinds.Order());

    [Fact]
    public void Item_types_missing_from_the_settings_use_the_default_like_the_UI()
    {
        // The shell used to treat a missing kind as off: the UI showed it enabled while the scan did not list it
        Assert.Equal(["image", "video"], WithPrefs("""{"kinds":{"pdf":false}}""").EnabledKinds.Order());
        Assert.Equal(["image", "pdf"], WithPrefs("""{"kinds":{"video":false,"pdf":true}}""").EnabledKinds.Order());
    }

    [Fact]
    public void Item_types_with_a_non_boolean_value_use_the_default() =>
        Assert.Equal(["image", "video"], WithPrefs("""{"kinds":{"image":"yes","slides":1}}""").EnabledKinds.Order());

    [Fact]
    public void More_formats_off_by_default_only_true_turns_it_on_and_adds_the_more_kind()
    {
        Assert.False(WithPrefs("{}").MoreFormats);
        Assert.False(WithPrefs("""{"moreFormats":"yes"}""").MoreFormats);
        Assert.False(WithPrefs("""{"moreFormats":false}""").MoreFormats);
        var on = WithPrefs("""{"moreFormats":true}""");
        Assert.True(on.MoreFormats);
        Assert.Equal(["image", MaterialScanner.MoreKind, "video"], on.EnabledKinds.Order());
        // "more" written into kinds by hand doesn't count: only the setting does
        Assert.DoesNotContain(MaterialScanner.MoreKind, WithPrefs("""{"kinds":{"more":true}}""").EnabledKinds);
    }

    [Fact]
    public void The_few_settings_the_shell_reads_default_to_the_same_values_as_the_UI_when_not_stored()
    {
        // The UI writes only changed items to the settings file (storedPrefs in prefs.ts), and the shell uses the same defaults for the rest
        var s = WithPrefs("{}");
        Assert.Equal("#ff6a3d", s.MarkColor);
        Assert.Equal("change", s.DefaultCategory);
        Assert.Equal("", s.PromptExtra);
        Assert.Equal(MaterialScanner.DefaultSkipDirs.Order(), s.SkipDirs.Order());
    }

    [Fact]
    public void Mark_color_accepts_only_a_hash_plus_six_hex_digits_like_the_UI()
    {
        // Screen Capture reads it. The UI accepts only #rrggbb and falls back to the default orange for anything else;
        // the shell used to pass the value through, so a hand-edited "red" gave an orange main window and red marks in Screen Capture
        Assert.Equal("#ff4d6d", WithPrefs("""{"markColor":"#ff4d6d"}""").MarkColor);
        Assert.Equal("#FF4D6D", WithPrefs("""{"markColor":"#FF4D6D"}""").MarkColor);
        foreach (var bad in new[] { "red", "#fff", "#80ff0000", "#ff6a3d ", "" })
            Assert.Equal("#ff6a3d", WithPrefs($$"""{"markColor":"{{bad}}"}""").MarkColor);
    }

    [Fact]
    public void Maximize_button_state_follows_what_a_minimized_window_will_restore_to_and_full_screen_does_not_count_as_maximized()
    {
        Assert.True(MainWindow.ShowsMaximized(WindowState.Maximized, false, false));
        Assert.False(MainWindow.ShowsMaximized(WindowState.Normal, false, true));
        // A maximized window that was minimized comes back maximized from the taskbar, so the button must keep showing "Restore"
        Assert.True(MainWindow.ShowsMaximized(WindowState.Minimized, false, true));
        Assert.False(MainWindow.ShowsMaximized(WindowState.Minimized, false, false));
        Assert.False(MainWindow.ShowsMaximized(WindowState.Maximized, true, true));
        Assert.False(MainWindow.ShowsMaximized(WindowState.Minimized, true, true));
    }

    [Fact]
    public void Window_title_is_item_name_plus_product_name_when_an_item_is_open_and_just_the_product_name_otherwise_or_when_the_UI_set_no_title()
    {
        Assert.Equal("hero.png - 超级批注", MainWindow.WindowTitle("hero.png"));
        Assert.Equal("超级批注", MainWindow.WindowTitle("超级批注"));
        Assert.Equal("超级批注", MainWindow.WindowTitle(""));
        Assert.Equal("超级批注", MainWindow.WindowTitle(null));
        // When the UI has not set a title (the load failed) WebView2 reports the URL
        Assert.Equal("超级批注", MainWindow.WindowTitle("app.sniptoss.example/index.html"));
    }
}
