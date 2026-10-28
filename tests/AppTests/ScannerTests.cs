using System.IO;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text.Json.Nodes;
using SnipToss.App;

namespace AppTests;

/// <summary>
/// Rules of the folder scan (MaterialScanner): which files are recognised, what is skipped,
/// and what happens with unreadable folders and directory links
/// </summary>
public class ScannerTests
{
    static readonly HashSet<string> All = ["image", "video"];
    static readonly HashSet<string> NoSkip = new(StringComparer.OrdinalIgnoreCase);

    static string Touch(string root, string rel)
    {
        var full = Path.Combine(root, rel.Replace('/', '\\'));
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        File.WriteAllBytes(full, [1, 2, 3]);
        return full;
    }

    static List<string> Names(string root, HashSet<string>? kinds = null, HashSet<string>? skip = null, MaterialScanner.Stats? stats = null) =>
        MaterialScanner.Scan(root, kinds ?? All, skip ?? NoSkip, stats: stats).Select(f => Path.GetRelativePath(root, f.FullPath).Replace('\\', '/')).Order().ToList();

    [Fact]
    public void Recognised_extensions_eighteen_image_types_five_video_types_case_insensitive()
    {
        string[] images = [".png", ".jpg", ".jpeg", ".jfif", ".jpe", ".pjpeg", ".pjp", ".webp", ".gif", ".apng", ".bmp", ".avif", ".ico", ".svg", ".tif", ".tiff", ".heic", ".heif"];
        foreach (var ext in images) Assert.Equal("image", MaterialScanner.KindOf("a" + ext.ToUpperInvariant()));
        foreach (var ext in new[] { ".mp4", ".webm", ".mov", ".m4v", ".mkv" }) Assert.Equal("video", MaterialScanner.KindOf("a" + ext));
        foreach (var ext in new[] { ".pdf", ".pptx", ".ppt", ".txt", ".psd", ".jxl", ".avi", ".svgz", "" }) Assert.Null(MaterialScanner.KindOf("a" + ext));
        // all of them open on their own; folders and the context menu leave out More formats unless turned on
        Assert.Equal(23, MaterialScanner.Extensions.Count());
        Assert.Equal(20000, MaterialScanner.Limit);
    }

    [Fact]
    public void More_formats_are_listed_only_when_turned_on_and_counted_when_left_out()
    {
        using var dir = new TempDir();
        foreach (var name in new[] { "a.png", "b.jpg", "c.svg", "d.mp4", "e.m4v", "f.tif", "g.heic", "h.ico", "i.apng", "j.jfif", "k.mkv" }) Touch(dir.Path, name);
        var off = new MaterialScanner.Stats();
        Assert.Equal(["a.png", "b.jpg", "c.svg", "d.mp4", "e.m4v"], Names(dir.Path, new HashSet<string> { "image", "video" }, stats: off));
        Assert.Equal(6, off.MoreOff);
        Assert.Equal(["apng", "heic", "ico", "jfif", "mkv", "tif"], off.MoreOffExts);
        Assert.Equal(0, off.Others);
        // Videos turned off: the MKV is left out like the MP4, not reported as a More format
        var noVideo = new MaterialScanner.Stats();
        Names(dir.Path, new HashSet<string> { "image" }, stats: noVideo);
        Assert.DoesNotContain("mkv", noVideo.MoreOffExts);
        var on = new MaterialScanner.Stats();
        Assert.Equal(11, Names(dir.Path, new HashSet<string> { "image", "video", MaterialScanner.MoreKind }, stats: on).Count);
        Assert.Equal(0, on.MoreOff);
    }

    [Fact]
    public void Context_menu_types_are_the_twelve_common_ones_or_all_with_more_formats()
    {
        Assert.Equal([".avif", ".bmp", ".gif", ".jpeg", ".jpg", ".m4v", ".mov", ".mp4", ".png", ".svg", ".webm", ".webp"], MaterialScanner.MenuExtensions(false).Order());
        Assert.Equal(MaterialScanner.Extensions.Order(), MaterialScanner.MenuExtensions(true).Order());
    }

    [Fact]
    public void TIFF_and_HEIC_which_the_UI_cannot_display_are_converted_by_the_shell()
    {
        foreach (var ext in new[] { ".tif", ".TIFF", ".heic", ".HEIF" }) Assert.True(DecodedImages.Needs("a" + ext));
        foreach (var ext in new[] { ".png", ".svg", ".avif", ".ico", ".mkv" }) Assert.False(DecodedImages.Needs("a" + ext));
        // Everything that is converted is a recognised image
        foreach (var ext in new[] { ".tif", ".tiff", ".heic", ".heif" }) Assert.Equal("image", MaterialScanner.KindOf("a" + ext));
    }

    [Fact]
    public void Dot_prefixed_and_hidden_files_and_folders_are_skipped_entirely_and_not_counted_as_unsupported()
    {
        using var dir = new TempDir();
        Touch(dir.Path, "看得见.png");
        Touch(dir.Path, ".cache/a.png");
        Touch(dir.Path, ".点开头.png");
        File.SetAttributes(Touch(dir.Path, "隐藏的.png"), FileAttributes.Hidden);
        Touch(dir.Path, "隐藏夹/b.png");
        Touch(dir.Path, "隐藏夹/c.psd");
        File.SetAttributes(Path.Combine(dir.Path, "隐藏夹"), FileAttributes.Directory | FileAttributes.Hidden);
        var stats = new MaterialScanner.Stats();
        Assert.Equal(["看得见.png"], Names(dir.Path, stats: stats));
        Assert.Equal(0, stats.Others);
    }

