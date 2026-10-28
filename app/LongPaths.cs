using System.ComponentModel;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using static SnipToss.App.Native;

namespace SnipToss.App;

/// <summary>
/// Item paths longer than 260 characters: WebView2 (Chromium) can't read them: mapping the virtual host to one fails, and mapping to \\?\C:\ can't even read short paths.
/// The workaround: under %LOCALAPPDATA%\SnipToss\paths\ make a short directory junction to the folder holding the item, and the UI reads through it (virtual host paths.sniptoss.example).
/// The shell itself (.NET) reads and writes long paths without trouble, and notes are written to the item project's .sniptoss as usual.
/// A junction can only point at a local drive: network paths that are too long still can't be read, and the UI explains why (the item's longPath)
/// </summary>
static class LongPaths
{
    /// <summary>Chromium follows MAX_PATH (260, including the terminating 0); leave some margin</summary>
    public const int Limit = 250;

    public const string Host = "paths.sniptoss.example";

    /// <summary>All junctions are created here (tests swap in a temp directory)</summary>
    public static string Root { get; internal set; } = Path.Combine(AppPaths.LocalDir, "paths");

    public static bool TooLong(string path) => path.Length > Limit;

    static readonly Lock gate = new();
    static readonly Dictionary<string, string?> aliases = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>The part after Host in the URL going through the short junction (junction name/file name); null if it can't be created (network path, error)</summary>
    public static string? AliasOf(string file)
    {
        var dir = Path.GetDirectoryName(file)!;
        string? name;
        lock (gate)
        {
            if (!aliases.TryGetValue(dir, out name)) aliases[dir] = name = TryLink(dir);
        }
        return name is null ? null : $"{name}/{Uri.EscapeDataString(Path.GetFileName(file))}";
    }

    static string? TryLink(string dir)
    {
        if (dir.StartsWith(@"\\", StringComparison.Ordinal)) return null;
        var name = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(dir.ToLowerInvariant())))[..16].ToLowerInvariant();
        var link = Path.Combine(Root, name);
        try
        {
            Directory.CreateDirectory(Root);
            var existing = new DirectoryInfo(link);
            if (existing.Exists)
            {
                if (string.Equals(existing.LinkTarget?.TrimEnd('\\'), dir.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase)) return name;
                if (!existing.Attributes.HasFlag(FileAttributes.ReparsePoint)) return null; // not a junction we made: don't touch it
                Directory.Delete(link); // not recursive: delete only the junction itself, never what it points at
            }
            CreateJunction(link, dir);
            return name;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or Win32Exception)
        {
            Log.Warn($"Long path: could not create a short directory junction for {dir}: {ex.Message}");
            return null;
        }
    }

    /// <summary>Removes the junctions made last time, at startup (only the junction itself, never the folder it points at): ones no longer used by the list aren't kept</summary>
    public static void Clean()
    {
        lock (gate) aliases.Clear();
        if (!Directory.Exists(Root)) return;
        foreach (var d in new DirectoryInfo(Root).EnumerateDirectories())
        {
            if (!d.Attributes.HasFlag(FileAttributes.ReparsePoint)) continue;
            try
            {
                d.Delete();
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                Log.Warn($"Long path: could not delete the old directory junction {d.Name}: {ex.Message}");
            }
        }
    }

    // ---------- Directory junctions (reparse points of the mount point type): need no administrator rights and no Developer Mode (symbolic links do) ----------

    const uint GenericWrite = 0x40000000;
    const uint BackupSemantics = 0x02000000;
    const uint OpenReparsePoint = 0x00200000;
    const uint SetReparsePoint = 0x000900A4;
    const uint MountPointTag = 0xA0000003;

    /// <summary>Creates at link a directory junction pointing at target (an absolute path on a local drive, any length)</summary>
    internal static void CreateJunction(string link, string target)
    {
        Directory.CreateDirectory(link);
        try
        {
            // REPARSE_DATA_BUFFER: Tag(4) DataLength(2) Reserved(2) | SubstituteNameOffset(2) SubstituteNameLength(2) PrintNameOffset(2) PrintNameLength(2) | two names (each with a trailing 0)
            var substitute = Encoding.Unicode.GetBytes(@"\??\" + Path.GetFullPath(target).TrimEnd('\\'));
            var print = Encoding.Unicode.GetBytes(Path.GetFullPath(target).TrimEnd('\\'));
            var dataLength = 8 + substitute.Length + 2 + print.Length + 2;
            var buffer = new byte[8 + dataLength];
            BitConverter.TryWriteBytes(buffer.AsSpan(0), MountPointTag);
            BitConverter.TryWriteBytes(buffer.AsSpan(4), (ushort)dataLength);
            BitConverter.TryWriteBytes(buffer.AsSpan(8), (ushort)0);
            BitConverter.TryWriteBytes(buffer.AsSpan(10), (ushort)substitute.Length);
            BitConverter.TryWriteBytes(buffer.AsSpan(12), (ushort)(substitute.Length + 2));
            BitConverter.TryWriteBytes(buffer.AsSpan(14), (ushort)print.Length);
            substitute.CopyTo(buffer, 16);
            print.CopyTo(buffer, 16 + substitute.Length + 2);
            using var handle = CreateFileW(link, GenericWrite, FileShare.None, IntPtr.Zero, FileMode.Open, BackupSemantics | OpenReparsePoint, IntPtr.Zero);
            if (handle.IsInvalid) throw new Win32Exception();
            if (!DeviceIoControl(handle, SetReparsePoint, buffer, buffer.Length, IntPtr.Zero, 0, out _, IntPtr.Zero)) throw new Win32Exception();
        }
        catch
        {
            Directory.Delete(link);
            throw;
        }
    }
}
