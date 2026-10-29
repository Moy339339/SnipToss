using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace SnipToss.App;

/// <summary>
/// Cross-process write lock (docs/adr/0005-write-protocol.md, "Lock"): a .&lt;file name&gt;.lock next to the notes file, acquired by creating it exclusively,
/// containing "process id, time, computer id" (MachineId), and deleted when done. The CLI (withFileLock in packages/cli/src/fs-store.ts) uses the same name and the same rules,
/// so when the UI, the CLI and several agents write the same notes file at once they take turns, and nobody can slip in between the pre-write comparison and the write.
/// Before, only the pre-write comparison existed: someone getting in between the compare and the swap (writing the temp file and flushing take tens of milliseconds) would overwrite what another had just written.
/// The lock created here is DeleteOnClose, so the system removes it even if the process crashes; for one the CLI left behind after a crash, check whether the writing process is still alive and how long it has been untouched
/// </summary>
static class FileLock
{
    /// <summary>How long to wait for the lock: other writers need only a few milliseconds per write, so failing to get it after this long usually means it is stuck</summary>
    static readonly TimeSpan Wait = TimeSpan.FromSeconds(10);
    /// <summary>If the lock file hasn't been touched for this long and the process that wrote it is gone, treat it as left behind by a crash</summary>
    static readonly TimeSpan Stale = TimeSpan.FromSeconds(10);
    /// <summary>Creating keeps being refused (access denied) for this long: stop waiting, the folder isn't writable. Someone else's lock being deleted is refused too, but only for a blink</summary>
    static readonly TimeSpan DeniedLimit = TimeSpan.FromSeconds(1);

    /// <summary>
    /// What the lock says about the computer: the first 16 hex digits of the SHA-256 of the lowercased name, not the name itself. A lock the CLI leaves
    /// behind after a crash stays in the project folder, and computer names often carry the owner's name; the hash still tells this computer from
    /// another one. The CLI (machineId in fs-store.ts) and the Mac shell compute the same value (tests/golden/lock-machine.json)
    /// </summary>
    internal static string MachineId(string name) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(name.ToLowerInvariant())))[..16];

    static readonly string Machine = MachineId(Environment.MachineName);

    public static string PathFor(string file)
    {
        var full = Path.GetFullPath(file);
        return Path.Combine(Path.GetDirectoryName(full)!, $".{Path.GetFileName(full)}.lock");
    }

    /// <summary>Takes the lock (released and the lock file deleted on Dispose). wait: the longest to wait, 10 seconds if omitted (only tests pass it)</summary>
    public static async Task<IDisposable> AcquireAsync(string file, TimeSpan? wait = null)
    {
        var path = PathFor(file);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var watch = Stopwatch.StartNew();
        Stopwatch? denied = null;
        while (true)
        {
            try
            {
                var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.Read | FileShare.Delete, 64, FileOptions.DeleteOnClose);
                stream.Write(Encoding.UTF8.GetBytes($"{Environment.ProcessId} {DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()} {Machine}"));
                stream.Flush();
                return stream;
            }
            catch (IOException ex) when ((ex.HResult & 0xFFFF) is 80 or 183 or 32)
            {
                // Someone already holds it (ERROR_FILE_EXISTS / ALREADY_EXISTS), or it is being read (sharing violation)
                denied = null;
                if (StaleContent(path) is { } stale) TryDelete(path, stale);
            }
            catch (UnauthorizedAccessException)
            {
                // Someone else's lock is being deleted (on Windows nobody can open a half-deleted file); a short wait fixes it. Refused continuously for a second means the folder isn't writable, so don't wait the full 10 seconds
                denied ??= Stopwatch.StartNew();
                if (denied.Elapsed > DeniedLimit) throw;
            }
            // Carries ERROR_LOCK_VIOLATION: Bridge.ErrorCode maps it to busy, and the UI says "The file is in use by another program … Try again shortly" from its message; this English text only goes to the log
            if (watch.Elapsed > (wait ?? Wait)) throw new IOException($"Annotation file stayed locked by another writer: {path}", unchecked((int)0x80070021));
            await Task.Delay(Random.Shared.Next(2, 12));
        }
    }

    /// <summary>Returns the lock's content if a crashed process left it behind (to double-check before deleting), null if it is still valid. Left behind means the writing process is gone, or it hasn't been touched for a long time</summary>
    static string? StaleContent(string path)
    {
        try
        {
            var text = ReadLock(path);
            var parts = text.Split(' ');
            var pid = int.TryParse(parts[0], out var p) ? p : 0;
            // Written by another computer (the item is on a network drive): the process id belongs to that computer and can't be checked here, so only look at how long it has been untouched
            // (the plain name: a lock written before the hash was used)
            var here = parts.Length < 3 || parts[2] == Machine || string.Equals(parts[2], Environment.MachineName, StringComparison.OrdinalIgnoreCase);
            if (here && pid > 0 && !Alive(pid)) return text;
            return DateTime.UtcNow - File.GetLastWriteTimeUtc(path) > Stale ? text : null;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return null; // just deleted, or not fully written yet: treat it as still valid and look again next round
        }
    }

    /// <summary>
    /// Reads the lock file while allowing others to delete it: it used to use File.ReadAllText (which forbids deletion), so when the CLI released the lock at that moment it couldn't be deleted,
    /// the lock stayed in place and everyone waited the full 10 seconds (when the shell and the CLI wrote together)
    /// </summary>
    static string ReadLock(string path)
    {
        using var s = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        return new StreamReader(s).ReadToEnd();
    }

    static bool Alive(int pid)
    {
        try
        {
            using var p = Process.GetProcessById(pid);
            return !p.HasExited;
        }
        catch (ArgumentException)
        {
            return false;
        }
        catch (InvalidOperationException)
        {
            return false;
        }
    }

    /// <summary>Before deleting, read it again and check it is still the same lock: someone may have just released it and put their own new lock there, which must not be deleted</summary>
    static void TryDelete(string path, string stale)
    {
        try
        {
            if (ReadLock(path) == stale) File.Delete(path);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Someone else deleted it first, or is using it: look again next round
        }
    }
}
