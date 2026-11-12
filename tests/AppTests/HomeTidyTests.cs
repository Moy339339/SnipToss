using System.IO;
using SnipToss.App;

namespace AppTests;

/// <summary>An empty .sniptoss is hidden and removed (HomeTidy): only what the app wrote is deleted, and undo can still bring the snapshots back</summary>
[Collection("HomeTidy")]
public sealed class HomeTidyTests : IDisposable
{
    const string Empty = """{ "schema": "sniptoss/5", "material": { "path": "a.png", "kind": "image" }, "annotations": [] }""";
    const string OneNote = """{ "schema": "sniptoss/5", "material": { "path": "a.png", "kind": "image" }, "annotations": [{ "id": "abc123" }] }""";
    const string OneDrawing = """{ "schema": "sniptoss/5", "material": { "path": "a.png", "kind": "image" }, "annotations": [], "drawings": [{ "id": "abc123" }] }""";

    readonly TempDir home = new();
    readonly TempDir stash = new();
    readonly string before = HomeTidy.StashRoot;

    public HomeTidyTests() => HomeTidy.StashRoot = stash.Path;

    public void Dispose()
    {
        HomeTidy.DropStashes();
        HomeTidy.StashRoot = before;
        home.Dispose();
        stash.Dispose();
    }

