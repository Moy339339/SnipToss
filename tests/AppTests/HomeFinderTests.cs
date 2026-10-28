using System.IO;
using SnipToss.App;

namespace AppTests;

/// <summary>
/// Where one item's notes are stored (HomeFinder): look upward for an existing .sniptoss, otherwise work it out from the entry;
/// compute only, never create
/// </summary>
public class HomeFinderTests
{
    static string Make(string root, string rel)
    {
        var full = Path.Combine(root, rel.Replace('/', '\\'));
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        File.WriteAllBytes(full, [1]);
        return full;
    }

    [Fact]
    public void Searching_upward_the_nearest_notes_folder_wins_and_both_current_and_legacy_names_are_recognised()
    {
        using var root = new TempDir();
        Directory.CreateDirectory(Path.Combine(root.Path, DataDir.Name));
        Directory.CreateDirectory(Path.Combine(root.Path, "a", DataDir.LegacyName));
        var deep = Make(root.Path, "a/b/x.png");
        var shallow = Make(root.Path, "c/y.png");
        var finder = new HomeFinder();
        Assert.Equal(Path.Combine(root.Path, "a"), finder.Find(deep, root.Path));
        Assert.Equal(root.Path, finder.Find(shallow, null));
    }

    [Fact]
    public void With_no_notes_folder_yet_items_in_a_folder_entry_use_the_entry_and_single_files_use_their_folder_computing_only_and_creating_nothing()
    {
        using var root = new TempDir();
        var file = Make(root.Path, "项目/图/x.png");
        var entry = Path.Combine(root.Path, "项目");
        var finder = new HomeFinder();
        Assert.Equal(entry, finder.Find(file, entry));
        Assert.Equal(Path.GetDirectoryName(file), finder.Find(file, null));
        Assert.Equal(entry, finder.FolderHome(Path.Combine(entry, "图"), entry));
        Assert.Empty(Directory.EnumerateDirectories(root.Path, DataDir.Name, SearchOption.AllDirectories));
    }

    [Fact]
    public void A_folder_entry_itself_uses_a_notes_folder_inside_or_above_it()
    {
        using var root = new TempDir();
        var sub = Path.Combine(root.Path, "项目", "子");
        Directory.CreateDirectory(Path.Combine(sub, DataDir.Name));
        Assert.Equal(sub, new HomeFinder().FolderHome(sub, Path.Combine(root.Path, "项目")));
    }
}
