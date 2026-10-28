using System.IO;
using SnipToss.App;

namespace AppTests;

/// <summary>
/// Adding to and removing from the library (Library). Regressions covered: adding a subfolder and then its parent produced
/// two entries, so the same item was listed twice and its notes landed wherever the clicked row pointed; files skipped by the scan
/// (hidden, or under bin / dist) were reported as "already in the library" when they were not listed anywhere;
/// removing the item being viewed left nothing selected on the next launch
/// </summary>
public class LibraryTests
{
    sealed class Project : IDisposable
    {
        readonly TempDir dir = new();
        public Settings Settings { get; }
        public string Root { get; }

        public Project()
        {
            Settings = Settings.LoadFrom(dir.File("settings.json"));
            Root = Path.Combine(dir.Path, "项目");
            Directory.CreateDirectory(Root);
        }

        /// <summary>Creates a file in the project (relative path, forward slashes allowed) and returns the absolute path</summary>
        public string Touch(string rel)
        {
            var full = Path.Combine(Root, rel.Replace('/', '\\'));
            Directory.CreateDirectory(Path.GetDirectoryName(full)!);
            File.WriteAllBytes(full, [1, 2, 3]);
            return full;
        }

        public string Dir(string rel) => Directory.CreateDirectory(Path.Combine(Root, rel.Replace('/', '\\'))).FullName.TrimEnd('\\');

        public List<string> Entries => Settings.Library.Select(e => e.Path).ToList();

        public void Dispose() => dir.Dispose();
    }

    [Fact]
    public void Dropping_thousands_of_single_files_at_once_does_not_normalise_paths_pairwise_and_finishes_within_seconds()
    {
        // Adding each file used to normalise the whole list again (GetFullPath): 3000 + 3000 files meant about 9 million calls
        using var p = new Project();
        var first = Enumerable.Range(0, 3000).Select(i => p.Touch($"a/{i:D4}.png")).ToList();
        var second = Enumerable.Range(0, 3000).Select(i => p.Touch($"b/{i:D4}.png")).ToList();
        Library.Add(p.Settings, first);
        var watch = System.Diagnostics.Stopwatch.StartNew();
        var r = Library.Add(p.Settings, second.Append(first[1234]));
        watch.Stop();
        Assert.Equal(3000, r.Added.Count); // the one already in the library was not added twice
        Assert.Equal(6000, p.Entries.Count);
        Assert.True(watch.Elapsed < TimeSpan.FromSeconds(5), $"Adding 3000 took {watch.Elapsed.TotalSeconds:F1} s");
        Assert.Equal(2, Library.Remove(p.Settings, e => e.Path == first[0] || e.Path == second[0]));
    }

    [Fact]
    public void Adding_a_subfolder_then_its_parent_merges_the_subfolder_into_the_parent()
    {
        using var p = new Project();
        p.Touch("图/a.png");
        var sub = p.Dir("图");
        Library.Add(p.Settings, [sub]);
        var r = Library.Add(p.Settings, [p.Root]);
        Assert.Equal([p.Root], p.Entries);
        Assert.Equal([p.Root], r.Added);
    }

    [Fact]
    public void Adding_a_single_file_then_its_folder_merges_the_file_into_the_folder()
    {
        using var p = new Project();
        var file = p.Touch("a.png");
        Library.Add(p.Settings, [file]);
        Library.Add(p.Settings, [p.Root]);
        Assert.Equal([p.Root], p.Entries);
    }

    [Fact]
    public void When_a_merged_entry_was_pinned_the_parent_folder_is_pinned_too()
    {
        using var p = new Project();
        var other = p.Touch("别处/b.png");
        Library.Add(p.Settings, [other]);
        var sub = p.Dir("图");
        p.Touch("图/a.png");
        Library.Add(p.Settings, [sub]);
        Library.Pin(p.Settings, [sub], true);
        Library.Add(p.Settings, [Path.Combine(p.Root)]);
        // 别处/b.png is inside the project folder too and is merged along with it; the project folder inherits the pin and sits in the pinned area
        Assert.Equal([p.Root], p.Entries);
        Assert.True(p.Settings.Library[0].Pinned);
    }

    [Fact]
    public void Adding_a_parent_folder_keeps_child_entries_the_scan_cannot_see()
    {
        // dist is skipped by default and so are hidden folders (leading dot): these were added individually, are absent from the
        // parent's scan, and would vanish if merged
        using var p = new Project();
        var built = p.Touch("dist/out.png");
        var hidden = p.Touch(".cache/x.png");
        Library.Add(p.Settings, [built, hidden]);
        Library.Add(p.Settings, [p.Root]);
        Assert.Equal(3, p.Entries.Count);
        Assert.Contains(built, p.Entries);
        Assert.Contains(hidden, p.Entries);
    }

