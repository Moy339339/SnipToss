using System.Text.Json;
using System.Text.Json.Nodes;
using System.Windows.Input;
using static SnipToss.App.Native;

namespace SnipToss.App.Capture;

/// <summary>
/// The overlay's keys that can be changed in Settings → Keyboard Shortcuts. The settings keep them in the UI's prefs as keybindings: command id →
/// key names, only for the changed commands. The ids and default keys here are those of the command table in packages/web/src/commands.ts
/// (commands.test.ts compares the two); key names are written as the UI writes them: "R", "Ctrl+Z", "Shift+1", "?".
/// The keys that cannot be changed (Esc, Enter, Delete, 1–8, the arrow keys) stay in <see cref="OverlayStateMachine.Press"/>
/// </summary>
sealed class CaptureKeys
{
    /// <summary>The overlay's commands that can be changed, with their default keys</summary>
    internal static readonly (string Id, string[] Keys)[] Defaults =
    [
        ("capture.rect", ["R"]),
        ("capture.ellipse", ["O"]),
        ("capture.arrow", ["A"]),
        ("capture.pen", ["B"]),
        ("capture.mosaic", ["M"]),
        ("capture.text", ["T"]),
        ("capture.point", ["C"]),
        ("capture.whole", ["N"]),
        ("capture.undo", ["Ctrl+Z"]),
    ];

    readonly Dictionary<string, string[]> keys;

    CaptureKeys(Dictionary<string, string[]> keys) => this.keys = keys;

    /// <summary>Every command with its default keys (nothing changed)</summary>
    public static readonly CaptureKeys Default = From(null);

    /// <summary>The keys under the changed ones in the settings (prefs.keybindings); a command that is not listed, or not a list of names, keeps its defaults</summary>
    public static CaptureKeys From(JsonNode? bindings)
    {
        var map = new Dictionary<string, string[]>(StringComparer.Ordinal);
        foreach (var (id, defaults) in Defaults)
            map[id] = (bindings as JsonObject)?[id] is JsonArray list
                ? [.. list.Where(x => x?.GetValueKind() == JsonValueKind.String).Select(x => x!.GetValue<string>())]
                : defaults;
        return new CaptureKeys(map);
    }

    /// <summary>The command this key runs on the overlay (a key name as <see cref="NameOf"/> gives it); null when none</summary>
    public string? CommandOf(string? name)
    {
        if (name is null) return null;
        foreach (var (id, _) in Defaults)
            if (keys[id].Contains(name, StringComparer.Ordinal)) return id;
        return null;
    }

    /// <summary>A command's first key the way people read it ("Ctrl Z", with the language's key names); "" when it has none</summary>
    public string Hint(string id) => keys.TryGetValue(id, out var k) && k.Length > 0 ? Pretty(k[0]) : "";

    /// <summary>A toolbar tooltip: the name with the command's key, written the way the language writes it ("Rectangle (R)"); the name alone when the command has no key</summary>
    public string Tip(string name, string id) => Hint(id) is { Length: > 0 } key ? Locale.T("capture.tip.withKey", ("label", name), ("key", key)) : name;

    /// <summary>The parts of a key name: "Ctrl++" → Ctrl, + (splitting at every plus would lose the plus key)</summary>
    internal static List<string> Parts(string name)
    {
        if (name == "+") return ["+"];
        var parts = name.Split('+').ToList();
        if (name.EndsWith("++", StringComparison.Ordinal))
        {
            parts.RemoveRange(parts.Count - 2, 2);
            parts.Add("+");
        }
        return parts;
    }

    static readonly Dictionary<string, string> Arrows = new(StringComparer.Ordinal)
    {
        ["ArrowUp"] = "↑",
        ["ArrowDown"] = "↓",
        ["ArrowLeft"] = "←",
        ["ArrowRight"] = "→",
        ["Escape"] = "Esc",
    };