    string Make(string rel, string text = "")
    {
        var path = home.File(rel);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, text);
        return path;
    }

    void MakeUsual(string notes)
    {
        Make(@".sniptoss\annotations\a.png.json", notes);
        Make(@".sniptoss\REVIEW.md", "# Review");
        Make(@".sniptoss\project.json", "{}");
        Make(@".sniptoss\.gitignore", DataDir.GitIgnore);
        Make(@".sniptoss\snapshots\abc123.png", "shot");
    }

    [Fact]
    public async Task A_folder_whose_notes_files_are_all_empty_is_removed_entirely()
    {
        MakeUsual(Empty);

        Assert.Equal(HomeTidy.Result.Removed, await HomeTidy.TidyAsync(home.Path));
        Assert.False(Directory.Exists(home.File(".sniptoss")));
    }

    [Fact]
    public async Task No_folder_means_nothing_to_do()
    {
        Assert.Equal(HomeTidy.Result.Nothing, await HomeTidy.TidyAsync(home.Path));
    }

    [Theory]
    [InlineData(OneNote)]
    [InlineData(OneDrawing)]
    [InlineData("not json")]
    [InlineData("[]")]
    [InlineData("""{ "schema": "sniptoss/9", "material": { "path": "a.png", "kind": "image" }, "annotations": [], "sketches": [{ "id": "later" }] }""")]
    [InlineData("""{ "annotations": [], "mine": "some other JSON that only looks alike" }""")]
    public async Task A_folder_with_a_note_a_drawing_or_an_unreadable_notes_file_is_left_untouched(string notes)
    {
        MakeUsual(notes);
        Make(@".sniptoss\annotations\b.png.json", Empty); // the empty one next to it stays too: nothing is deleted unless everything is empty

        Assert.Equal(HomeTidy.Result.Kept, await HomeTidy.TidyAsync(home.Path));
        Assert.Equal(notes, File.ReadAllText(home.File(@".sniptoss\annotations\a.png.json")));
        Assert.True(File.Exists(home.File(@".sniptoss\annotations\b.png.json")));
        Assert.True(File.Exists(home.File(@".sniptoss\REVIEW.md")));
        Assert.True(File.Exists(home.File(@".sniptoss\project.json")));
        Assert.True(File.Exists(home.File(@".sniptoss\snapshots\abc123.png")));
    }

    [Fact]
    public async Task A_notes_file_being_written_keeps_the_folder()
    {
        MakeUsual(Empty);
        Make(@".sniptoss\annotations\.a.png.json.lock", "1 1 x");

        Assert.Equal(HomeTidy.Result.Kept, await HomeTidy.TidyAsync(home.Path));
        Assert.True(File.Exists(home.File(@".sniptoss\annotations\a.png.json")));
    }

    [Fact]
    public async Task Files_the_app_did_not_write_stay_and_so_does_the_folder()
    {
        MakeUsual(Empty);
        Make(@".sniptoss\my-notes.txt", "mine");
        Make(@".sniptoss\snapshots\holiday.png", "mine");
        File.WriteAllText(home.File(@".sniptoss\.gitignore"), "edited\n");

        Assert.Equal(HomeTidy.Result.Left, await HomeTidy.TidyAsync(home.Path));
        Assert.Equal(
            [".gitignore", "my-notes.txt", @"snapshots\holiday.png"],
            Directory.GetFiles(home.File(".sniptoss"), "*", SearchOption.AllDirectories).Select(f => Path.GetRelativePath(home.File(".sniptoss"), f)).Order(StringComparer.Ordinal));
    }

    [Fact]
    public async Task Snapshots_of_a_removed_folder_come_back_before_the_next_write_so_undo_still_has_them()
    {
        MakeUsual(Empty);
        Assert.Equal(HomeTidy.Result.Removed, await HomeTidy.TidyAsync(home.Path));

        HomeTidy.Restore(home.Path);

        Assert.Equal("shot", File.ReadAllText(home.File(@".sniptoss\snapshots\abc123.png")));
        Assert.Empty(Directory.GetFileSystemEntries(stash.Path));
        HomeTidy.Restore(home.Path); // nothing set aside any more: does nothing
    }

    [Fact]
    public async Task Snapshots_that_could_not_be_put_back_are_tried_again_on_the_next_write()
    {
        MakeUsual(Empty);
        await HomeTidy.TidyAsync(home.Path);
        File.WriteAllText(home.File(".sniptoss"), ""); // a file where the folder should be: putting back fails

        HomeTidy.Restore(home.Path);
        Assert.NotEmpty(Directory.GetFileSystemEntries(stash.Path));

        File.Delete(home.File(".sniptoss"));
        HomeTidy.Restore(home.Path);
        Assert.Equal("shot", File.ReadAllText(home.File(@".sniptoss\snapshots\abc123.png")));
    }

    [Fact]
    public async Task Removing_the_folder_and_writing_into_it_take_turns()
    {
        MakeUsual(Empty);
        var write = await HomeTidy.EnterAsync(home.Path); // a write into this folder is under way
        var tidy = HomeTidy.TidyAsync(home.Path);
        await Task.Delay(100);
        Assert.False(tidy.IsCompleted);
        Assert.True(File.Exists(home.File(@".sniptoss\snapshots\abc123.png")));

        write.Dispose();
        Assert.Equal(HomeTidy.Result.Removed, await tidy);
    }

    [Fact]
    public async Task Set_aside_snapshots_are_dropped_on_quit()
    {
        MakeUsual(Empty);
        await HomeTidy.TidyAsync(home.Path);
        Assert.NotEmpty(Directory.GetFileSystemEntries(stash.Path));

        HomeTidy.DropStashes();
        HomeTidy.Restore(home.Path);

        Assert.False(Directory.Exists(stash.Path));
        Assert.False(Directory.Exists(home.File(".sniptoss")));
    }

    [Fact]
    public void The_folder_is_marked_hidden_once_it_exists()
    {
        HomeTidy.Hide(home.Path); // no folder yet: nothing happens, nothing is created
        Assert.False(Directory.Exists(home.File(".sniptoss")));

        Make(@".sniptoss\annotations\a.png.json", OneNote);
        HomeTidy.Hide(home.Path);
        HomeTidy.Hide(home.Path);

        Assert.True(File.GetAttributes(home.File(".sniptoss")).HasFlag(FileAttributes.Hidden));
        Assert.Equal(OneNote, File.ReadAllText(home.File(@".sniptoss\annotations\a.png.json"))); // still read by path as before
    }
}
