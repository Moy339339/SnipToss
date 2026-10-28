using System.IO;
using System.Text;
using SnipToss.App;

namespace AppTests;

public class AtomicFileTests
{
    [Fact]
    public void Create_and_overwrite_both_write_correctly_leaving_no_temp_file()
    {
        using var dir = new TempDir();
        var path = dir.File("a.json");
        AtomicFile.Write(path, "1"u8);
        AtomicFile.Write(path, "22"u8);
        Assert.Equal("22", File.ReadAllText(path));
        Assert.Empty(Directory.GetFiles(dir.Path, "*.tmp"));
    }

    [Fact]
    public void Creates_the_directory_if_it_does_not_exist()
    {
        using var dir = new TempDir();
        var path = Path.Combine(dir.Path, "x", "y", "a.json");
        AtomicFile.Write(path, "ok"u8);
        Assert.Equal("ok", File.ReadAllText(path));
    }

    [Fact]
    public async Task Target_being_read_by_someone_else_waits_for_release_then_replaces()
    {
        using var dir = new TempDir();
        var path = dir.File("a.json");
        File.WriteAllText(path, "old");
        // Another program holds it open without allowing delete / replace (an editor, say) and closes it a moment later
        var reader = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        var release = Task.Run(async () =>
        {
            await Task.Delay(150);
            reader.Dispose();
        });

        await AtomicFile.WriteAsync(path, Encoding.UTF8.GetBytes("new"));
        await release;

        Assert.Equal("new", File.ReadAllText(path));
        Assert.Empty(Directory.GetFiles(dir.Path, "*.tmp"));
    }

    [Fact]
    public async Task Two_writers_writing_at_once_every_read_sees_complete_content()
    {
        using var dir = new TempDir();
        var path = dir.File("a.json");
        AtomicFile.Write(path, Encoding.UTF8.GetBytes(new string('a', 4096)));
        var writers = Enumerable.Range(0, 4).Select(w => Task.Run(() =>
        {
            for (var i = 0; i < 50; i++) AtomicFile.Write(path, Encoding.UTF8.GetBytes(new string((char)('a' + w), 4096)));
        })).ToArray();
        var torn = 0;
        while (!writers.All(t => t.IsCompleted))
        {
            var text = AtomicFile.ReadAllText(path);
            if (text.Length != 4096 || text.Distinct().Count() != 1) torn++;
        }
        await Task.WhenAll(writers);
        Assert.Equal(0, torn);
        Assert.Empty(Directory.GetFiles(dir.Path, "*.tmp"));
    }

    [Fact]
    public void Target_open_for_reading_is_still_replaced_and_the_reader_finishes_the_old_content()
    {
        // A plain rename would be refused (access denied) while someone has the file open; with frequent readers
        // the writer never finds a gap and fails once its retries run out
        using var dir = new TempDir();
        var path = dir.File("a.json");
        AtomicFile.Write(path, "old"u8);
        using (var reader = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
        {
            var watch = System.Diagnostics.Stopwatch.StartNew();
            AtomicFile.Write(path, "new"u8);
            Assert.True(watch.ElapsedMilliseconds < 100, $"Waited {watch.ElapsedMilliseconds} ms (retrying)");
            Assert.Equal("old", new StreamReader(reader).ReadToEnd());
        }
        Assert.Equal("new", AtomicFile.ReadAllText(path));
        Assert.Empty(Directory.GetFiles(dir.Path, "*.tmp"));
    }

    [Fact]
    public void POSIX_rename_replaces_an_existing_file()
    {
        using var dir = new TempDir();
        File.WriteAllText(dir.File("from.tmp"), "b");
        File.WriteAllText(dir.File("to.json"), "a");
        Assert.True(AtomicFile.PosixRename(dir.File("from.tmp"), dir.File("to.json")));
        Assert.Equal("b", File.ReadAllText(dir.File("to.json")));
        Assert.False(File.Exists(dir.File("from.tmp")));
    }

    [Fact]
    public void Replace_with_backup_keeps_the_old_content_in_the_backup()
    {
        using var dir = new TempDir();
        var path = dir.File("s.json");
        AtomicFile.Write(path, "v1"u8, backup: path + ".bak");
        Assert.False(File.Exists(path + ".bak")); // the first write has no old file to keep
        AtomicFile.Write(path, "v2"u8, backup: path + ".bak");
        Assert.Equal("v2", File.ReadAllText(path));
        Assert.Equal("v1", File.ReadAllText(path + ".bak"));
    }
}