    /// <summary>A key name as people read it: space-separated, arrows as symbols, key names in the language (same as keycaps in the UI's hotkey.ts)</summary>
    internal static string Pretty(string name) => string.Join(" ", Parts(name).Select(p => GlobalHotKey.Keycap(Arrows.GetValueOrDefault(p, p))));

    /// <summary>
    /// A key press as the UI names it (keyName in packages/web/src/keys.ts, on Windows): the modifiers Ctrl, Alt, Shift in that order, then the key.
    /// Letters in upper case; the digit keys by position, also with Shift ("Shift+1"); a symbol by the character it types on the current
    /// keyboard layout, Shift included in it ("?" rather than "Shift+/"); named keys by their web names (ArrowLeft, Escape, Backspace).
    /// typed: the character a key types (tests give their own; otherwise the current layout); null = not a key a shortcut can use
    /// </summary>
    public static string? NameOf(Key key, ModifierKeys mods, Func<Key, bool, string?>? typed = null)
    {
        // The Windows key counts as Ctrl, as in the UI (metaKey)
        var ctrl = (mods & (ModifierKeys.Control | ModifierKeys.Windows)) != 0;
        var alt = mods.HasFlag(ModifierKeys.Alt);
        var shift = mods.HasFlag(ModifierKeys.Shift);
        var byPosition = false;
        string? name;
        if (key is >= Key.A and <= Key.Z) name = ((char)('A' + (key - Key.A))).ToString();
        else if (key is >= Key.D0 and <= Key.D9 && (shift || !(ctrl || alt)))
        {
            name = ((char)('0' + (key - Key.D0))).ToString();
            byPosition = true;
        }
        else if (key is >= Key.NumPad0 and <= Key.NumPad9) name = ((char)('0' + (key - Key.NumPad0))).ToString();
        else if (key is >= Key.F1 and <= Key.F24) name = $"F{key - Key.F1 + 1}";
        else
            name = key switch
            {
                Key.Space => "Space",
                Key.Enter => "Enter",
                Key.Escape => "Escape",
                Key.Tab => "Tab",
                Key.Back => "Backspace",
                Key.Delete => "Delete",
                Key.Insert => "Insert",
                Key.Home => "Home",
                Key.End => "End",
                Key.PageUp => "PageUp",
                Key.PageDown => "PageDown",
                Key.Left => "ArrowLeft",
                Key.Right => "ArrowRight",
                Key.Up => "ArrowUp",
                Key.Down => "ArrowDown",
                Key.Add => "+",
                Key.Subtract => "-",
                Key.Multiply => "*",
                Key.Divide => "/",
                Key.Decimal => ".",
                _ => (typed ?? TypedOnLayout)(key, shift)?.ToUpperInvariant(),
            };
        if (name is null) return null;
        var printable = name.Length == 1;
        var parts = new List<string>(4);
        if (ctrl) parts.Add("Ctrl");
        if (alt) parts.Add("Alt");
        if (shift && (byPosition || !printable || char.IsAsciiLetterUpper(name[0]))) parts.Add("Shift");
        parts.Add(name);
        return string.Join("+", parts);
    }

    /// <summary>The character a key types on the keyboard layout in use (with Shift held or not); null for a key that types nothing or a dead key</summary>
    static string? TypedOnLayout(Key key, bool shift)
    {
        var vk = (uint)KeyInterop.VirtualKeyFromKey(key);
        if (vk == 0) return null;
        var state = new byte[256];
        if (shift) state[0x10] = state[0xA0] = 0x80;
        var layout = GetKeyboardLayout(0);
        var buf = new char[8];
        // 0x4: leave the keyboard state untouched (a dead key looked up would otherwise swallow the next key typed)
        var n = ToUnicodeEx(vk, MapVirtualKeyEx(vk, 0 /* MAPVK_VK_TO_VSC */, layout), state, buf, buf.Length, 0x4, layout);
        return n == 1 && buf[0] >= 0x20 ? buf[0].ToString() : null;
    }
}
