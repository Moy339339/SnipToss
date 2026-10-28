using System.IO;
using System.Security.Cryptography;
using System.Text.Json;

namespace SnipToss.App;

/// <summary>
/// SHA-256 of items, recorded locally keyed by "full path + size + modification time" (LocalDir\cache\sha256.json). The UI needs to recognize which notes were written on an older version of an item (ADR-0008),
/// so it must know the item's current fingerprint; reading a large video takes seconds, and the same file isn't read again on the next start. At most Max entries are kept, the least recently used dropped beyond that; a corrupt or unreadable record file counts as empty (it is only a cache)
/// </summary>
static class HashCache
{
    static string location = Path.Combine(AppPaths.LocalDir, "cache", "sha256.json");

    /// <summary>Tests point it at a temp directory; setting it (even to the same value) makes the next use re-read the record file</summary>
    internal static string Location
    {
        get => location;
        set
        {
            lock (Gate)
            {
                location = value;
                entries = null;
            }
        }
    }

    internal const int Max = 4000;

    sealed record Entry(long Size, long Ticks, string Sha, long Used);

    static readonly Lock Gate = new();
    static Dictionary<string, Entry>? entries;

    public static async Task<string> Sha256Async(string path)
    {
        if (!Path.IsPathRooted(path)) throw new ArgumentException($"Absolute path required: {path}");
        var info = new FileInfo(path);
        var (size, ticks) = (info.Length, info.LastWriteTimeUtc.Ticks);
        var key = Path.GetFullPath(path).ToUpperInvariant();
        lock (Gate)
        {
            var map = Loaded();
            if (map.TryGetValue(key, out var hit) && hit.Size == size && hit.Ticks == ticks)
            {
                map[key] = hit with { Used = DateTime.UtcNow.Ticks };
                return hit.Sha;
            }
        }
        var sha = await ComputeAsync(path);
        // The file changed again during the few seconds of hashing (an agent just re-exported it): the result may not belong to either version, so it isn't recorded
        info.Refresh();
        if (info.Exists && info.Length == size && info.LastWriteTimeUtc.Ticks == ticks)
        {
            byte[] bytes;
            lock (Gate)
            {
                var map = Loaded();
                map[key] = new Entry(size, ticks, sha, DateTime.UtcNow.Ticks);
                foreach (var old in map.OrderBy(p => p.Value.Used).Take(Math.Max(0, map.Count - Max)).Select(p => p.Key).ToList()) map.Remove(old);
                bytes = JsonSerializer.SerializeToUtf8Bytes(map);
            }
            try
            {
                await AtomicFile.WriteAsync(Location, bytes);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                Log.Info($"Hash cache not saved: {ex.Message}");
            }
        }
        return sha;
    }

    /// <summary>Doesn't block others: hashing a large video takes seconds, and if an agent re-exports it meanwhile it used to be blocked (EBUSY)</summary>
    static async Task<string> ComputeAsync(string path)
    {
        await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 1 << 16, useAsync: true);
        return Convert.ToHexString(await SHA256.HashDataAsync(stream)).ToLowerInvariant();
    }

    static Dictionary<string, Entry> Loaded()
    {
        if (entries is not null) return entries;
        try
        {
            entries = File.Exists(Location) ? JsonSerializer.Deserialize<Dictionary<string, Entry>>(File.ReadAllBytes(Location)) : null;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException)
        {
            Log.Info($"Hash cache unreadable, starting empty: {ex.Message}");
            entries = null;
        }
        return entries ??= [];
    }
}
