using System.IO;
using SnipToss.App;

namespace AppTests;

/// <summary>
/// Item paths longer than 260 characters (LongPaths): WebView2 cannot read them, so they are read through short directory
/// junctions under %LOCALAPPDATA%\SnipToss\paths\.
/// Otherwise the image would not display and the app would call the file corrupt
/// </summary>
[Collection(nameof(LongPathsTests))] // changes the static Root, so it must not run in parallel with other tests
public sealed class LongPathsTests : IDisposable
{
    readonly TempDir dir = new();
    readonly string oldRoot = LongPaths.Root;

    public LongPathsTests()
    {
        LongPaths.Root = dir.File("paths");
        LongPaths.Clean();
    }

    public void Dispose()
    {
        LongPaths.Clean();
        LongPaths.Root = oldRoot;
        dir.Dispose();
    }

    /// <summary>A file whose full path is longer than 300 characters</summary>
    string DeepFile()
    {
        var deep = Path.Combine(dir.Path, "项目", string.Join('\\', Enumerable.Range(1, 8).Select(i => $"第{i}层-{new string('长', 30)}")));
        Directory.CreateDirectory(deep);
        var file = Path.Combine(deep, "最终稿 #1.png");
        File.WriteAllBytes(file, [1, 2, 3]);
        Assert.True(file.Length > 300);
        return file;
    }

    [Fact]
    public void A_long_path_file_is_readable_through_a_short_junction_and_one_folder_gets_only_one_junction()
    {
        var file = DeepFile();
        Assert.True(LongPaths.TooLong(file));
        var alias = LongPaths.AliasOf(file);
        Assert.NotNull(alias);
        var parts = alias!.Split('/');
        Assert.Equal(Uri.EscapeDataString("最终稿 #1.png"), parts[1]);
        var viaLink = Path.Combine(LongPaths.Root, parts[0], "最终稿 #1.png");
        Assert.True(viaLink.Length < 260);
        Assert.Equal([1, 2, 3], File.ReadAllBytes(viaLink));
        Assert.Equal(alias.Split('/')[0], LongPaths.AliasOf(Path.Combine(Path.GetDirectoryName(file)!, "另一张.png"))!.Split('/')[0]);
        Assert.Single(Directory.GetDirectories(LongPaths.Root));
    }

    [Fact]
    public void Cleaning_junctions_deletes_only_the_junctions_and_the_items_they_point_to_remain()
    {
        var file = DeepFile();
        LongPaths.AliasOf(file);
        LongPaths.Clean();
        Assert.Empty(Directory.GetDirectories(LongPaths.Root));
        Assert.Equal([1, 2, 3], File.ReadAllBytes(file));
        // Asked for again after cleaning: it is created anew
        var again = LongPaths.AliasOf(file);
        Assert.NotNull(again);
        Assert.Equal([1, 2, 3], File.ReadAllBytes(Path.Combine(LongPaths.Root, again!.Split('/')[0], "最终稿 #1.png")));
    }

    [Fact]
    public void Folders_in_the_junction_directory_that_the_app_did_not_create_are_left_alone_when_cleaning()
    {
        var mine = Directory.CreateDirectory(Path.Combine(LongPaths.Root, "别人放的")).FullName;
        File.WriteAllText(Path.Combine(mine, "a.txt"), "x");
        LongPaths.Clean();
        Assert.True(File.Exists(Path.Combine(mine, "a.txt")));
    }

    [Fact]
    public void Network_paths_cannot_get_a_junction_and_return_null()
    {
        Assert.Null(LongPaths.AliasOf(@"\\server\share\" + new string('a', 300) + @"\x.png"));
    }
}

/// <summary>
/// The bridge classifies common disk errors (Bridge.ErrorCode) so the UI can explain them in plain words;
/// otherwise only the system's raw text (English on an English Windows) would be shown
/// </summary>
public class BridgeErrorCodeTests
{
    [Fact]
    public void Common_disk_errors_are_classified()
    {
        Assert.Equal("denied", Bridge.ErrorCode(new UnauthorizedAccessException()));
        Assert.Equal("notFound", Bridge.ErrorCode(new DirectoryNotFoundException()));
        Assert.Equal("diskFull", Bridge.ErrorCode(new IOException("x", unchecked((int)0x80070070))));
        Assert.Equal("busy", Bridge.ErrorCode(new IOException("x", unchecked((int)0x80070020))));
        Assert.Equal("network", Bridge.ErrorCode(new IOException("x", unchecked((int)0x80070035))));
        Assert.Null(Bridge.ErrorCode(new IOException("别的")));
        Assert.Null(Bridge.ErrorCode(new InvalidOperationException()));
    }

    [Fact]
    public void A_busy_clipboard_is_classified()
    {
        // As with a real clipboard failure, the runtime builds the COMException from the HRESULT (CLIPBRD_E_CANT_OPEN, E_FAIL)
        Assert.Equal("clipboardBusy", Bridge.ErrorCode(System.Runtime.InteropServices.Marshal.GetExceptionForHR(unchecked((int)0x800401D0))!));
        Assert.Null(Bridge.ErrorCode(System.Runtime.InteropServices.Marshal.GetExceptionForHR(unchecked((int)0x80004005))!));
    }
}