    [Fact]
    public void A_file_the_folder_scan_already_finds_is_not_added_again_and_is_located_instead()
    {
        using var p = new Project();
        var file = p.Touch("图/a.png");
        Library.Add(p.Settings, [p.Root]);
        var r = Library.Add(p.Settings, [file]);
        Assert.Empty(r.Added);
        Assert.Equal(file, r.Focus);
        Assert.Equal([p.Root], p.Entries);
    }

    [Theory]
    [InlineData("dist/out.png")]
    [InlineData(".cache/x.png")]
    [InlineData("node_modules/pkg/logo.png")]
    public void A_file_inside_a_folder_that_the_scan_skips_can_be_added_individually(string rel)
    {
        // It used to say "already in the library, located", although the library did not contain it
        using var p = new Project();
        var file = p.Touch(rel);
        Library.Add(p.Settings, [p.Root]);
        var r = Library.Add(p.Settings, [file]);
        Assert.Equal([file], r.Added);
        Assert.Contains(file, p.Entries);
    }

    [Fact]
    public void A_disabled_kind_is_left_out_of_folder_scans_but_still_added_when_added_individually()
    {
        using var p = new Project();
        var clip = p.Touch("片子/a.mp4");
        p.Settings.Update(s => s.Prefs = new System.Text.Json.Nodes.JsonObject { ["kinds"] = new System.Text.Json.Nodes.JsonObject { ["image"] = true, ["video"] = false } });
        Library.Add(p.Settings, [p.Root]);
        var r = Library.Add(p.Settings, [clip]);
        Assert.Equal([clip], r.Added);
    }

    [Fact]
    public void PDF_and_PPT_are_not_accepted_until_they_can_be_annotated_even_if_enabled_in_settings()
    {
        // They used to be listed, and opening one only showed a "supported in a later version" message
        using var p = new Project();
        var pdf = p.Touch("文档/说明.pdf");
        p.Touch("文档/方案.pptx");
        p.Settings.Update(s => s.Prefs = new System.Text.Json.Nodes.JsonObject { ["kinds"] = new System.Text.Json.Nodes.JsonObject { ["pdf"] = true, ["slides"] = true } });
        var r = Library.Add(p.Settings, [pdf]);
        Assert.Empty(r.Added);
        Assert.Contains(".pdf", Assert.Single(r.Skipped));
        Assert.Empty(MaterialScanner.Scan(p.Root, p.Settings.EnabledKinds, []));
        Assert.DoesNotContain(".pdf", MaterialScanner.Extensions);
    }

    [Fact]
    public void Scan_counts_unsupported_files_and_records_skipped_folders()
    {
        // The end of the folder says "N more files not supported yet" and "folders skipped"
        using var p = new Project();
        p.Touch("a.png");
        p.Touch("设计/封面.psd");
        p.Touch("设计/图标.AI");
        p.Touch("文档/说明.pdf");
        p.Touch("文档/readme.txt"); // not item-like, so not counted
        p.Touch("dist/b.png");
        p.Touch("node_modules/x/c.png");
        var stats = new MaterialScanner.Stats();
        var found = MaterialScanner.Scan(p.Root, ["image", "video"], new(["node_modules", "dist"], StringComparer.OrdinalIgnoreCase), stats: stats);
        Assert.Single(found);
        Assert.Equal(3, stats.Others);
        Assert.Equal(["ai", "pdf", "psd"], stats.OtherExts);
        Assert.Equal(["dist", "node_modules"], stats.SkippedDirs);
    }

    [Theory]
    [InlineData(".sniptoss/snapshots/a.png")]
    [InlineData(".pizhu/snapshots/a.png")]
    public void Files_inside_the_notes_data_folder_are_not_treated_as_items(string rel)
    {
        // Opening a note snapshot from outside used to treat it as an item to locate, and failed to locate it without any message
        using var p = new Project();
        var shot = p.Touch(rel);
        var r = Library.Add(p.Settings, [shot]);
        Assert.Empty(r.Added);
        Assert.Null(r.Focus);
        Assert.Single(r.Skipped);
        Assert.Contains("批注", r.Skipped[0]);
        Assert.Empty(p.Entries);
    }

