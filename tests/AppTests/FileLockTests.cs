using System.Diagnostics;
using System.IO;
using System.Security.Principal;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using SnipToss.App;

namespace AppTests;

/// <summary>The cross-process write lock (app/FileLock.cs, the "Lock" section of docs/adr/0005-write-protocol.md)</summary>
public class FileLockTests
{
    [Fact]
    public async Task Taking_the_lock_creates_a_lock_file_alongside_and_releasing_deletes_it()
    {
        using var dir = new TempDir();
        var file = dir.File("a.json");
        var lockPath = FileLock.PathFor(file);
        Assert.Equal(dir.File(".a.json.lock"), lockPath); // the CLI (withFileLock in fs-store.ts) uses the same name

        using (await FileLock.AcquireAsync(file))
        {
            Assert.True(File.Exists(lockPath));
            using var read = new FileStream(lockPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            Assert.StartsWith($"{Environment.ProcessId} ", new StreamReader(read).ReadToEnd());
        }
        Assert.False(File.Exists(lockPath));
    }

    [Fact]
    public async Task Second_writer_gets_the_lock_only_after_the_first_releases_it()
    {
        using var dir = new TempDir();
        var file = dir.File("a.json");
        var first = await FileLock.AcquireAsync(file);
        var second = FileLock.AcquireAsync(file);
        await Task.Delay(300);
        Assert.False(second.IsCompleted, "The second one got the lock while the first still held it");

        first.Dispose();
        var got = await second.WaitAsync(TimeSpan.FromSeconds(3));
        got.Dispose();
    }

    [Fact]
    public async Task Lock_whose_owner_process_is_gone_is_reclaimed_at_once()
    {
        // The CLI is killed while holding the lock: its lock file does not disappear by itself
        // (the shell's is opened with DeleteOnClose, so the OS removes it)
        using var dir = new TempDir();
        var file = dir.File("a.json");
        int deadPid;
        using (var p = Process.Start(new ProcessStartInfo("cmd.exe", "/c exit") { CreateNoWindow = true, UseShellExecute = false })!)
        {
            p.WaitForExit();
            deadPid = p.Id;
        }
        File.WriteAllText(FileLock.PathFor(file), $"{deadPid} {DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}");

        var watch = Stopwatch.StartNew();
        using (await FileLock.AcquireAsync(file, TimeSpan.FromSeconds(3))) { }
        Assert.True(watch.ElapsedMilliseconds < 1000, $"Waited {watch.ElapsedMilliseconds} ms");
    }

    [Fact]
    public async Task Lock_written_by_another_computer_is_not_judged_by_process_id_and_a_fresh_one_is_not_taken()
    {
        // The item is on a network drive and an agent writes back from another computer: the process id in the lock belongs to that computer,
        // so finding no such process here does not mean it crashed
        using var dir = new TempDir();
        var file = dir.File("a.json");
        var lockPath = FileLock.PathFor(file);
        int deadPid;
        using (var p = Process.Start(new ProcessStartInfo("cmd.exe", "/c exit") { CreateNoWindow = true, UseShellExecute = false })!)
        {
            p.WaitForExit();
            deadPid = p.Id;
        }
        File.WriteAllText(lockPath, $"{deadPid} {DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()} SOME-OTHER-PC");

        await Assert.ThrowsAsync<IOException>(() => FileLock.AcquireAsync(file, TimeSpan.FromMilliseconds(500)));
        Assert.True(File.Exists(lockPath), "A lock held by another computer was deleted");
    }

    [Fact]
    public async Task Lock_whose_process_exists_but_has_not_been_touched_for_long_is_treated_as_stale()
    {
        // The process id was reused by another process: it looks alive, but the lock file has not been touched for a minute
        using var dir = new TempDir();
        var file = dir.File("a.json");
        var lockPath = FileLock.PathFor(file);
        File.WriteAllText(lockPath, $"{Environment.ProcessId} 0");
        File.SetLastWriteTimeUtc(lockPath, DateTime.UtcNow.AddMinutes(-1));

        var watch = Stopwatch.StartNew();
        using (await FileLock.AcquireAsync(file, TimeSpan.FromSeconds(3))) { }
        Assert.True(watch.ElapsedMilliseconds < 1000, $"Waited {watch.ElapsedMilliseconds} ms");
    }

    [Fact]
    public async Task Lock_just_taken_by_a_live_process_is_not_stolen_and_waiting_gives_up_at_the_deadline()
    {
        using var dir = new TempDir();
        var file = dir.File("a.json");
        var lockPath = FileLock.PathFor(file);
        File.WriteAllText(lockPath, $"{Environment.ProcessId} {DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}");

        var watch = Stopwatch.StartNew();
        var ex = await Assert.ThrowsAsync<IOException>(() => FileLock.AcquireAsync(file, TimeSpan.FromMilliseconds(500)));
        Assert.Equal("busy", Bridge.ErrorCode(ex)); // the UI explains it as "in use by another program, try again shortly"
        Assert.True(watch.ElapsedMilliseconds >= 500, $"Waited only {watch.ElapsedMilliseconds} ms");
        Assert.True(File.Exists(lockPath), "Someone else's lock was deleted");
    }

    [Fact]
    public async Task Folder_that_refuses_writes_gives_up_after_a_little_over_a_second_not_the_full_ten()
    {
        using var dir = new TempDir();
        var root = Path.Combine(dir.Path, "readonly");
        Directory.CreateDirectory(root);
        var user = WindowsIdentity.GetCurrent().Name;
        // Deny only "create files, create subfolders, delete contents": icacls' W includes SYNCHRONIZE, and denying that blocks even reading
        Icacls(root, "/deny", $"{user}:(CI)(WD,AD,DC)");
        try
        {
            var watch = Stopwatch.StartNew();
            await Assert.ThrowsAsync<UnauthorizedAccessException>(() => FileLock.AcquireAsync(Path.Combine(root, "a.json")));
            Assert.True(watch.ElapsedMilliseconds < 3000, $"Waited {watch.ElapsedMilliseconds} ms");
        }
        finally
        {
            Icacls(root, "/remove:d", user);
        }
    }

    /// <summary>
    /// The shell half of the 1.0 exit criterion "thousands of interleaved writes lose no change": the shell's writes (from the UI via writeAnnotation,
    /// Bridge.WriteIfUnchangedAsync) and the CLI's write-backs (two node processes, packages/cli/test/stress/writer.mjs) add replies
    /// to the same note at the same time, and not one may be missing.
    /// The shell side does what the UI does: read → modify → write with the fingerprint it read; if rejected (someone just wrote), read again and retry
    /// </summary>
    [Fact(Timeout = 180_000)]
    public async Task Shell_and_CLI_writing_the_same_file_at_once_lose_no_change()
    {
        var repo = RepoRoot();
        var writer = Path.Combine(repo, "packages", "cli", "test", "stress", "writer.mjs");
        Assert.True(File.Exists(Path.Combine(repo, "packages", "cli", "dist", "fs-store.js")), "The CLI isn't built yet: run npm run build first");

        using var dir = new TempDir();
        CopyDir(Path.Combine(repo, "packages", "core", "test", "fixture"), dir.Path);
        var full = Path.Combine(dir.Path, ".sniptoss", "annotations", "assets__hero.png.json");
        const string id = "k3f9a2";
        const int each = 200;
        var before = Replies(File.ReadAllText(full)).Count;

        var nodes = new[] { "n0", "n1" }.Select(tag =>
        {
            var psi = new ProcessStartInfo("node") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardError = true };
            foreach (var a in new[] { writer, dir.Path, id, tag, each.ToString(System.Globalization.CultureInfo.InvariantCulture) }) psi.ArgumentList.Add(a);
            return Process.Start(psi)!;
        }).ToArray();
        try
        {
            // Wait until the CLI has really started writing, so the shell side does not finish before node is up and the interleaving goes untested
            var wait = Stopwatch.StartNew();
            while (!AtomicFile.ReadAllText(full).Contains("\"n0-", StringComparison.Ordinal) && wait.Elapsed < TimeSpan.FromSeconds(20)) await Task.Delay(5);

            var rejected = 0;
            for (var k = 0; k < each; k++)
            {
                while (true)
                {
                    var text = AtomicFile.ReadAllText(full);
                    var doc = JsonNode.Parse(text)!;
                    var target = doc["annotations"]!.AsArray().First(a => (string?)a!["id"] == id)!;
                    target["replies"]!.AsArray().Add(new JsonObject { ["author"] = "shell", ["body"] = $"cs-{k}", ["at"] = DateTimeOffset.UtcNow.ToString("o", System.Globalization.CultureInfo.InvariantCulture) });
                    var next = doc.ToJsonString(Indented) + "\n";
                    var (written, _, _) = await Bridge.WriteIfUnchangedAsync(full, next, true, Bridge.TextSha256(text));
                    if (written) break;
                    rejected++;
                }
            }

            foreach (var p in nodes)
            {
                var err = await p.StandardError.ReadToEndAsync();
                await p.WaitForExitAsync();
                Assert.True(p.ExitCode == 0, $"The CLI writer failed: {err}");
            }

            var after = Replies(File.ReadAllText(full)).Skip(before).ToList();
            var expected = new[] { "n0", "n1", "cs" }.SelectMany(t => Enumerable.Range(0, each).Select(k => $"{t}-{k}")).ToList();
            var lost = expected.Except(after).ToList();
            Assert.True(lost.Count == 0, $"Lost {lost.Count} changes, e.g. {string.Join(", ", lost.Take(5))}");
            Assert.Equal(expected.Count, after.Count);
            // They really interleaved: the shell's writes sit between the CLI's, and the shell was rejected at least once (someone had just written)
            var firstCs = after.FindIndex(b => b.StartsWith("cs-", StringComparison.Ordinal));
            var lastCs = after.FindLastIndex(b => b.StartsWith("cs-", StringComparison.Ordinal));
            Assert.Contains(after.Skip(firstCs).Take(lastCs - firstCs), b => b.StartsWith('n'));
            Assert.True(rejected > 0, "The shell was never rejected: the CLI and the shell never wrote at the same time");
        }
        finally
        {
            foreach (var p in nodes)
            {
                if (!p.HasExited) p.Kill();
                p.Dispose();
            }
        }
    }

