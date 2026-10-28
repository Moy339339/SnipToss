using SnipToss.App;

namespace AppTests;

/// <summary>
/// Which keys the File Explorer context menu registers and which commands they run. Only the computed list is tested, never the registry:
/// a test instance refuses to change the registry anyway (it would overwrite the real installed entries),
/// and writing the registry in a restricted environment (restricted token) fails silently
/// </summary>
public class ShellIntegrationTests
{
    const string Exe = @"C:\Program Files\SnipToss\SnipToss.exe";

    [Fact]
    public void Registers_folders_the_folder_background_and_the_twelve_common_types_not_more_formats_or_PDF_PPT()
    {
        var keys = ShellIntegration.Entries(Exe, more: false).Select(e => e.Key).ToList();
        Assert.Equal(14, keys.Count);
        Assert.Contains(@"Software\Classes\Directory\shell\SnipToss", keys);
        Assert.Contains(@"Software\Classes\Directory\Background\shell\SnipToss", keys);
        foreach (var ext in MaterialScanner.MenuExtensions(false)) Assert.Contains($@"Software\Classes\SystemFileAssociations\{ext}\shell\SnipToss", keys);
        Assert.DoesNotContain(keys, k => k.Contains(".heic") || k.Contains(".tif") || k.Contains(".mkv") || k.Contains(".pdf") || k.Contains(".ppt"));
    }

    [Fact]
    public void With_more_formats_registers_all_twenty_three_types()
    {
        var keys = ShellIntegration.Entries(Exe, more: true).Select(e => e.Key).ToList();
        Assert.Equal(25, keys.Count);
        foreach (var ext in MaterialScanner.Extensions) Assert.Contains($@"Software\Classes\SystemFileAssociations\{ext}\shell\SnipToss", keys);
    }

    [Fact]
    public void Commands_use_percent_1_for_a_clicked_item_percent_V_for_blank_space_and_the_apps_own_icon()
    {
        var entries = ShellIntegration.Entries(Exe, more: true).ToDictionary(e => e.Key);
        Assert.Equal($"\"{Exe}\" \"%1\"", entries[@"Software\Classes\Directory\shell\SnipToss"].Command);
        Assert.Equal($"\"{Exe}\" \"%1\"", entries[@"Software\Classes\SystemFileAssociations\.png\shell\SnipToss"].Command);
        Assert.Equal($"\"{Exe}\" \"%V\"", entries[@"Software\Classes\Directory\Background\shell\SnipToss"].Command);
        Assert.All(entries.Values, e => Assert.Equal($"\"{Exe}\",0", e.Icon));
    }

    [Fact]
    public void Turning_it_off_also_removes_the_PDF_and_PPT_entries_registered_earlier()
    {
        var removed = ShellIntegration.KeysToRemove().ToList();
        Assert.Contains(@"Software\Classes\SystemFileAssociations\.pdf\shell\SnipToss", removed);
        Assert.Contains(@"Software\Classes\SystemFileAssociations\.pptx\shell\SnipToss", removed);
        Assert.Contains(@"Software\Classes\SystemFileAssociations\.ppt\shell\SnipToss", removed);
        Assert.Superset(ShellIntegration.Entries(Exe, more: true).Select(e => e.Key).ToHashSet(), removed.ToHashSet());
    }
}
