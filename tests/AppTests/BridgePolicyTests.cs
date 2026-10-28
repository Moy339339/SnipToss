using System.IO;
using SnipToss.App;

namespace AppTests;

/// <summary>
/// The bridge only lets through the paths it should (reveal, sha256). They must not accept an arbitrary absolute path
/// </summary>
public class BridgePolicyTests
{
    static readonly string[] Roots = [@"E:\项目\素材", @"D:\单个.png"];

    [Theory]
    [InlineData(@"E:\项目\素材")]
    [InlineData(@"E:\项目\素材\")]
    [InlineData(@"E:\项目\素材\子\a.png")]
    [InlineData(@"e:\项目\素材\A.PNG")]
    [InlineData(@"D:\单个.png")]
    public void Paths_in_the_library_and_below_them_are_allowed(string path) => Assert.True(Bridge.IsUnder(path, Roots));

    [Theory]
    [InlineData(@"E:\项目")]
    [InlineData(@"E:\项目\素材2\a.png")]
    [InlineData(@"E:\项目\素材\..\别处\a.exe")]
    [InlineData(@"C:\Windows\System32\cmd.exe")]
    [InlineData(@"D:\单个.png.exe")]
    [InlineData("")]
    [InlineData("C:\\a\0b")]
    public void Paths_outside_the_library_are_blocked(string path) => Assert.False(Bridge.IsUnder(path, Roots));

    [Fact]
    public void Writing_notes_when_the_item_folder_is_gone_writes_nothing_and_does_not_recreate_it()
    {
        // AtomicFile would otherwise recreate the whole path: a folder containing only .sniptoss pops up in the old place
        // and the notes end up split across two
        using var dir = new TempDir();
        var gone = Path.Combine(dir.Path, "被移走的项目");
        Assert.Throws<DirectoryNotFoundException>(() => Bridge.InDataDir(gone, ".sniptoss/annotations/a.json"));
        Assert.False(Directory.Exists(gone));
    }

    [Fact]
    public void Writing_notes_when_the_item_folder_exists_is_allowed()
    {
        using var dir = new TempDir();
        Assert.StartsWith(Path.Combine(dir.Path, ".sniptoss"), Bridge.InDataDir(dir.Path, ".sniptoss/annotations/a.json"), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData("annotations/../../别处.json")]
    [InlineData(".sniptoss/../素材.png")]
    [InlineData(".sniptoss2/a.json")]
    [InlineData("hero.png")]
    [InlineData(".sniptoss")]
    public void Writing_notes_outside_sniptoss_is_always_blocked(string rel)
    {
        // Only .sniptoss/ of the notes folder may be written: a relative path from the UI that contains .. or points at the item itself is refused
        // (the app never modifies the item)
        using var dir = new TempDir();
        Assert.Throws<UnauthorizedAccessException>(() => Bridge.InDataDir(dir.Path, rel));
    }

    [Fact]
    public void Writing_notes_to_an_absolute_path_is_blocked()
    {
        using var dir = new TempDir();
        Assert.Throws<ArgumentException>(() => Bridge.InDataDir(dir.Path, Path.Combine(dir.Path, ".sniptoss", "a.json")));
    }

    [Fact]
    public void Writing_notes_through_a_junction_under_sniptoss_is_blocked_and_does_not_follow_it_elsewhere()
    {
        using var dir = new TempDir();
        var elsewhere = Directory.CreateDirectory(dir.File("别处")).FullName;
        var home = Directory.CreateDirectory(dir.File("项目")).FullName;
        Directory.CreateDirectory(Path.Combine(home, ".sniptoss"));
        LongPaths.CreateJunction(Path.Combine(home, ".sniptoss", "annotations"), elsewhere);
        Assert.Throws<UnauthorizedAccessException>(() => Bridge.InDataDir(home, ".sniptoss/annotations/a.json"));
        Assert.Empty(Directory.EnumerateFileSystemEntries(elsewhere));
    }

    [Fact]
    public void Errors_are_classified_so_the_UI_can_explain_them_in_plain_words()
    {
        Assert.Equal("denied", Bridge.ErrorCode(new UnauthorizedAccessException()));
        Assert.Equal("notFound", Bridge.ErrorCode(new DirectoryNotFoundException()));
        Assert.Equal("notFound", Bridge.ErrorCode(new FileNotFoundException()));
        Assert.Equal("tooLong", Bridge.ErrorCode(new PathTooLongException()));
        Assert.Equal("busy", Bridge.ErrorCode(new IOException("x", unchecked((int)0x80070020))));
        Assert.Equal("diskFull", Bridge.ErrorCode(new IOException("x", unchecked((int)0x80070070))));
        Assert.Equal("network", Bridge.ErrorCode(new IOException("x", unchecked((int)0x80070035))));
        Assert.Equal("denied", Bridge.ErrorCode(new IOException("x", unchecked((int)0x80070013))));
#pragma warning disable CA2201 // build a "clipboard is busy" error: this is exactly what the system throws
        Assert.Equal("clipboardBusy", Bridge.ErrorCode(new System.Runtime.InteropServices.COMException("x", unchecked((int)0x800401D0))));
#pragma warning restore CA2201
        Assert.Null(Bridge.ErrorCode(new IOException("别的")));
        Assert.Null(Bridge.ErrorCode(new InvalidOperationException()));
    }

    [Theory]
    [InlineData("""{ "level": "warn" }""", "warn")]
    [InlineData("""{ "level": "info" }""", "info")]
    [InlineData("""{ "level": "error" }""", "error")]
    [InlineData("""{ "level": null }""", "error")]
    [InlineData("""{ "level": "debug" }""", "error")]
    [InlineData("""{}""", "error")]
    [InlineData("""null""", "error")]
    public void UI_log_levels_unknown_ones_are_logged_as_errors(string json, string level)
    {
        using var doc = System.Text.Json.JsonDocument.Parse(json);
        Assert.Equal(level, Bridge.WebLogLevel(doc.RootElement));
    }

    [Fact]
    public async Task Writing_notes_when_someone_else_changed_them_first_does_not_overwrite_and_returns_current_content()
    {
        // Two windows or an agent change the same notes file at once: the UI writes with the fingerprint it read, and a mismatch means no write
        // (ADR-0005); the current content is handed back so the UI can merge
        using var dir = new TempDir();
        var file = dir.File("a.json");
        File.WriteAllText(file, "旧");
        var seen = Bridge.TextSha256("旧");
        File.WriteAllText(file, "别人改的");
        var (written, current, rejectedAt) = await Bridge.WriteIfUnchangedAsync(file, "我的", check: true, seen);
        Assert.False(written);
        Assert.Equal("别人改的", current);
        Assert.Equal("别人改的", File.ReadAllText(file));
        // Ordering numbers (ADR-0005 item 8): the number taken before a later read and the one from a later successful write
        // are both greater than the one from this rejection
        var readAfter = Bridge.Observe();
        Assert.True(readAfter > rejectedAt);
        (written, _, var writtenAt) = await Bridge.WriteIfUnchangedAsync(file, "我的", check: true, Bridge.TextSha256("别人改的"));
        Assert.True(written);
        Assert.True(writtenAt > readAfter);
        Assert.Equal("我的", File.ReadAllText(file));
        // New file: it did not exist when read (fingerprint null) and still does not, so the write goes through
        var fresh = dir.File("b.json");
        Assert.True((await Bridge.WriteIfUnchangedAsync(fresh, "新", check: true, null)).Written);
        Assert.False((await Bridge.WriteIfUnchangedAsync(fresh, "又新", check: true, null)).Written);
    }

    [Fact]
    public void Folder_settings_are_read_empty_when_absent_and_report_whether_REVIEW_exists()
    {
        using var dir = new TempDir();
        Assert.Equal("{ text = , review = False }", Bridge.ReadProject(dir.Path).ToString());
        Directory.CreateDirectory(dir.File(".sniptoss"));
        File.WriteAllText(dir.File(".sniptoss/project.json"), """{ "language": "en" }""");
        File.WriteAllText(dir.File(".sniptoss/REVIEW.md"), "# x");
        Assert.Equal("""{ text = { "language": "en" }, review = True }""", Bridge.ReadProject(dir.Path).ToString());
    }

    [Fact]
    public void Pruning_snapshots_removes_only_unused_app_named_old_enough_files()
    {
        // Snapshots of deleted notes, or in a replaced format, would otherwise stay forever
        using var dir = new TempDir();
        var shots = Path.Combine(dir.Path, ".sniptoss", "snapshots");
        Directory.CreateDirectory(shots);
        string Make(string name, TimeSpan age)
        {
            var f = Path.Combine(shots, name);
            File.WriteAllText(f, "x");
            File.SetLastWriteTimeUtc(f, DateTime.UtcNow - age);
            return f;
        }
        var old = TimeSpan.FromHours(1);
        var used = Make("abc123.png", old);
        var orphan = Make("def456.png", old);
        var oldFormat = Make("abc123.jpg", old); // the one from before the switch to PNG
        var fresh = Make("new789.png", TimeSpan.FromSeconds(5)); // another window just took it, the note is not written yet
        var mine = Make("我的说明.png", old); // not a name this app generates
        var upper = Make("ABC999.png", old);

        Assert.Equal(2, Bridge.PruneSnapshots(dir.Path, ["snapshots/abc123.png", @"snapshots\zzz000.png"], TimeSpan.FromMinutes(10)));
        Assert.True(File.Exists(used));
        Assert.False(File.Exists(orphan));
        Assert.False(File.Exists(oldFormat));
        Assert.True(File.Exists(fresh));
        Assert.True(File.Exists(mine));
        Assert.True(File.Exists(upper));
    }

    [Fact]
    public void Pruning_snapshots_without_a_snapshots_folder_does_nothing()
    {
        using var dir = new TempDir();
        Assert.Equal(0, Bridge.PruneSnapshots(dir.Path, [], TimeSpan.Zero));
        Assert.False(Directory.Exists(Path.Combine(dir.Path, ".sniptoss")));
    }
}