    [Fact]
    public void The_notes_data_folder_itself_is_not_treated_as_an_item_folder()
    {
        using var p = new Project();
        p.Touch(".sniptoss/snapshots/a.png");
        var r = Library.Add(p.Settings, [Path.Combine(p.Root, ".sniptoss")]);
        Assert.Empty(r.Added);
        Assert.Single(r.Skipped);
    }

    [Fact]
    public void Removing_the_entry_containing_the_item_being_viewed_also_clears_the_last_selection()
    {
        using var p = new Project();
        var a = p.Touch("甲/a.png");
        var b = p.Touch("乙/b.png");
        Library.Add(p.Settings, [p.Dir("甲"), b]);
        p.Settings.Update(s => s.Selected = a);
        Library.Remove(p.Settings, e => Library.Same(e.Path, b));
        Assert.Equal(a, p.Settings.Selected);
        Library.Remove(p.Settings, e => Library.Same(e.Path, p.Dir("甲")));
        Assert.Null(p.Settings.Selected);
    }

    [Fact]
    public void Existing_duplicate_entries_are_tidied_up_at_startup()
    {
        // Settings saved before the fix may already hold both a subfolder and its parent
        using var p = new Project();
        p.Touch("图/a.png");
        var sub = p.Dir("图");
        p.Settings.Update(s =>
        {
            s.Library.Add(new LibraryEntry { Path = sub });
            s.Library.Add(new LibraryEntry { Path = p.Root });
        });
        Assert.Equal(1, Library.Tidy(p.Settings));
        Assert.Equal([p.Root], p.Entries);
        Assert.Equal(0, Library.Tidy(p.Settings));
    }

    [Fact]
    public void Scan_stops_at_the_limit()
    {
        using var p = new Project();
        for (var i = 0; i < 5; i++) p.Touch($"图/{i}.png");
        Assert.Equal(3, MaterialScanner.Scan(p.Root, ["image"], [], limit: 3).Count);
        Assert.Equal(5, MaterialScanner.Scan(p.Root, ["image"], []).Count);
    }

    [Fact]
    public void Reaching_the_limit_exactly_is_not_truncation_one_more_is()
    {
        using var p = new Project();
        for (var i = 0; i < 3; i++) p.Touch($"图/{i}.png");
        var exact = new MaterialScanner.Stats();
        Assert.Equal(3, MaterialScanner.Scan(p.Root, ["image"], [], limit: 3, stats: exact).Count);
        Assert.False(exact.Truncated); // exactly 20,000 used to be flagged "too many items, only the first 20,000 are listed"
        p.Touch("图/3.png");
        var more = new MaterialScanner.Stats();
        Assert.Equal(3, MaterialScanner.Scan(p.Root, ["image"], [], limit: 3, stats: more).Count);
        Assert.True(more.Truncated);
    }

    [Fact]
    public void A_file_added_individually_inside_a_folder_in_the_library_shares_that_folders_notes_folder()
    {
        // With no .sniptoss yet, the notes for items in a folder are kept at the folder entry; files added individually (skipped by the scan)
        // must be kept in the same place rather than each working out its own
        using var p = new Project();
        var built = p.Touch("dist/out.png");
        Library.Add(p.Settings, [p.Root, built]);
        Assert.Equal(p.Root, Library.OuterFolder(p.Settings, built));
        Assert.Equal(p.Root, Library.OuterFolder(p.Settings, p.Root));
        Assert.Null(Library.OuterFolder(p.Settings, Path.GetTempPath()));
    }

    // ---------- Moved: locate it (context menu), and recognise it when dropped in again ----------

    [Fact]
    public void Locating_replaces_the_entry_in_place_and_pin_position_expansion_and_selection_follow()
    {
        using var p = new Project();
        var other = p.Dir("别的");
        var old = p.Dir("旧位置/片子");
        p.Touch("旧位置/片子/镜头/01.png");
        Library.Add(p.Settings, [other, old]);
        Library.Pin(p.Settings, [old], true);
        p.Settings.Update(s =>
        {
            s.Expanded = [old, Path.Combine(old, "镜头")];
            s.Selected = Path.Combine(old, "镜头", "01.png");
        });
        var moved = Path.Combine(p.Root, "新位置", "片子");
        Directory.CreateDirectory(Path.GetDirectoryName(moved)!);
        Directory.Move(old, moved);

        var r = Library.Relocate(p.Settings, old, moved);

        Assert.Equal(moved, r.To);
        Assert.Equal([moved, other], p.Entries); // the pinned entry is still first and no extra entry was added
        Assert.True(p.Settings.Library[0].Pinned);
        Assert.Equal([moved, Path.Combine(moved, "镜头")], p.Settings.Expanded);
        Assert.Equal(Path.Combine(moved, "镜头", "01.png"), p.Settings.Selected);
    }

