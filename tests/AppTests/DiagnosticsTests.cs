using System.IO;
using System.Text.Json;
using System.Text.Json.Nodes;
using SnipToss.App;

namespace AppTests;

/// <summary>
/// When something goes wrong: diagnostic info (the error window, "Copy diagnostic info" on the notice page), and rate limiting and levels of the UI log
/// </summary>
public class DiagnosticsTests
{
    static readonly string Profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

    [Fact]
    public void Diagnostic_info_uses_English_labels_and_leaves_out_the_user_directory_and_log_path()
    {
        var ex = new IOException($"找不到 {Path.Combine(Profile, "Pictures", "a.png")}");
        var text = Crash.Diagnostics(ex);
        Assert.StartsWith("SnipToss ", text);
        Assert.Contains("OS: ", text);
        Assert.Contains("Time: ", text);
        Assert.Contains(@"%USERPROFILE%\Pictures\a.png", text);
        Assert.DoesNotContain(Profile, text, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(AppPaths.LogDir, text, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("日志", text);
    }

    [Fact]
    public void Diagnostic_info_replaces_the_user_name_segment_of_paths_on_other_drives()
    {
        var user = Environment.UserName;
        var text = Crash.Scrub($@"D:\Users\{user}\作品\a.png 和 E:\{user}");
        Assert.Equal(@"D:\Users\<user>\作品\a.png 和 E:\<user>", text);
    }

    /// <summary>The same cases the Mac shell's Scrub runs (tests/golden/scrub.json), so both shells take out the same things</summary>
    [Fact]
    public void Scrub_matches_every_case_in_the_shared_golden_file()
    {
        var golden = JsonNode.Parse(File.ReadAllText(GoldenFile("scrub.json")))!;
        var token = (string)golden["homeToken"]!["windows"]!;
        var cases = golden["cases"]!.AsArray();
        Assert.NotEmpty(cases);
        foreach (var c in cases)
        {
            var expected = ((string)c!["expected"]!).Replace("{home}", token, StringComparison.Ordinal);
            var actual = Crash.Scrub((string)c["text"]!, (string)c["home"]!, (string)c["user"]!, token);
            Assert.True(expected == actual, $"{(string)c["name"]!}: expected \"{expected}\", got \"{actual}\"");
        }
    }

    static string GoldenFile(string name)
    {
        for (var d = new DirectoryInfo(AppContext.BaseDirectory); d is not null; d = d.Parent)
        {
            var file = Path.Combine(d.FullName, "tests", "golden", name);
            if (File.Exists(file)) return file;
        }
        throw new InvalidOperationException($"tests/golden/{name} not found");
    }

    [Fact]
    public void UI_log_allows_at_most_60_entries_a_minute_the_first_excess_one_becomes_a_notice_later_ones_are_dropped_and_the_next_minute_resumes()
    {
        var limit = new WebLogLimiter(60);
        var t0 = new DateTime(2026, 10, 21, 12, 0, 0);
        for (var i = 0; i < 60; i++) Assert.Equal(WebLogLimiter.Verdict.Write, limit.Take(t0.AddSeconds(i * 0.5)));
        Assert.Equal(WebLogLimiter.Verdict.Notice, limit.Take(t0.AddSeconds(40)));
        Assert.Equal(WebLogLimiter.Verdict.Drop, limit.Take(t0.AddSeconds(50)));
        Assert.Equal(WebLogLimiter.Verdict.Drop, limit.Take(t0.AddSeconds(59)));
        Assert.Equal(WebLogLimiter.Verdict.Write, limit.Take(t0.AddSeconds(61)));
    }

    [Theory]
    [InlineData("""{"level":"warn","message":"x"}""", "warn")]
    [InlineData("""{"level":"info","message":"x"}""", "info")]
    [InlineData("""{"level":"error","message":"x"}""", "error")]
    [InlineData("""{"message":"x"}""", "error")]
    [InlineData("""{"level":null,"message":"x"}""", "error")]
    [InlineData("""{"level":"debug","message":"x"}""", "error")]
    public void UI_log_level_missing_or_wrong_is_logged_as_an_error(string json, string expected) =>
        Assert.Equal(expected, Bridge.WebLogLevel(JsonDocument.Parse(json).RootElement));
}
