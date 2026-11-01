using System.IO;
using System.Text.Json.Nodes;
using System.Windows.Media;
using SnipToss.App;
using SnipToss.App.Capture;

namespace AppTests;

/// <summary>Colors: #rrggbb text, the picker's HSV, which colors get dark numbers, and the recent custom colors kept in the settings</summary>
public class ColorMathTests
{
    [Theory]
    [InlineData("#17a998", 0x17, 0xa9, 0x98)]
    [InlineData("17A998", 0x17, 0xa9, 0x98)]
    [InlineData("  #FFFFFF ", 0xff, 0xff, 0xff)]
    public void Parse_accepts_six_hex_digits_with_or_without_hash(string text, byte r, byte g, byte b)
    {
        Assert.Equal(Color.FromRgb(r, g, b), ColorMath.Parse(text));
        Assert.Equal($"#{r:x2}{g:x2}{b:x2}", ColorMath.Hex(Color.FromRgb(r, g, b)));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("#fff")]
    [InlineData("#12345g")]
    [InlineData("#1234567")]
    [InlineData("red")]
    public void Parse_rejects_anything_else(string? text) => Assert.Null(ColorMath.Parse(text));

    [Fact]
    public void Every_color_survives_the_trip_through_HSV()
    {
        // The picker shows a color as hue / saturation / value and hands back RGB: a color must come back exactly as it went in
        var rnd = new Random(7);
        for (var i = 0; i < 2000; i++)
        {
            var c = Color.FromRgb((byte)rnd.Next(256), (byte)rnd.Next(256), (byte)rnd.Next(256));
            var (h, s, v) = ColorMath.ToHsv(c);
            Assert.Equal(c, ColorMath.FromHsv(h, s, v));
        }
        Assert.Equal(Colors.Red, ColorMath.FromHsv(360, 1, 1)); // the end of the hue strip is red again
    }

    [Fact]
    public void Which_colors_get_dark_numbers_is_the_same_as_in_the_main_app()
    {
        var colors = JsonNode.Parse(File.ReadAllText(TestSupport.GoldenFile("light-colors.json")))!["colors"]!.AsObject();
        Assert.NotEmpty(colors);
        foreach (var (hex, light) in colors) Assert.True(light!.GetValue<bool>() == ColorMath.IsLight(ColorMath.Parse(hex)!.Value), hex);
    }

    [Fact]
    public void A_picked_custom_color_goes_first_without_repeats_presets_or_more_than_four_and_survives_a_restart()
    {
        using var dir = new TempDir();
        var path = dir.File("settings.json");
        var s = Settings.LoadFrom(path);
        var changed = 0;
        s.RecentColorsChanged += () => changed++;
        foreach (var c in new[] { "#111111", "#222222", "#333333", "#444444", "#555555" }) s.AddRecentColor(c);
        Assert.Equal(["#555555", "#444444", "#333333", "#222222"], s.RecentColorList);
        s.AddRecentColor("#333333"); // picked again: moves to the front
        Assert.Equal(["#333333", "#555555", "#444444", "#222222"], s.RecentColorList);
        s.AddRecentColor(" #FF6A3D "); // a preset color: the row already has it
        s.AddRecentColor("#333333"); // already first: nothing changes
        Assert.Equal(6, changed);
        Assert.Equal(["#333333", "#555555", "#444444", "#222222"], Settings.LoadFrom(path).RecentColorList);
        Assert.Throws<ArgumentException>(() => s.AddRecentColor("blue"));
    }

    [Fact]
    public void Recent_colors_from_a_hand_edited_file_are_cleaned_up()
    {
        using var dir = new TempDir();
        var path = dir.File("settings.json");
        File.WriteAllText(path, """{ "RecentColors": ["#ABCDEF", "nope", "#abcdef", "#ffffff", "#123456", null, "#000001", "#000002", "#000003"] }""");
        Assert.Equal(["#abcdef", "#123456", "#000001", "#000002"], Settings.LoadFrom(path).RecentColorList);
    }

    [Fact]
    public void The_capture_color_is_kept_only_while_the_setting_it_was_chosen_over_still_applies()
    {
        var prefs = new ToolPrefs();
        var orange = ToolPrefs.Colors[0];
        var teal = Color.FromRgb(0x17, 0xa9, 0x98);
        prefs.Restore(teal, orange); // kept from the last run, chosen while the setting was orange
        prefs.Start(orange);
        Assert.Equal(teal, prefs.Color);
        Assert.Equal(orange, prefs.ChosenOver);
        prefs.Start(ToolPrefs.Colors[4]); // the setting has changed since: the setting wins
        Assert.Equal(ToolPrefs.Colors[4], prefs.Color);
        Assert.Null(prefs.ChosenOver);
    }
}