    [Fact]
    public void Locating_when_the_new_location_was_already_added_merges_that_entry_and_keeps_the_original_position()
    {
        using var p = new Project();
        var old = p.Dir("旧/片子");
        var other = p.Dir("别的");
        Library.Add(p.Settings, [old]);
        Library.Add(p.Settings, [other]); // newly added entries go first: [别的, 片子]
        var moved = Path.Combine(p.Root, "新", "片子");
        Directory.CreateDirectory(Path.GetDirectoryName(moved)!);
        Directory.Move(old, moved);
        p.Settings.Update(s => s.Library.Insert(0, new LibraryEntry { Path = moved })); // the new location was dropped in first

        Library.Relocate(p.Settings, old, moved);

        Assert.Equal([other, moved], p.Entries);
    }

    [Fact]
    public void Locating_to_a_place_that_does_not_exist_throws_and_leaves_the_library_unchanged()
    {
        using var p = new Project();
        var old = p.Dir("片子");
        Library.Add(p.Settings, [old]);
        Assert.Throws<FileNotFoundException>(() => Library.Relocate(p.Settings, old, Path.Combine(p.Root, "没有这个")));
        Assert.Equal([old], p.Entries);
    }

    [Fact]
    public void Dropping_a_moved_folder_back_in_is_recognised_as_the_original_entry_and_replaces_it_in_place()
    {
        using var p = new Project();
        var old = p.Dir("旧/片子");
        var other = p.Dir("别的");
        Library.Add(p.Settings, [old]);
        Library.Add(p.Settings, [other]);
        Library.Pin(p.Settings, [old], true);
        var moved = Path.Combine(p.Root, "新", "片子");
        Directory.CreateDirectory(Path.GetDirectoryName(moved)!);
        Directory.Move(old, moved);

        var r = Library.Add(p.Settings, [moved]);

        Assert.Equal([new Library.Relocation(old, moved)], r.Relocated);
        Assert.Equal([moved, other], p.Entries);
        Assert.True(p.Settings.Library[0].Pinned);
    }

    [Fact]
    public void Same_name_but_the_original_still_exists_is_not_a_move_and_adds_a_new_entry()
    {
        using var p = new Project();
        var a = p.Dir("甲/片子");
        var b = p.Dir("乙/片子");
        Library.Add(p.Settings, [a]);
        var r = Library.Add(p.Settings, [b]);
        Assert.Empty(r.Relocated!);
        Assert.Equal([b, a], p.Entries);
    }

    [Fact]
    public void A_moved_single_file_is_not_matched_to_one_with_a_different_extension()
    {
        using var p = new Project();
        var old = p.Touch("旧/封面.png");
        Library.Add(p.Settings, [old]);
        File.Delete(old);
        var jpg = p.Touch("新/封面.jpg");
        var png = p.Touch("新/封面.png");
        Assert.Empty(Library.Add(p.Settings, [jpg]).Relocated!);
        Assert.Equal([new Library.Relocation(old, png)], Library.Add(p.Settings, [png]).Relocated);
    }

    /// <summary>
    /// A drive letter that does not exist on this computer (searched from Z downward, down to H): stands in for an unplugged USB drive
    /// </summary>
    static string AbsentDrive()
    {
        var present = Environment.GetLogicalDrives().Select(d => char.ToUpperInvariant(d[0])).ToHashSet();
        return "ZYXWVUTSRQPONMLKJIH".First(c => !present.Contains(c)) + @":\";
    }

    [Fact]
    public void New_folder_with_the_same_name_while_the_original_is_on_an_unplugged_drive_is_not_a_move_and_adds_a_new_entry()
    {
        // While the USB drive is unplugged its entry is also "not found"; adding a same-named folder (a common name like assets)
        // used to replace it, and the entry was gone when the drive came back
        using var p = new Project();
        var offline = Path.Combine(AbsentDrive(), "旧", "片子");
        p.Settings.Update(s => s.Library.Add(new LibraryEntry { Path = offline }));
        var other = p.Dir("新/片子");

        var r = Library.Add(p.Settings, [other]);

        Assert.Empty(r.Relocated!);
        Assert.Equal([other], r.Added);
        Assert.Equal([other, offline], p.Entries);
    }

