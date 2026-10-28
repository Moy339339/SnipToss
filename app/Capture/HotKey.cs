using System.Runtime.InteropServices;
using System.Windows.Input;
using System.Windows.Interop;
using static SnipToss.App.Native;

namespace SnipToss.App.Capture;

/// <summary>
/// Global shortcut (RegisterHotKey): works while the app is in the background and another program is in front.
/// The text format matches the UI: "Ctrl+Alt+P", "Ctrl+Shift+F1", "Alt+PrintScreen"
/// </summary>
sealed class GlobalHotKey : IDisposable
{
    const int Id = 1;
    readonly HwndSource window;
    bool registered;

    public GlobalHotKey(Action onPressed)
    {
        // An invisible message-only window
        window = new HwndSource(new HwndSourceParameters("SnipToss-hotkey") { ParentWindow = new IntPtr(-3) /* HWND_MESSAGE */, WindowStyle = 0 });
        window.AddHook((IntPtr _, int msg, IntPtr wParam, IntPtr _, ref bool handled) =>
        {
            if (msg == 0x0312 /* WM_HOTKEY */ && wParam.ToInt32() == Id)
            {
                handled = true;
                onPressed();
            }
            return IntPtr.Zero;
        });
    }

    /// <summary>The shortcut currently in effect (successfully registered); null if none</summary>
    public string? Current { get; private set; }

    /// <summary>
    /// Switch to this shortcut; empty = none. Returns null on success, otherwise the reason to show the user.
    /// If the switch fails (malformed, already taken) the previous shortcut stays in effect (the old one used to be unregistered first, so a failed new registration left none at all)
    /// </summary>
    public string? Set(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            Clear();
            return null;
        }
        if (!TryParse(text, out var mods, out var vk)) return Locale.T("shell.hotkey.invalid", ("keys", Pretty(text)));
        // Needs Ctrl, Alt or Win; Shift alone may only go with keys such as F keys and PrintScreen that typing and text selection do not use: once Shift+A is registered as a global shortcut,
        // no program can type a capital A; Shift+← could not extend a selection and Shift+Insert could not paste. The UI blocks the same combinations when recording a shortcut
        if ((mods & ~ShiftMod) == 0 && (mods == 0 || UsedForText(vk))) return Locale.T("shell.hotkey.shiftOnly");
        var old = Current;
        Clear();
        if (!Register(mods, vk))
        {
            if (old is not null && TryParse(old, out var oldMods, out var oldVk) && Register(oldMods, oldVk)) Current = old;
            return Locale.T("shell.hotkey.taken", ("keys", Pretty(text)));
        }
        Current = text;
        return null;
    }

    const uint ShiftMod = 0x4;

    /// <summary>Keys used for typing and selecting text (virtual-key codes): digits, letters, space, numpad digits, arrow keys, Home / End, PageUp / PageDown, Insert</summary>
    internal static bool UsedForText(uint vk) => vk is >= 0x30 and <= 0x5A or 0x20 or >= 0x60 and <= 0x69 or >= 0x21 and <= 0x28 or 0x2D;

    bool Register(uint mods, uint vk) => registered = RegisterHotKey(window.Handle, Id, mods | 0x4000 /* MOD_NOREPEAT */, vk);

    void Clear()
    {
        if (registered) UnregisterHotKey(window.Handle, Id);
        registered = false;
        Current = null;
    }

    public void Dispose()
    {
        Clear();
        window.Dispose();
    }

#if TEST_HOOKS
    /// <summary>Test entry point (TestHooks): posts the same "shortcut pressed" message the system sends (no real key press needed)</summary>
    internal void PostPressed() => PostMessage(window.Handle, 0x0312 /* WM_HOTKEY */, Id, IntPtr.Zero);

    [DllImport("user32.dll")]
    static extern bool PostMessage(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam);
