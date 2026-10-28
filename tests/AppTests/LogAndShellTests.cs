using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using SnipToss.App;

namespace AppTests;

/// <summary>Changes process-wide state (log directory, environment variables): never runs in parallel with any other test</summary>
[CollectionDefinition(nameof(ProcessWide), DisableParallelization = true)]
public class ProcessWide;

/// <summary>
/// The log, accepting only the app's own UI, and opening URLs
/// </summary>
[Collection(nameof(ProcessWide))]
public sealed class LogAndShellTests : IDisposable
{
    static readonly string Profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
    readonly string savedDir = Log.Dir;
    readonly TempDir temp = new();

    public LogAndShellTests() => Log.Dir = temp.Path;

    public void Dispose()
    {
        Log.Dir = savedDir;
        Environment.SetEnvironmentVariable("SNIPTOSS_DEV_URL", null);
        temp.Dispose();
    }

    [Fact]
    public void Log_file_is_named_by_day_each_line_has_time_level_and_text_UTF8_without_BOM_and_an_exception_goes_on_its_own_line()
    {
        Log.Info("第一行");
        Log.Warn("出了点事", new IOException("磁盘满了"));
        Assert.Matches(@"SnipToss-\d{8}\.log$", Log.CurrentFile);
        var bytes = File.ReadAllBytes(Log.CurrentFile);
        Assert.False(bytes is [0xEF, 0xBB, 0xBF, ..], "There should be no BOM");
        var lines = Encoding.UTF8.GetString(bytes).Split(Environment.NewLine);
        Assert.Matches(@"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} [+-]\d{2}:\d{2} \[INFO\] 第一行$", lines[0]);
        Assert.Matches(@"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} [+-]\d{2}:\d{2} \[WARN\] 出了点事$", lines[1]);
        Assert.Equal("System.IO.IOException: 磁盘满了", lines[2]);
    }

    [Fact]
    public void Log_leaves_out_the_user_name_and_writes_the_user_directory_as_USERPROFILE()
    {
        // The error window and the notice page ask users to attach the log to a problem report, which gets posted on public GitHub
        // (same as Copy diagnostic info)
        Log.Info($"打开 {Path.Combine(Profile, "Pictures", "a.png")}");
        Log.Error("读不了", new IOException($"找不到 {Path.Combine(Profile, "Desktop", "b.png")}"));
        var text = File.ReadAllText(Log.CurrentFile);
        Assert.DoesNotContain(Profile, text, StringComparison.OrdinalIgnoreCase);
        Assert.Contains(@"%USERPROFILE%\Pictures\a.png", text);
        Assert.Contains(@"%USERPROFILE%\Desktop\b.png", text);
    }

    [Fact]
    public void Log_that_cannot_be_written_does_not_throw_and_resumes_once_possible()
    {
        // The log directory's location is occupied by a file, so the directory cannot be created
        var blocked = temp.File("blocked");
        File.WriteAllText(blocked, "");
        Log.Dir = blocked;
        Log.Error("写不进去也不能把程序弄崩", new InvalidOperationException("x"));
        Log.Dir = temp.Path;
        Log.Info("接着写");
        Assert.Contains("接着写", File.ReadAllText(Log.CurrentFile));
    }