    [Fact]
    public async Task Adding_something_on_an_unplugged_drive_checks_the_drive_in_the_background_reports_not_found_and_leaves_the_library_unchanged()
    {
        // The drive check runs in the background (a disconnected network drive takes ten-odd seconds to check)
        // and the library edit returns to the calling thread
        using var p = new Project();
        var offline = Path.Combine(AbsentDrive(), "片子", "a.png");
        var r = await Library.AddAsync(p.Settings, [offline]);
        Assert.Empty(r.Added);
        Assert.Equal([$"找不到文件或文件夹：{offline}"], r.Skipped);
        Assert.Empty(p.Entries);
    }

    [Fact]
    public async Task Drive_presence_is_checked_for_several_drives_together_and_remembered()
    {
        using var p = new Project();
        var absent = Path.Combine(AbsentDrive(), "片子");
        await Volumes.WaitAsync([p.Root, absent], TimeSpan.FromSeconds(5));
        Assert.True(Volumes.Known(p.Root));
        Assert.False(Volumes.Known(absent));
        Assert.Null(Volumes.Known(@"\\?\写法不对:"));
    }

    [Fact]
    public void Removing_thousands_of_single_files_finishes_within_seconds()
    {
        // Remove / Clear used to normalise paths "entries × entries to remove" times (only Add had been fixed): 6000 entries took tens of seconds
        // and froze the window meanwhile
        using var p = new Project();
        var files = Enumerable.Range(0, 6000).Select(i => p.Touch($"a/{i:D4}.png")).ToList();
        Library.Add(p.Settings, files);
        p.Settings.Update(s => s.Expanded = [.. files.Take(50)]);
        var watch = System.Diagnostics.Stopwatch.StartNew();
        var n = Library.Remove(p.Settings, _ => true);
        watch.Stop();
        Assert.Equal(6000, n);
        Assert.Empty(p.Entries);
        Assert.Empty(p.Settings.Expanded);
        Assert.True(watch.Elapsed < TimeSpan.FromSeconds(5), $"Removing 6000 took {watch.Elapsed.TotalSeconds:F1} s");
    }

    [Fact]
    public void Pinning_thousands_of_entries_finishes_within_seconds()
    {
        // Pinning works per project: thousands of individually added files in one project are passed in at once
        // (same as above: used to be normalised pairwise)
        using var p = new Project();
        var files = Enumerable.Range(0, 6000).Select(i => p.Touch($"a/{i:D4}.png")).ToList();
        Library.Add(p.Settings, files);
        var watch = System.Diagnostics.Stopwatch.StartNew();
        Library.Pin(p.Settings, files.Take(3000), true);
        watch.Stop();
        Assert.Equal(3000, p.Settings.Library.Count(e => e.Pinned));
        Assert.True(watch.Elapsed < TimeSpan.FromSeconds(5), $"Pinning 3000 took {watch.Elapsed.TotalSeconds:F1} s");
    }

