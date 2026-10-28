using System.IO;
using System.IO.Compression;
using System.Text;
using System.Text.Json.Nodes;

namespace SnipToss.App;

/// <summary>
/// Diagnostics package (Help → Export Diagnostics Package…): a zip to attach when reporting a problem; the user chooses where to save it and decides whether to send it; the app uploads nothing.
/// Contents: diagnostics.txt (the diagnostic info from the UI, same as "Copy diagnostic info"), logs/ (the last 7 days of logs, with the user directory and user name already removed when written),
/// settings.json (the app's settings without the paths: the item list, expanded folders and last selection are reduced to counts; the author name and the "always attach" text are removed too)
/// </summary>
static class DiagnosticsPackage
{
    public static string DefaultName(DateTime now) =>
        $"SnipToss-diagnostics-{now.ToString("yyyyMMdd-HHmmss", System.Globalization.CultureInfo.InvariantCulture)}.zip";

    public static void Write(string zipPath, string diagnostics, string settingsFile, string logDir)
    {
        var tmp = zipPath + ".tmp";
        using (var zip = ZipFile.Open(tmp, ZipArchiveMode.Create))
        {
            AddText(zip, "diagnostics.txt", Crash.Scrub(diagnostics));
            if (Directory.Exists(logDir))
                foreach (var log in Directory.EnumerateFiles(logDir, "*.log").Order(StringComparer.OrdinalIgnoreCase))
                    zip.CreateEntryFromFile(log, "logs/" + Path.GetFileName(log), CompressionLevel.Optimal);
            if (SettingsWithoutPaths(settingsFile) is { } settings) AddText(zip, "settings.json", settings);
        }
        File.Move(tmp, zipPath, overwrite: true);
    }

    static void AddText(ZipArchive zip, string name, string text)
    {
        using var w = new StreamWriter(zip.CreateEntry(name, CompressionLevel.Optimal).Open(), new UTF8Encoding(false));
        w.Write(text);
    }

    /// <summary>The settings file without the entries that carry paths (item list, expanded / collapsed folders, last selected, screenshot save location), replaced by counts; null if unreadable (then it isn't included)</summary>
    internal static string? SettingsWithoutPaths(string settingsFile)
    {
        try
        {
            if (JsonNode.Parse(AtomicFile.ReadAllText(settingsFile)) is not JsonObject s) return null;
            foreach (var key in new[] { "Library", "Expanded", "Collapsed" })
                if (s[key] is JsonArray list) s[key] = $"({list.Count} entries)";
            if (s["Selected"] is not null) s["Selected"] = "(set)";
            // Text the user wrote in the settings (author name, "always attach" text) is left out too
            if (s["Prefs"] is JsonObject prefs)
                foreach (var key in new[] { "author", "promptExtra" })
                    if (prefs[key] is JsonValue v && v.TryGetValue<string>(out var text) && text.Length > 0) prefs[key] = "(set)";
            if (s["Capture"] is JsonObject capture && capture["Folder"] is JsonValue folder && folder.TryGetValue<string>(out var f) && f.Length > 0)
                capture["Folder"] = "(custom)";
            // For people to read: non-ASCII text and the + sign are written as they are, not escaped as \uXXXX
            var options = new System.Text.Json.JsonSerializerOptions { WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping };
            return Crash.Scrub(s.ToJsonString(options)) + "\n";
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or System.Text.Json.JsonException)
        {
            Log.Warn("Diagnostics package: could not read the settings file, leaving it out", ex);
            return null;
        }
    }
}
