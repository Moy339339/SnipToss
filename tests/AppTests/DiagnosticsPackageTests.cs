using System.IO;
using System.IO.Compression;
using SnipToss.App;
using Xunit;

namespace AppTests;

/// <summary>The diagnostics package (Help → Export Diagnostics Package…): what goes in and what is stripped</summary>
public class DiagnosticsPackageTests
{
    [Fact]
    public void Package_contains_diagnostic_info_the_log_and_settings_stripped_of_paths_and_author_name()
    {
        using var dir = new TempDir();
        var logs = Directory.CreateDirectory(dir.File("logs")).FullName;
        File.WriteAllText(Path.Combine(logs, "SnipToss-20261023.log"), "[INFO] 启动\n");
        var settings = dir.File("settings.json");
        File.WriteAllText(settings, """
            {
              "Library": [ { "Path": "E:\\客户A\\机密项目", "Pinned": false } ],
              "Expanded": [ "E:\\客户A\\机密项目\\assets" ],
              "Collapsed": [],
              "Selected": "E:\\客户A\\机密项目\\hero.png",
              "Prefs": { "author": "张三", "promptExtra": "别动 logo", "language": "en" },
              "Capture": { "Hotkey": "Ctrl+Alt+A", "Folder": "D:\\截图" }
            }
            """);
        var zip = dir.File("out.zip");
        DiagnosticsPackage.Write(zip, "SnipToss 1.0.0-beta.62\nOS: Windows", settings, logs);

        using var archive = ZipFile.OpenRead(zip);
        Assert.Equal(["diagnostics.txt", "logs/SnipToss-20261023.log", "settings.json"], archive.Entries.Select(e => e.FullName).Order(StringComparer.Ordinal));
        string Read(string name)
        {
            using var r = new StreamReader(archive.GetEntry(name)!.Open());
            return r.ReadToEnd();
        }
        Assert.Contains("1.0.0-beta.62", Read("diagnostics.txt"), StringComparison.Ordinal);
        var s = Read("settings.json");
        // Chinese and "+" are written as-is (not escaped to \uXXXX), otherwise the "does not contain" checks below mean nothing
        Assert.Contains("Ctrl+Alt+A", s, StringComparison.Ordinal);
        Assert.DoesNotContain("机密项目", s, StringComparison.Ordinal);
        Assert.DoesNotContain("张三", s, StringComparison.Ordinal);
        Assert.DoesNotContain("别动 logo", s, StringComparison.Ordinal);
        Assert.DoesNotContain("截图", s, StringComparison.Ordinal);
        Assert.Contains("(1 entries)", s, StringComparison.Ordinal);
        Assert.Contains("\"language\": \"en\"", s, StringComparison.Ordinal);
        Assert.Contains("Ctrl+Alt+A", s, StringComparison.Ordinal);
        Assert.False(File.Exists(zip + ".tmp"));
    }

    [Fact]
    public void New_marks_in_the_library_keep_only_their_counts()
    {
        using var dir = new TempDir();
        var settings = dir.File("settings.json");
        // Keys as the UI writes them (keyOf: lower case, backslashes), on a drive outside the user folder so Scrub cannot catch them
        File.WriteAllText(settings, """
            {
              "Prefs": {
                "fresh": {
                  "since": { "e:\\客户a\\机密项目": 1761984000000, "e:\\客户a\\另一个": 1761984000001 },
                  "seen": [ "e:\\客户a\\机密项目\\hero-v2.png" ]
                },
                "language": "en"
              }
            }
            """);
        var s = DiagnosticsPackage.SettingsWithoutPaths(settings)!;
        Assert.DoesNotContain("客户a", s, StringComparison.Ordinal);
        Assert.DoesNotContain("hero-v2", s, StringComparison.Ordinal);
        Assert.Contains("\"since\": \"(2 entries)\"", s, StringComparison.Ordinal);
        Assert.Contains("\"seen\": \"(1 entries)\"", s, StringComparison.Ordinal);
        Assert.Contains("\"language\": \"en\"", s, StringComparison.Ordinal);
    }

    [Fact]
    public void New_marks_of_an_unexpected_shape_are_left_out_too()
    {
        using var dir = new TempDir();
        var settings = dir.File("settings.json");
        File.WriteAllText(settings, """{ "Prefs": { "fresh": "e:\\客户a\\机密项目" } }""");
        var s = DiagnosticsPackage.SettingsWithoutPaths(settings)!;
        Assert.DoesNotContain("客户a", s, StringComparison.Ordinal);
        Assert.Contains("\"fresh\": \"(set)\"", s, StringComparison.Ordinal);
    }

    [Fact]
    public void Unreadable_settings_file_still_exports_just_without_settings()
    {
        using var dir = new TempDir();
        var zip = dir.File("out.zip");
        DiagnosticsPackage.Write(zip, "x", dir.File("没有这个.json"), dir.File("没有日志"));
        using var archive = ZipFile.OpenRead(zip);
        Assert.Equal(["diagnostics.txt"], archive.Entries.Select(e => e.FullName));
    }

    [Fact]
    public void Default_file_name_has_no_language_and_a_fixed_format()
    {
        Assert.Equal("SnipToss-diagnostics-20261023-061502.zip", DiagnosticsPackage.DefaultName(new DateTime(2026, 10, 23, 6, 15, 2)));
    }
}
