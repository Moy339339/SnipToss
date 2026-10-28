using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
using static SnipToss.App.Native;

namespace SnipToss.App;

/// <summary>
/// Writes a file safely (docs/adr/0005-write-protocol.md): write a uniquely named temp file in the same directory, flush it to disk, then replace the target in one step.
/// If the process crashes or the power goes out mid-write, the original file is still intact; two writers never step on each other's temp files.
/// When the target is being read by someone else (Windows refuses the replace), wait briefly and retry
/// </summary>
static class AtomicFile
{
    const int Attempts = 10;

    /// <param name="backup">When given, the replaced old file is kept under this name (the settings file's .bak)</param>
    public static void Write(string path, ReadOnlySpan<byte> bytes, string? backup = null)
    {
        var tmp = TempFor(path);
        try
        {
            using (var stream = new FileStream(tmp, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                stream.Write(bytes);
                stream.Flush(flushToDisk: true);
            }
            for (var i = 1; ; i++)
            {
                try
                {
                    Replace(tmp, path, backup);
                    return;
                }
                catch (Exception ex) when (Retryable(ex) && i < Attempts)
                {
                    Thread.Sleep(20 * i);
                }
            }
        }
        catch
        {
            TryDelete(tmp);
            throw;
        }
    }

    public static async Task WriteAsync(string path, byte[] bytes)
    {
        var tmp = TempFor(path);
        try
        {
            await using (var stream = new FileStream(tmp, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, useAsync: true))
            {
                await stream.WriteAsync(bytes);
                stream.Flush(flushToDisk: true);
            }
            for (var i = 1; ; i++)
            {
                try
                {
                    Replace(tmp, path, null);
                    return;
                }
                catch (Exception ex) when (Retryable(ex) && i < Attempts)
                {
                    await Task.Delay(20 * i);
                }
            }
        }
        catch
        {
            TryDelete(tmp);
            throw;
        }
    }

    /// <summary>
    /// Reads text without blocking writers (allows concurrent write, replace and delete); retries if the file can't be read at the instant it is being replaced.
    /// At that instant the old file is "delete pending" and Windows reports access denied when opening it (UnauthorizedAccessException, not IOException);
    /// without a retry, the UI reading while an agent writes back would throw
    /// </summary>
    public static string ReadAllText(string path)
    {
        for (var i = 1; ; i++)
        {
            try
            {
                using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                using var reader = new StreamReader(stream, System.Text.Encoding.UTF8);
                return reader.ReadToEnd();
            }
            catch (Exception ex) when (Retryable(ex) && i < Attempts)
            {
                Thread.Sleep(20 * i);
            }
        }
    }

    /// <summary>Same directory, leading dot (inconspicuous), process id plus a random string (two writers never collide), .tmp suffix (a watcher on *.json is not triggered by mistake)</summary>
    static string TempFor(string path)
    {
        var dir = Path.GetDirectoryName(Path.GetFullPath(path))!;
        Directory.CreateDirectory(dir);
        return Path.Combine(dir, $".{Path.GetFileName(path)}.{Environment.ProcessId}-{Guid.NewGuid():N}.tmp");
    }

    static void Replace(string tmp, string path, string? backup)
    {
        if (backup is not null && File.Exists(path)) File.Replace(tmp, path, backup, ignoreMetadataErrors: true);
        else if (!PosixRename(tmp, path)) File.Move(tmp, path, overwrite: true);
    }

    // ---------- POSIX-semantics rename (NTFS on Windows 10 1809 and later) ----------
    // A plain rename-replace (File.Move) is refused (access denied) while someone has the target open: with frequent readers the writer never gets a gap
    // and fails once its retries run out (with 8 writers plus constant reading, writers hit UnauthorizedAccessException).
    // With POSIX semantics the old file gives up its name immediately, and whoever has it open still reads the complete old content. Where unsupported (FAT, network drives, old systems) fall back to File.Move

    const uint Delete = 0x00010000;
    const uint Synchronize = 0x00100000;
    const int FileRenameInfoEx = 22;
    const uint ReplaceIfExists = 0x1;
    const uint PosixSemantics = 0x2;

    /// <summary>Renames from to to (replacing an existing file); returns false when the system or file system doesn't support it, so the caller falls back to a plain rename</summary>
    internal static bool PosixRename(string from, string to)
    {
        using var file = CreateFileW(from, Delete | Synchronize, FileShare.ReadWrite | FileShare.Delete, IntPtr.Zero, FileMode.Open, 0, IntPtr.Zero);
        if (file.IsInvalid) return false;
        // FILE_RENAME_INFO: Flags (4 bytes, pointer-aligned), RootDirectory (pointer), FileNameLength (4), FileName (UTF-16, no trailing 0 required)
        var name = @"\\?\" + Path.GetFullPath(to);
        var rootAt = IntPtr.Size;
        var lengthAt = rootAt + IntPtr.Size;
        var nameAt = lengthAt + 4;
        var size = nameAt + (name.Length + 1) * 2;
        var info = Marshal.AllocHGlobal(size);
        try
        {
            for (var i = 0; i < size; i++) Marshal.WriteByte(info, i, 0);
            Marshal.WriteInt32(info, 0, (int)(ReplaceIfExists | PosixSemantics));
            Marshal.WriteIntPtr(info, rootAt, IntPtr.Zero);
            Marshal.WriteInt32(info, lengthAt, name.Length * 2);
            Marshal.Copy(name.ToCharArray(), 0, info + nameAt, name.Length);
            return SetFileInformationByHandle(file, FileRenameInfoEx, info, (uint)size);
        }
        finally
        {
            Marshal.FreeHGlobal(info);
        }
    }

    /// <summary>The target is open in another program (sharing violation, Windows refuses the replace): usually fine after a short wait</summary>
    static bool Retryable(Exception ex) =>
        ex is UnauthorizedAccessException || (ex is IOException && ex is not FileNotFoundException and not DirectoryNotFoundException and not PathTooLongException);

    static void TryDelete(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch
        {
            // A leftover .tmp file harms nothing; it is never read on the next start
        }
    }
}
