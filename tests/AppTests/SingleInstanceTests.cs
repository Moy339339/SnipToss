using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using SnipToss.App;

namespace AppTests;

/// <summary>
/// A second process hands its paths to the window that is already open. Reading the message must have a timeout and a size limit:
/// otherwise a client that connects and says nothing blocks the listener thread forever, and every later right-click open starts a new window
/// </summary>
public class SingleInstanceTests
{
    [Fact]
    public void Reads_the_path_list_normally()
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(new[] { @"E:\a.png", @"E:\素材\b.mp4" });
        var args = SingleInstance.ReadMessage(new MemoryStream(bytes), 1 << 20, TimeSpan.FromSeconds(1));
        Assert.Equal([@"E:\a.png", @"E:\素材\b.mp4"], args);
    }

    [Fact]
    public void An_empty_message_has_no_paths()
    {
        Assert.Empty(SingleInstance.ReadMessage(new MemoryStream(), 1 << 20, TimeSpan.FromSeconds(1)));
    }

    [Fact]
    public void Bad_data_throws_and_is_caught_by_the_listener_loop()
    {
        Assert.ThrowsAny<JsonException>(() => SingleInstance.ReadMessage(new MemoryStream("not json"u8.ToArray()), 1 << 20, TimeSpan.FromSeconds(1)));
    }

    [Fact]
    public void An_oversized_message_is_abandoned_without_reading_it_all()
    {
        var big = new MemoryStream(Encoding.UTF8.GetBytes("[\"" + new string('a', 5000) + "\"]"));
        Assert.Throws<InvalidDataException>(() => SingleInstance.ReadMessage(big, 1000, TimeSpan.FromSeconds(1)));
    }

    [Fact]
    public void A_client_that_connects_and_stays_silent_times_out_and_does_not_block_forever()
    {
        var started = DateTime.Now;
        Assert.ThrowsAny<OperationCanceledException>(() => SingleInstance.ReadMessage(new SilentStream(), 1 << 20, TimeSpan.FromMilliseconds(200)));
        Assert.True(DateTime.Now - started < TimeSpan.FromSeconds(5));
    }

    [Fact]
    public void A_null_in_the_array_is_skipped()
    {
        var args = SingleInstance.ReadMessage(new MemoryStream("[\"E:\\\\a.png\", null]"u8.ToArray()), 1 << 20, TimeSpan.FromSeconds(1));
        Assert.Equal([@"E:\a.png"], args);
    }

    [Fact]
    public void Paths_handed_over_before_the_window_exists_are_queued_and_delivered_in_order_once_it_does()
    {
        // Listening must not wait for the window: a multi-select right-click in File Explorer starts several processes at once,
        // and on a slow cold start the others could not connect and each opened a window of its own
        var inbox = new ArgsInbox();
        var got = new List<string>();
        inbox.Post([@"E:\a.png"]);
        inbox.Post([@"E:\b.png", @"E:\c.png"]);
        Assert.Empty(got);
        inbox.SetHandler(a => got.AddRange(a));
        Assert.Equal([@"E:\a.png", @"E:\b.png", @"E:\c.png"], got);
        inbox.Post([@"E:\d.png"]);
        Assert.Equal(@"E:\d.png", got[^1]);
    }

    [Fact]
    public void Single_instance_is_keyed_by_the_settings_file_case_differences_count_as_the_same_and_different_settings_stay_separate()
    {
        Assert.Equal(SingleInstance.IdFor(@"C:\Users\a\AppData\Roaming\SnipToss\settings.json"), SingleInstance.IdFor(@"c:\users\A\appdata\roaming\sniptoss\SETTINGS.json"));
        Assert.NotEqual(SingleInstance.IdFor(@"C:\x\settings.json"), SingleInstance.IdFor(@"C:\y\settings.json"));
        Assert.Matches("^[0-9A-F]{16}$", SingleInstance.IdFor(@"C:\x\settings.json"));
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr CommandLineToArgvW(string cmdLine, out int argc);

    static string[] Parse(string cmdLine)
    {
        var argv = CommandLineToArgvW(cmdLine, out var n);
        try
        {
            return Enumerable.Range(0, n).Select(i => Marshal.PtrToStringUni(Marshal.ReadIntPtr(argv, i * IntPtr.Size))!).ToArray();
        }
        finally
        {
            Marshal.FreeHGlobal(argv);
        }
    }

    [Theory]
    [InlineData(@"E:\", @"E:\")]
    [InlineData(@"\\srv\share\", @"\\srv\share")]
    [InlineData(@"E:\素材\", @"E:\素材")]
    [InlineData(@"E:\素材", @"E:\素材")]
    public void Opening_from_the_context_menu_on_blank_space_in_a_drive_root_still_yields_a_recognised_path(string folder, string expected)
    {
        // The context menu command is "exe" "%V": when %V is E:\ the whole line is "exe" "E:\", Windows treats \" as an escaped quote,
        // and the program receives E:" (it used to report "invalid path")
        var raw = Parse($"\"C:\\x\\SnipToss.exe\" \"{folder}\"")[1];
        if (folder.EndsWith('\\')) Assert.EndsWith("\"", raw);
        Assert.Equal(expected, Library.Norm(Program.ArgPath(raw)));
    }

    [Fact]
    public void Opens_from_outside_while_the_UI_is_not_listening_are_queued_and_taken_by_the_first_library_read_of_this_load_and_not_given_again()
    {
        var pending = new PendingOpens();
        pending.Stash(new Library.AddResult([@"E:\a.png"], @"E:\a.png", ["找不到文件或文件夹：E:\\b.png"], [new(@"E:\旧\片子", @"E:\新\片子")]));
        pending.Stash(new Library.AddResult([], @"E:\c.png", ["不支持此文件类型（.txt）：d.txt"]));
        Assert.False(pending.Listening);
        var first = pending.Take();
        Assert.True(pending.Listening);
        Assert.Equal(@"E:\c.png", first.Focus);
        Assert.Equal(["找不到文件或文件夹：E:\\b.png", "不支持此文件类型（.txt）：d.txt"], first.Skipped);
        Assert.Equal([new Library.Relocation(@"E:\旧\片子", @"E:\新\片子")], first.Relocated);
        var again = pending.Take();
        Assert.Null(again.Focus);
        Assert.Empty(again.Skipped);
    }

    [Fact]
    public void Entries_queued_before_a_page_reload_cannot_be_taken_by_the_old_page_and_the_new_page_gets_them()
    {
        // Something on a newly connected drive: the shell queues the locate request and then reloads the page.
        // The old page may still read the library once before the reload (F5, items changed),
        // and that read used to take the locate request and the notice and throw them away
        var pending = new PendingOpens();
        pending.Take(); // the page has loaded and is listening
        pending.Stash(new Library.AddResult([@"Y:\a.png"], @"Y:\a.png", ["找不到文件或文件夹：Y:\\b.png"]));
        Assert.Null(pending.Take().Focus);
        pending.Navigating();
        var r = pending.Take();
        Assert.Equal(@"Y:\a.png", r.Focus);
        Assert.Equal(["找不到文件或文件夹：Y:\\b.png"], r.Skipped);
    }

    /// <summary>A stream that never delivers data (simulates a stuck client)</summary>
    sealed class SilentStream : Stream
    {
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => 0; set => throw new NotSupportedException(); }
        public override void Flush() { }
        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        {
            await Task.Delay(Timeout.Infinite, cancellationToken);
            return 0;
        }
    }
}
