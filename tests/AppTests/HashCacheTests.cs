using System.IO;
using System.Security.Cryptography;
using SnipToss.App;

namespace AppTests;

/// <summary>
/// Item fingerprints are cached on this computer by path + size + modified time (ADR-0008: recognising notes on an older version
/// needs the item's current fingerprint, and large videos must not be re-read)
/// </summary>
[Collection("HashCache")]
public class HashCacheTests : IDisposable
{
    readonly TempDir dir = new();
    readonly string saved = HashCache.Location;

    public HashCacheTests() => HashCache.Location = dir.File("cache/sha256.json");

    public void Dispose()
    {
        HashCache.Location = saved;
        dir.Dispose();
        GC.SuppressFinalize(this);
    }

    static string Sha(string path) => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path))).ToLowerInvariant();

    [Fact]
    public async Task Computes_correctly_records_it_and_returns_the_recorded_value_while_the_file_is_unchanged()
    {
        var file = dir.File("a.png");
        File.WriteAllBytes(file, [1, 2, 3]);
        Assert.Equal(Sha(file), await HashCache.Sha256Async(file));
        Assert.True(File.Exists(HashCache.Location));

        // Tamper with the recorded fingerprint: if the file is unchanged (same size and modified time) the recorded value is returned,
        // so it was not re-read
        var text = File.ReadAllText(HashCache.Location).Replace(Sha(file), new string('f', 64), StringComparison.Ordinal);
        File.WriteAllText(HashCache.Location, text);
        HashCache.Location = dir.File("cache/sha256.json"); // reload the record file (as if in a new process)
        Assert.Equal(new string('f', 64), await HashCache.Sha256Async(file));
    }

    [Fact]
    public async Task Recomputes_when_the_file_changed()
    {
        var file = dir.File("b.png");
        File.WriteAllBytes(file, [1, 2, 3]);
        var first = await HashCache.Sha256Async(file);
        File.WriteAllBytes(file, [1, 2, 3, 4]);
        File.SetLastWriteTimeUtc(file, DateTime.UtcNow.AddMinutes(1));
        var second = await HashCache.Sha256Async(file);
        Assert.NotEqual(first, second);
        Assert.Equal(Sha(file), second);
    }

    [Fact]
    public async Task Corrupt_record_file_is_treated_as_missing_and_it_still_computes()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(HashCache.Location)!);
        File.WriteAllText(HashCache.Location, "{ 坏了");
        HashCache.Location = dir.File("cache/sha256.json");
        var file = dir.File("c.png");
        File.WriteAllBytes(file, [9]);
        Assert.Equal(Sha(file), await HashCache.Sha256Async(file));
    }

    [Fact]
    public async Task Relative_paths_are_rejected()
    {
        await Assert.ThrowsAsync<ArgumentException>(() => HashCache.Sha256Async("a.png"));
    }
}