    [Fact]
    public void Skipped_folders_match_case_insensitively_are_not_entered_at_any_depth_and_are_recorded()
    {
        using var dir = new TempDir();
        Touch(dir.Path, "a.png");
        Touch(dir.Path, "DIST/深/b.png");
        Touch(dir.Path, "子/dist/c.png");
        Touch(dir.Path, "子/d.png");
        var stats = new MaterialScanner.Stats();
        Assert.Equal(["a.png", "子/d.png"], Names(dir.Path, skip: new(["dist"], StringComparer.OrdinalIgnoreCase), stats: stats));
        Assert.Equal(["DIST"], stats.SkippedDirs.Select(s => s.ToUpperInvariant()).Distinct());
    }

    [Fact]
    public void With_no_skipped_folders_stored_in_settings_the_seven_defaults_apply_and_a_stored_empty_list_skips_none()
    {
        using var dir = new TempDir();
        var s = Settings.LoadFrom(dir.File("settings.json"));
        Assert.Equal(["__pycache__", "bin", "build", "dist", "node_modules", "obj", "venv"], s.SkipDirs.Order(StringComparer.Ordinal));
        s.Prefs = JsonNode.Parse("""{ "skipDirs": [] }""")!.AsObject();
        Assert.Empty(s.SkipDirs);
    }

    [Fact]
    public void Office_temp_files_are_not_listed_and_not_counted_as_unsupported()
    {
        using var dir = new TempDir();
        Touch(dir.Path, "a.png");
        Touch(dir.Path, "~$a.png");
        Touch(dir.Path, "方案.pptx");
        Touch(dir.Path, "~$方案.pptx");
        var stats = new MaterialScanner.Stats();
        Assert.Equal(["a.png"], Names(dir.Path, stats: stats));
        Assert.Equal(1, stats.Others);
        Assert.Equal(["pptx"], stats.OtherExts);
    }

    [Fact]
    public void Disabled_kinds_are_not_listed_and_not_counted_as_unsupported()
    {
        using var dir = new TempDir();
        Touch(dir.Path, "a.png");
        Touch(dir.Path, "b.mp4");
        var stats = new MaterialScanner.Stats();
        Assert.Equal(["a.png"], Names(dir.Path, kinds: ["image"], stats: stats));
        Assert.Equal(0, stats.Others);
    }

    [Fact]
    public void Unreadable_subfolders_are_skipped_and_the_rest_is_listed()
    {
        using var dir = new TempDir();
        Touch(dir.Path, "a.png");
        Touch(dir.Path, "锁住/b.png");
        var locked = new DirectoryInfo(Path.Combine(dir.Path, "锁住"));
        var rule = new FileSystemAccessRule(WindowsIdentity.GetCurrent().User!, FileSystemRights.ListDirectory, AccessControlType.Deny);
        var acl = locked.GetAccessControl();
        acl.AddAccessRule(rule);
        locked.SetAccessControl(acl);
        try
        {
            Assert.Throws<UnauthorizedAccessException>(() => locked.EnumerateFileSystemInfos().ToList()); // it really cannot be read
            Assert.Equal(["a.png"], Names(dir.Path));
        }
        finally
        {
            acl.RemoveAccessRule(rule);
            locked.SetAccessControl(acl);
        }
    }

    [Fact]
    public void A_directory_junction_pointing_back_up_is_not_entered()
    {
        using var dir = new TempDir();
        Touch(dir.Path, "a.png");
        var link = Path.Combine(dir.Path, "回环");
        LongPaths.CreateJunction(link, dir.Path);
        try
        {
            var watch = System.Diagnostics.Stopwatch.StartNew();
            Assert.Equal(["a.png"], Names(dir.Path));
            Assert.True(watch.Elapsed < TimeSpan.FromSeconds(5));
            // Files inside the junction do not count as "already in the library" either: dropping one in individually still adds it
            Assert.False(Library.Covers(dir.Path, Path.Combine(link, "a.png"), All, NoSkip));
        }
        finally
        {
            Directory.Delete(link);
        }
    }

    [Fact]
    public void Scan_results_carry_the_files_size_modified_time_and_created_time()
    {
        using var dir = new TempDir();
        var file = Touch(dir.Path, "子/a.png");
        var when = new DateTime(2026, 10, 1, 8, 30, 15, 123, DateTimeKind.Utc);
        File.SetLastWriteTimeUtc(file, when);
        var f = Assert.Single(MaterialScanner.Scan(dir.Path, All, NoSkip));
        Assert.Equal(file, f.FullPath);
        Assert.Equal("image", f.Kind);
        Assert.Equal(3, f.Size);
        Assert.Equal(new DateTimeOffset(when).ToUnixTimeMilliseconds(), f.Mtime);
        Assert.Equal(new DateTimeOffset(File.GetCreationTimeUtc(file)).ToUnixTimeMilliseconds(), f.Ctime);
        Assert.Equal(f, MaterialScanner.Describe(file));
        Assert.Null(MaterialScanner.Describe(Path.Combine(dir.Path, "没有.png")));
    }

    [Theory]
    [InlineData("")]
    [InlineData("E:\\a\0b.png")]
    public void Item_watching_does_not_throw_when_the_last_viewed_path_is_corrupt(string selected)
    {
        // The settings file was corrupted by hand ("Selected": ""): it used to throw an ArgumentException every second and pop up the error window
        Assert.Equal("missing", MaterialWatcher.FileSignature(selected));
    }
}