    [Fact]
    public void Log_with_another_program_reading_it_and_two_threads_writing_keeps_every_line_whole_and_loses_none()
    {
        Log.Info("开头");
        // Someone has the log open to read it (Notepad, tail): open with shared read/write
        using var reader = new FileStream(Log.CurrentFile, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        Parallel.For(0, 2, t =>
        {
            for (var i = 0; i < 200; i++) Log.Info($"线程{t} 第{i}行 {new string('x', 50)}");
        });
        var lines = File.ReadAllLines(Log.CurrentFile).Where(l => l.Contains("线程", StringComparison.Ordinal)).ToList();
        Assert.Equal(400, lines.Count);
        Assert.All(lines, l => Assert.Matches(@"\[INFO\] 线程[01] 第\d+行 x{50}$", l));
    }

    [Fact]
    public void Log_files_and_dumps_older_than_7_days_are_deleted_and_the_rest_are_kept()
    {
        string Make(string name, int daysAgo)
        {
            var f = temp.File(name);
            File.WriteAllText(f, "");
            File.SetLastWriteTime(f, DateTime.Now.AddDays(-daysAgo));
            return f;
        }
        var oldLog = Make("SnipToss-20000101.log", 8);
        var oldDump = Make("crash-20000101-000000.dmp", 9);
        var recent = Make("SnipToss-20000102.log", 6);
        var other = Make("别的文件.txt", 30);
        Log.CleanOld();
        Assert.False(File.Exists(oldLog));
        Assert.False(File.Exists(oldDump));
        Assert.True(File.Exists(recent));
        Assert.True(File.Exists(other));
    }

    [Theory]
    [InlineData("https://app.sniptoss.example/index.html", true)]
    [InlineData("https://APP.SNIPTOSS.EXAMPLE/", true)]
    [InlineData("https://app.sniptoss.example.evil.com/", false)]
    [InlineData("https://evilapp.sniptoss.example/", false)]
    [InlineData("https://vol-c.sniptoss.example/a.png", false)]
    [InlineData("https://paths.sniptoss.example/x", false)]
    [InlineData("about:blank", false)]
    [InlineData("file:///C:/x/index.html", false)]
    [InlineData("", false)]
    [InlineData("不是网址", false)]
    public void Only_the_apps_own_UI_is_accepted_the_packaged_UI(string uri, bool own) => Assert.Equal(own, MainWindow.IsOwnUi(uri));

    [Fact]
    public void Host_name_for_a_mapped_drive_ignores_drive_letter_case_uses_the_share_root_for_network_shares_and_is_a_valid_host_name()
    {
        Assert.Equal("vol-e.sniptoss.example", MainWindow.HostOf(@"E:\"));
        Assert.Equal("vol-e.sniptoss.example", MainWindow.HostOf(@"e:\"));
        var unc = MainWindow.HostOf(@"\\NAS\素材");
        Assert.Equal(unc, MainWindow.HostOf(@"\\nas\素材"));
        Assert.NotEqual(unc, MainWindow.HostOf(@"\\nas\别的"));
        Assert.Matches("^vol-unc-[0-9a-f]{12}\\.sniptoss\\.example$", unc);
        // Must not collide with the UI's own host (only the app's own UI may use the bridge, see IsOwnUi)
        Assert.False(MainWindow.IsOwnUi($"https://{unc}/"));
    }

    [Fact]
    public void Only_the_apps_own_UI_is_accepted_in_development_the_dev_server_counts_with_matching_port_and_host()
    {
        Environment.SetEnvironmentVariable("SNIPTOSS_DEV_URL", "http://localhost:5173");
        Assert.True(MainWindow.IsOwnUi("http://localhost:5173/src/main.tsx"));
        Assert.False(MainWindow.IsOwnUi("http://localhost:5174/"));
        Assert.False(MainWindow.IsOwnUi("http://127.0.0.1:5173/"));
        Assert.True(MainWindow.IsOwnUi("https://app.sniptoss.example/"));
    }

    [Theory]
    [InlineData(@"C:\Windows\System32\cmd.exe")]
    [InlineData("file:///C:/Windows/System32/cmd.exe")]
    [InlineData("javascript:alert(1)")]
    [InlineData("ftp://example.com/a")]
    [InlineData("mailto:someone@example.com")]
    [InlineData("ms-settings:display")]
    [InlineData("")]
    [InlineData("example.com")]
    public void Opening_a_URL_accepts_only_http_and_https_and_rejects_everything_else(string url) =>
        Assert.Contains("http", Assert.Throws<ArgumentException>(() => Shell.OpenUrl(url)).Message, StringComparison.Ordinal);
}