#endif

    /// <summary>"Ctrl+Alt+P" → modifier bits + virtual-key code</summary>
    public static bool TryParse(string text, out uint mods, out uint vk)
    {
        mods = 0;
        vk = 0;
        foreach (var raw in text.Split('+', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
        {
            switch (raw.ToLowerInvariant())
            {
                case "ctrl" or "control":
                    mods |= 0x2;
                    continue;
                case "alt":
                    mods |= 0x1;
                    continue;
                case "shift":
                    mods |= 0x4;
                    continue;
                case "win" or "meta":
                    mods |= 0x8;
                    continue;
            }
            if (vk != 0) return false; // only one main key is allowed
            var name = raw.Length == 1 && char.IsDigit(raw[0]) ? "D" + raw : raw switch
            {
                "PrintScreen" or "PrtSc" => "Snapshot",
                _ => raw,
            };
            if (!Enum.TryParse<Key>(name, true, out var key)) return false;
            vk = (uint)KeyInterop.VirtualKeyFromKey(key);
        }
        return vk != 0;
    }

    /// <summary>The human-readable form, same as shortcuts elsewhere in the UI: "Ctrl Alt A" (space-separated, no plus signs)</summary>
    public static string Pretty(string text) =>
        string.Join(" ", text.Split('+', StringSplitOptions.TrimEntries).Select(k => KeycapNames.Contains(k) ? Locale.T($"keycap.{k}") : k));

    /// <summary>Key names follow the UI language (messages keycap.*, same as keycaps in the UI's hotkey.ts: German Strg, Umschalt, French Maj, ...); letters and F keys are left as they are</summary>
    static readonly HashSet<string> KeycapNames = ["Ctrl", "Shift", "Enter", "Esc", "Delete", "Backspace", "Space", "Home", "End"];

    /// <summary>
    /// Whether this key combination types a character in any installed keyboard layout: if so, returns the typed characters (such as "ą"; space-separated when layouts differ), otherwise "".
    /// Windows treats AltGr as Ctrl+Alt: on Polish and similar layouts AltGr+A types ą, so once Ctrl+Alt+A is registered as a global shortcut those users can no longer type it
    /// </summary>
    public static string TypedChars(string text) => TryParse(text, out var mods, out var vk) ? TypedChars(mods, vk) : "";

    internal static string TypedChars(uint mods, uint vk)
    {
        // Only a combination with both Ctrl and Alt and without Win is AltGr
        if ((mods & 0x3) != 0x3 || (mods & 0x8) != 0) return "";
        var state = new byte[256];
        state[0x11] = state[0xA2] = 0x80; // Ctrl, left Ctrl
        state[0x12] = state[0xA5] = 0x80; // Alt, right Alt (AltGr)
        if ((mods & ShiftMod) != 0) state[0x10] = state[0xA0] = 0x80;
        var layouts = new IntPtr[Math.Max(GetKeyboardLayoutList(0, null), 0)];
        var count = GetKeyboardLayoutList(layouts.Length, layouts);
        var typed = new List<string>();
        var buf = new char[8];
        foreach (var layout in layouts.Take(count))
        {
            // 0x4: leave the keyboard state untouched, otherwise looking up a dead key would swallow the next key the user presses; a dead key returns -1 and still counts as typing
            var n = ToUnicodeEx(vk, MapVirtualKeyEx(vk, 0 /* MAPVK_VK_TO_VSC */, layout), state, buf, buf.Length, 0x4, layout);
            var s = new string(buf, 0, Math.Min(Math.Abs(n), buf.Length));
            if (s.Any(c => c >= 0x20) && !typed.Contains(s)) typed.Add(s);
        }
        return string.Join(" ", typed);
    }

    /// <summary>When the default shortcut would type a character, these are tried in turn: PrintScreen types nothing, so it clashes with no keyboard layout</summary>
    public static readonly string[] Fallbacks = ["Shift+PrintScreen", "Ctrl+PrintScreen", "Ctrl+Shift+PrintScreen"];

    /// <summary>The first one that types nothing and can be registered; "" if none works (no shortcut; record another in Settings)</summary>
    internal static string PickFallback(Func<string, string> typed, Func<string, bool> register) =>
        Fallbacks.FirstOrDefault(k => typed(k).Length == 0 && register(k)) ?? "";

}