    [Fact]
    public void A_drive_root_is_not_inside_itself()
    {
        // Inside excludes the path itself: a normalised drive root keeps its trailing \, and comparing it against itself
        // as a prefix used to make E:\ count as inside E:\
        Assert.False(Library.Inside(@"E:\", @"E:\"));
        Assert.False(Library.Inside(@"E:\a", @"E:\a\"));
        Assert.True(Library.Inside(@"E:\a", @"E:\"));
        Assert.False(Library.Inside(@"E:\ab", @"E:\a"));
        Assert.True(Library.Inside(@"e:\A\b.png", @"E:\a"));
    }

    [Fact]
    public void Normalising_paths_strips_trailing_slashes_resolves_dot_segments_and_forward_slashes_keeps_drive_roots_and_leaves_invalid_paths_as_is()
    {
        Assert.Equal(@"E:\a\b", Library.Norm(@"E:/a/./c/../b\"));
        Assert.Equal(@"E:\", Library.Norm(@"E:\"));
        Assert.Equal(@"\\srv\share\a", Library.Norm(@"\\srv\share\a\"));
        Assert.True(Library.Same(@"E:\A\B.PNG", @"e:/a/b.png"));
        Assert.Equal("C:\\a\0b", Library.Key("C:\\a\0b")); // contains NUL: must not throw
        var has = Library.Contains([@"E:\项目\素材", @"E:\x.png"]);
        Assert.True(has(@"e:\项目\素材\"));
        Assert.False(has(@"E:\项目"));
        Assert.False(has("E:\\x\0.png"));
    }

    [Fact]
    public void Adding_the_same_thing_again_in_a_different_spelling_or_twice_in_one_batch_counts_once_and_locates_it()
    {
        using var p = new Project();
        var dir = p.Dir("片子");
        Library.Add(p.Settings, [dir]);
        var r = Library.Add(p.Settings, [dir.ToUpperInvariant() + "\\", dir.Replace('\\', '/')]);
        Assert.Empty(r.Added);
        Assert.Equal(dir, r.Focus, ignoreCase: true);
        var file = p.Touch("单张.png");
        r = Library.Add(p.Settings, [file, file]);
        Assert.Equal([file], r.Added);
        Assert.Equal([file, dir], p.Entries);
    }

    [Fact]
    public void Unsupported_missing_and_malformed_paths_are_neither_added_nor_located_and_the_reason_is_given()
    {
        using var p = new Project();
        var txt = p.Touch("说明.txt");
        var missing = Path.Combine(p.Root, "没有这个.png");
        var r = Library.Add(p.Settings, [txt, missing, "E:\\a\0b.png"]);
        Assert.Empty(r.Added);
        Assert.Null(r.Focus);
        Assert.Equal(["不支持此文件类型（.txt）：说明.txt", $"找不到文件或文件夹：{missing}", "路径无效：E:\\a\0b.png"], r.Skipped);
        Assert.Empty(p.Entries);
    }

    [Fact]
    public void Adding_several_at_once_places_them_after_the_pinned_and_before_the_rest_in_the_given_order_and_locates_the_first_openable()
    {
        using var p = new Project();
        var pinned = p.Dir("置顶的");
        var old = p.Dir("原来的");
        Library.Add(p.Settings, [pinned, old]);
        Library.Pin(p.Settings, [pinned], true);
        var (a, b, c) = (p.Touch("新/a.png"), p.Dir("新/b"), p.Touch("新/c.mp4"));
        var r = Library.Add(p.Settings, [p.Touch("新/不认.txt"), a, b, c]);
        Assert.Equal(a, r.Focus);
        Assert.Equal([pinned, a, b, c, old], p.Entries);
    }

    [Fact]
    public void Removing_clears_it_and_everything_inside_it_from_the_expanded_record_and_leaves_things_not_in_the_library_alone()
    {
        using var p = new Project();
        var dir = p.Dir("片子");
        var keep = p.Dir("留着");
        Library.Add(p.Settings, [dir, keep]);
        p.Settings.Update(s => s.Expanded = [dir, Path.Combine(dir, "子"), keep]);
        Assert.Equal(0, Library.Remove(p.Settings, e => e.Path == Path.Combine(p.Root, "没有这个")));
        Assert.Equal(1, Library.Remove(p.Settings, e => e.Path == dir));
        Assert.Equal([keep], p.Entries);
        Assert.Equal([keep], p.Settings.Expanded);
    }

    [Fact]
    public void Pinned_entries_go_to_the_end_of_the_pinned_area_unpinned_to_the_start_of_the_normal_area_and_no_match_at_all_throws()
    {
        using var p = new Project();
        var (a, b, c, d) = (p.Dir("a"), p.Dir("b"), p.Dir("c"), p.Dir("d"));
        Library.Add(p.Settings, [a, b, c, d]);
        Library.Pin(p.Settings, [a], true);
        Library.Pin(p.Settings, [d, b], true); // several at once: ordered by their position in the library
        Assert.Equal([a, b, d, c], p.Entries);
        Library.Pin(p.Settings, [a], false);
        Assert.Equal([b, d, a, c], p.Entries);
        Assert.Throws<InvalidOperationException>(() => Library.Pin(p.Settings, [Path.Combine(p.Root, "没有")], true));
        Assert.Equal([b, d, a, c], p.Entries);
    }

    [Fact]
    public void An_entry_that_can_no_longer_be_found_still_resolves_to_its_notes_folder_if_the_projects_notes_folder_exists()
    {
        using var p = new Project();
        Directory.CreateDirectory(Path.Combine(p.Root, DataDir.Name));
        var finder = new HomeFinder();
        Assert.Equal(p.Root, finder.ExistingHome(Path.Combine(p.Root, "挪走了", "01.png")));
        Assert.Null(new HomeFinder().ExistingHome(Path.Combine(Path.GetTempPath(), "没有批注的地方", Guid.NewGuid().ToString("N"), "x.png")));
    }
}