    static readonly JsonSerializerOptions Indented = new() { WriteIndented = true, Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    static List<string> Replies(string text) =>
        JsonNode.Parse(text)!["annotations"]!.AsArray().First(a => (string?)a!["id"] == "k3f9a2")!["replies"]!.AsArray().Select(r => (string)r!["body"]!).ToList();

    static string RepoRoot()
    {
        for (var d = new DirectoryInfo(AppContext.BaseDirectory); d is not null; d = d.Parent)
        {
            if (File.Exists(Path.Combine(d.FullName, "packages", "cli", "test", "stress", "writer.mjs"))) return d.FullName;
        }
        throw new InvalidOperationException("找不到项目根目录");
    }

    static void CopyDir(string from, string to)
    {
        foreach (var d in Directory.EnumerateDirectories(from, "*", SearchOption.AllDirectories)) Directory.CreateDirectory(Path.Combine(to, Path.GetRelativePath(from, d)));
        foreach (var f in Directory.EnumerateFiles(from, "*", SearchOption.AllDirectories)) File.Copy(f, Path.Combine(to, Path.GetRelativePath(from, f)));
    }

    static void Icacls(params string[] args)
    {
        var psi = new ProcessStartInfo("icacls") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (var a in args) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi)!;
        var output = p.StandardOutput.ReadToEnd() + p.StandardError.ReadToEnd();
        p.WaitForExit();
        Assert.True(p.ExitCode == 0, $"icacls {string.Join(' ', args)}：{output}");
    }
}
