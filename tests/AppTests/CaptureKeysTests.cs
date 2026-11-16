using System.Text.Json.Nodes;
using System.Windows.Input;
using SnipToss.App.Capture;
using Xunit;

namespace AppTests;

/// <summary>
/// The capture overlay's changeable keys (CaptureKeys): key presses named as the UI names them (keys.ts keyName), the keys changed in
/// Settings → Keyboard Shortcuts, and the toolbar tooltips that show them. The default keys are compared with the UI's command table in
/// packages/web/test/commands.test.ts
/// </summary>
public class CaptureKeysTests
{
    /// <summary>A US layout: the symbol keys that the tests press</summary>
    static string? Us(Key key, bool shift) =>
        key switch
        {
            Key.OemComma => shift ? "<" : ",",
            Key.OemQuestion => shift ? "?" : "/",
            Key.OemOpenBrackets => shift ? "{" : "[",
            Key.OemPlus => shift ? "+" : "=",
            _ => null,
        };

    static string? Name(Key key, ModifierKeys mods = ModifierKeys.None) => CaptureKeys.NameOf(key, mods, Us);

    [Fact]
    public void Key_presses_are_named_as_the_UI_names_them()
    {
        Assert.Equal("R", Name(Key.R));
        Assert.Equal("Shift+R", Name(Key.R, ModifierKeys.Shift));
        Assert.Equal("Ctrl+Z", Name(Key.Z, ModifierKeys.Control));
        Assert.Equal("Ctrl+Shift+Z", Name(Key.Z, ModifierKeys.Control | ModifierKeys.Shift));
        Assert.Equal("Ctrl+Alt+B", Name(Key.B, ModifierKeys.Control | ModifierKeys.Alt));
        Assert.Equal("F5", Name(Key.F5));
        Assert.Equal("Shift+ArrowLeft", Name(Key.Left, ModifierKeys.Shift));
        Assert.Equal("Escape", Name(Key.Escape));
        Assert.Equal("Space", Name(Key.Space));
    }

    [Fact]
    public void Digit_keys_go_by_position_and_symbols_by_the_character_they_type()
    {
        Assert.Equal("1", Name(Key.D1));
        Assert.Equal("Shift+1", Name(Key.D1, ModifierKeys.Shift));
        Assert.Equal("1", Name(Key.NumPad1));
        // A symbol typed with Shift is named by the symbol, Shift included in it
        Assert.Equal("?", Name(Key.OemQuestion, ModifierKeys.Shift));
        Assert.Equal(",", Name(Key.OemComma));
        Assert.Equal("Ctrl+=", Name(Key.OemPlus, ModifierKeys.Control));
        Assert.Equal("[", Name(Key.OemOpenBrackets));
        // A key alone that types nothing (a modifier) is no shortcut
        Assert.Null(Name(Key.LeftShift, ModifierKeys.Shift));
    }

    [Fact]
    public void Defaults_until_changed_and_a_changed_command_has_only_its_new_keys()
    {
        Assert.Equal("capture.rect", CaptureKeys.Default.CommandOf("R"));
        Assert.Equal("capture.undo", CaptureKeys.Default.CommandOf("Ctrl+Z"));
        Assert.Null(CaptureKeys.Default.CommandOf("Q"));
        var keys = CaptureKeys.From(JsonNode.Parse("""{ "capture.rect": ["Q", "Shift+R"], "capture.undo": [], "file.addFiles": ["R"] }"""));
        Assert.Equal("capture.rect", keys.CommandOf("Q"));
        Assert.Equal("capture.rect", keys.CommandOf("Shift+R"));
        Assert.Null(keys.CommandOf("R"));
        Assert.Null(keys.CommandOf("Ctrl+Z"));
        Assert.Equal("capture.ellipse", keys.CommandOf("O"));
    }

    [Fact]
    public void Anything_unreadable_in_the_settings_leaves_the_defaults()
    {
        var keys = CaptureKeys.From(JsonNode.Parse("""{ "capture.rect": "Q", "capture.pen": [1, "P"] }"""));
        Assert.Equal("capture.rect", keys.CommandOf("R"));
        Assert.Equal("capture.pen", keys.CommandOf("P"));
        Assert.Equal("capture.rect", CaptureKeys.From(JsonNode.Parse("[]")).CommandOf("R"));
    }

    [Fact]
    public void Tooltips_show_the_first_key_the_way_the_language_writes_it_and_no_key_when_there_is_none()
    {
        Assert.Equal("矩形（R）", CaptureKeys.Default.Tip("矩形", "capture.rect"));
        Assert.Equal("撤销（Ctrl Z）", CaptureKeys.Default.Tip("撤销", "capture.undo"));
        var keys = CaptureKeys.From(JsonNode.Parse("""{ "capture.rect": ["Ctrl++"], "capture.undo": [], "capture.arrow": ["Shift+ArrowLeft"] }"""));
        Assert.Equal("矩形（Ctrl +）", keys.Tip("矩形", "capture.rect"));
        Assert.Equal("箭头（Shift ←）", keys.Tip("箭头", "capture.arrow"));
        Assert.Equal("撤销", keys.Tip("撤销", "capture.undo"));
    }

    [Fact]
    public void Key_names_split_into_their_parts_without_losing_the_plus_key()
    {
        Assert.Equal(["Ctrl", "+"], CaptureKeys.Parts("Ctrl++"));
        Assert.Equal(["+"], CaptureKeys.Parts("+"));
        Assert.Equal(["Ctrl", "Shift", "O"], CaptureKeys.Parts("Ctrl+Shift+O"));
    }
}
