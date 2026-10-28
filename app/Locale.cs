using System.Collections.Concurrent;
using System.Globalization;
using System.Text.Json;

namespace SnipToss.App;

/// <summary>
/// Message catalog (i18n/locales/&lt;language&gt;.json, ICU MessageFormat): the shell and the UI read the same files, compiled into the program (EmbeddedResource in the csproj).
/// The language is chosen by the same rules as the UI (resolveLocale in packages/web/src/i18n.tsx; the golden file tests/golden/locale.json checks both sides):
/// the one chosen in Settings (Prefs.language) wins, and "follow system" looks at the Windows display language. A settings change takes effect at once (Use); resident parts such as the tray listen to Changed,
/// while the capture overlay and error windows are in the new language the next time they open. Placeholders, plurals and selects are formatted by MessageFormat.NET (docs/adr/0001-i18n.md)
/// </summary>
static class Locale
{
    public const string Source = "zh-CN";

    /// <summary>Fills in missing messages (ADR-0001 item 4: a secondary language falls back to English for missing messages)</summary>
    const string Fallback = "en";

    /// <summary>Supported languages (same as LOCALES in i18n.tsx)</summary>
    public static readonly string[] All = ["zh-CN", "zh-TW", "en", "ja", "ko", "fr", "de", "es", "it", "pt-BR", "ru"];

    /// <summary>What "follow system" can pick: the languages the whole app is translated into (same as SYSTEM_LOCALES in i18n.tsx, which says why)</summary>
    public static readonly string[] FollowSystem = All;

    /// <summary>Maps the language tag the system gives (zh-Hans-CN, zh-HK, pt-PT, en-GB…) to a supported language (ADR-0001 item 5, same as matchLocale in i18n.tsx)</summary>
    public static string Match(string? tag)
    {
        var t = (tag ?? "").ToLowerInvariant();
        if (t == "zh" || t.StartsWith("zh-", StringComparison.Ordinal))
            return t.Contains("hant", StringComparison.Ordinal) || t.Contains("-tw", StringComparison.Ordinal)
                || t.Contains("-hk", StringComparison.Ordinal) || t.Contains("-mo", StringComparison.Ordinal) ? "zh-TW" : "zh-CN";
        if (t == "pt" || t.StartsWith("pt-", StringComparison.Ordinal)) return "pt-BR";
        var lang = t.Split('-', '_')[0];
        return All.FirstOrDefault(l => string.Equals(l, lang, StringComparison.OrdinalIgnoreCase)) ?? Fallback;
    }

    /// <summary>The one chosen in settings ("system" = follow system; missing or unrecognized values count as it too) + the system's → which language to use (same as resolveLocale in i18n.tsx)</summary>
    public static string Resolve(string? pref, string? system)
    {
        if (pref is not null && pref != "system" && All.Contains(pref)) return pref;
        var matched = Match(system);
        if (FollowSystem.Contains(matched)) return matched;
        return FollowSystem.Contains(Fallback) ? Fallback : Source;
    }

    /// <summary>
    /// Which font the CJK characters of this language use (NativeUi.UiFont puts it after Segoe UI; same as --font-cjk in styles.css): the same Han character has different glyphs in Simplified Chinese, Traditional Chinese and Japanese,
    /// and the wrong font would show mainland-China forms of the characters in the Japanese UI
    /// </summary>
    internal static string CjkFont(string lang) => lang switch
    {
        "zh-TW" => "Microsoft JhengHei UI",
        "ja" => "Yu Gothic UI, Meiryo UI",
        "ko" => "Malgun Gothic",
        _ => "Microsoft YaHei UI",
    };

    static string SystemLanguage => CultureInfo.CurrentUICulture.Name;

    static volatile string current = Resolve(null, SystemLanguage);

    /// <summary>The language in use now</summary>
    public static string Current => current;

    /// <summary>The language changed (raised on the thread that called Use: when Bridge receives a settings change from the UI, that is the UI thread)</summary>
    public static event Action? Changed;

    /// <summary>Decides the language from the language setting: called at startup and when the UI changes settings. Does nothing if unchanged</summary>
    public static void Use(string? pref)
    {
        var next = Resolve(pref, SystemLanguage);
        if (next == current) return;
        current = next;
        Log.Info($"Language: {next}");
        Changed?.Invoke();
    }

    static readonly ConcurrentDictionary<string, Lazy<Dictionary<string, string>>> catalogs = new();

    /// <summary>The messages of this language; empty if there is none (a secondary language not translated yet), in which case lookup falls back to English</summary>
    static Dictionary<string, string> Catalog(string lang) => catalogs.GetOrAdd(lang, l => new(() => Load(l))).Value;

    static Dictionary<string, string> Load(string lang)
    {
        using var stream = typeof(Locale).Assembly.GetManifestResourceStream($"locales.{lang}.json");
        return stream is null ? [] : JsonSerializer.Deserialize<Dictionary<string, string>>(stream) ?? [];
    }

    /// <summary>
    /// The text of key (in the current language), with args filled in by ICU MessageFormat (plurals follow this language's rules).
    /// Integers are passed through as they are (plurals need them); other numbers are first written as text in a fixed format (coordinates for AI don't follow the system locale). If there is no such message the key is returned as is (same as the UI)
    /// </summary>
    public static string T(string key, params (string Name, object Value)[] args) => In(current, key, args);

    /// <summary>Same as T, with a specified language (for tests and places that need a fixed language)</summary>
    public static string In(string lang, string key, params (string Name, object Value)[] args)
    {
        var from = lang;
        if (!Catalog(lang).TryGetValue(key, out var text))
        {
            from = Fallback;
            if (!Catalog(Fallback).TryGetValue(key, out text))
            {
                Log.Warn($"Missing catalog entry: {key}");
                return key;
            }
        }
        return Format(from, text, args);
    }

    /// <summary>Formats an ICU message in this language (used by In; tests use it to compare the formatted results on both sides)</summary>
    internal static string Format(string lang, string pattern, params (string Name, object Value)[] args)
    {
        var values = new Dictionary<string, object?>();
        foreach (var (name, value) in args)
            values[name] = value is int or long ? value : value is IFormattable f ? f.ToString(null, CultureInfo.InvariantCulture) : value;
        var formatter = Formatter(lang);
        try
        {
            lock (formatter) return formatter.FormatMessage(pattern, values);
        }
        catch (Exception ex) when (ex is FormatException or ArgumentException or InvalidOperationException or KeyNotFoundException)
        {
            // A broken message (i18n.test.ts catches those first): don't let one sentence take down the tray or the capture overlay; return the original text
            Log.Warn($"Bad catalog entry ({lang}): {pattern}: {ex.Message}");
            return pattern;
        }
    }

    static readonly ConcurrentDictionary<string, Jeffijoe.MessageFormat.MessageFormatter> formatters = new();

    /// <summary>One per language (plural rules follow the language; it caches parsed messages and isn't thread-safe, so lock when using it)</summary>
    static Jeffijoe.MessageFormat.MessageFormatter Formatter(string lang) =>
        formatters.GetOrAdd(lang, l => new(culture: CultureInfo.GetCultureInfo(l)));
}
