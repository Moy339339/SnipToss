using System.IO;
using System.Windows.Threading;
using SnipToss.App;

namespace AppTests;

/// <summary>
/// Detecting files that changed on disk (ChangeWatch.cs): the notes folder (an agent or another program edited notes) and the items
/// (an agent edited an image per the notes). Both poll once a second with a DispatcherTimer: the test runs a Dispatcher on an STA
/// thread and waits for the notification or a timeout
/// </summary>
public class ChangeWatchTests
{
    /// <summary>Builds the object under test on an STA thread and pumps the Dispatcher until `until` holds or the timeout passes
    /// (returns whether it held)</summary>
    static bool Pump(Func<bool> until, TimeSpan timeout)
    {
        var frame = new DispatcherFrame();
        var deadline = DateTime.UtcNow + timeout;
        var poll = new DispatcherTimer(TimeSpan.FromMilliseconds(50), DispatcherPriority.Background, (_, _) =>
        {
            if (until() || DateTime.UtcNow > deadline) frame.Continue = false;
        }, Dispatcher.CurrentDispatcher);
        poll.Start();
        Dispatcher.PushFrame(frame);
        poll.Stop();
        return until();
    }

    static readonly TimeSpan Soon = TimeSpan.FromSeconds(6);
    static readonly TimeSpan Quiet = TimeSpan.FromSeconds(2.5);

    static string Annotations(string home) => Directory.CreateDirectory(Path.Combine(home, ".sniptoss", "annotations")).FullName;

    [Fact]
    public void Notes_file_changed_on_disk_notifies_once_with_the_files_read()
    {
        using var dir = new TempDir();
        var file = Path.Combine(Annotations(dir.Path), "hero.png.json");
        File.WriteAllText(file, "{}");
        CaptureTests.OnSta(() =>
        {
            var calls = new List<(string home, List<object> files)>();
            using var watcher = new AnnotationWatcher(Dispatcher.CurrentDispatcher, (h, f, _) => calls.Add((h, f)));
            watcher.Watch(dir.Path);
            Assert.False(Pump(() => calls.Count > 0, Quiet)); // no change, no notification
            File.WriteAllText(file, """{ "changed": true }""");
            Assert.True(Pump(() => calls.Count > 0, Soon));
            Assert.Equal(dir.Path, calls[0].home);
            Assert.Single(calls[0].files);
            Assert.False(Pump(() => calls.Count > 1, Quiet)); // one change notifies only once
        });
    }

    [Fact]
    public void Notes_folder_missing_at_first_still_notifies_once_it_is_created_elsewhere()
    {
        using var dir = new TempDir();
        CaptureTests.OnSta(() =>
        {
            var calls = 0;
            using var watcher = new AnnotationWatcher(Dispatcher.CurrentDispatcher, (_, _, _) => calls++);
            watcher.Watch(dir.Path);
            File.WriteAllText(Path.Combine(Annotations(dir.Path), "a.json"), "{}");
            Assert.True(Pump(() => calls > 0, Soon));
        });
    }

    [Fact]
    public void Project_folder_vanishing_entirely_is_not_treated_as_all_notes_deleted()
    {
        using var dir = new TempDir();
        var home = Directory.CreateDirectory(dir.File("project")).FullName;
        File.WriteAllText(Path.Combine(Annotations(home), "a.json"), "{}");
        CaptureTests.OnSta(() =>
        {
            var calls = 0;
            using var watcher = new AnnotationWatcher(Dispatcher.CurrentDispatcher, (_, _, _) => calls++);
            watcher.Watch(home);
            Directory.Delete(home, recursive: true);
            Assert.False(Pump(() => calls > 0, Quiet));
        });
    }

    [Fact]
    public void Does_not_poll_while_the_window_is_hidden_and_checks_at_once_when_shown()
    {
        using var dir = new TempDir();
        var file = Path.Combine(Annotations(dir.Path), "a.json");
        File.WriteAllText(file, "{}");
        CaptureTests.OnSta(() =>
        {
            var calls = 0;
            using var watcher = new AnnotationWatcher(Dispatcher.CurrentDispatcher, (_, _, _) => calls++);
            watcher.Watch(dir.Path);
            watcher.Pause(true);
            File.WriteAllText(file, """{ "changed": true }""");
            Assert.False(Pump(() => calls > 0, Quiet));
            watcher.Pause(false);
            Assert.True(Pump(() => calls > 0, TimeSpan.FromSeconds(1.5)));
        });
    }

    [Fact]
    public void Item_being_viewed_changed_notifies_the_library_entry_containing_it()
    {
        using var dir = new TempDir();
        var folder = Directory.CreateDirectory(dir.File("assets")).FullName;
        var hero = Path.Combine(folder, "hero.png");
        File.WriteAllBytes(hero, new byte[100]);
        var settings = Settings.LoadFrom(dir.File("settings.json"));
        settings.Library = [new LibraryEntry { Path = folder }];
        settings.Selected = hero;
        CaptureTests.OnSta(() =>
        {
            var calls = new List<IReadOnlyList<string>>();
            using var watcher = new MaterialWatcher(Dispatcher.CurrentDispatcher, settings, calls.Add);
            Assert.False(Pump(() => calls.Count > 0, Quiet)); // the first pass only records the starting point
            File.WriteAllBytes(hero, new byte[200]);
            Assert.True(Pump(() => calls.Count > 0, Soon));
            Assert.Equal([folder], calls[0]);
        });
    }

    [Fact]
    public void A_drive_that_has_not_answered_yet_records_nothing_instead_of_not_connected_so_its_answer_is_not_announced_as_a_change()
    {
        var signed = 0;
        string Sign()
        {
            signed++;
            return "sig";
        }
        Assert.Equal("sig", MaterialWatcher.SignatureFor(true, Sign));
        Assert.Equal("offline", MaterialWatcher.SignatureFor(false, Sign));
        Assert.Null(MaterialWatcher.SignatureFor(null, Sign));
        Assert.Equal(1, signed); // the disk is read only when the drive is there
    }

    [Theory]
    [InlineData("")]
    [InlineData("E:\\a\u0000b.png")]
    public void Paths_corrupted_by_hand_editing_the_settings_file_count_as_missing_and_do_not_throw(string path) => Assert.Equal("missing", MaterialWatcher.FileSignature(path));

    [Fact]
    public void Item_signature_changes_with_size_or_modified_time_and_a_non_item_file_is_called_other()
    {
        using var dir = new TempDir();
        var png = dir.File("a.png");
        File.WriteAllBytes(png, new byte[10]);
        var first = MaterialWatcher.FileSignature(png);
        File.WriteAllBytes(png, new byte[20]);
        Assert.NotEqual(first, MaterialWatcher.FileSignature(png));
        File.WriteAllText(dir.File("notes.txt"), "x");
        Assert.Equal("other", MaterialWatcher.FileSignature(dir.File("notes.txt")));
        Assert.Equal("missing", MaterialWatcher.FileSignature(dir.File("没有.png")));
    }
}
