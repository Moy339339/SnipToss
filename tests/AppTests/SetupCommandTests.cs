using SnipToss.App;

namespace AppTests;

/// <summary>
/// Commands called by the setup wizard and the uninstaller (SetupCommand): only a single argument is recognised.
/// Actually running them (writing the registry) is tested only in the real-shell tests' test instance (tests/shell/setup.spec.ts)
/// </summary>
public class SetupCommandTests
{
    [Theory]
    [InlineData("--register-context-menu")]
    [InlineData("--uninstall-cleanup")]
    public void A_lone_command_is_recognised(string arg) => Assert.Equal(arg, SetupCommand.Of([arg]));

    [Fact]
    public void Extra_arguments_or_a_file_to_open_do_not_count_as_a_command()
    {
        Assert.Null(SetupCommand.Of([]));
        Assert.Null(SetupCommand.Of([@"E:\素材\hero.png"]));
        Assert.Null(SetupCommand.Of(["--uninstall-cleanup", @"E:\素材"]));
        Assert.Null(SetupCommand.Of(["--tray"]));
        Assert.Null(SetupCommand.Of(["--REGISTER-CONTEXT-MENU"]));
    }
}
