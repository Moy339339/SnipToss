# Runs the unit tests of the desktop shell (app/): tests/AppTests (xUnit). = npm run test:app
# It builds the Debug version (app/bin/Debug) and doesn't touch the Release exe used day to day
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$dotnet = & (Join-Path $PSScriptRoot 'find-dotnet.ps1')
# --disable-build-servers: don't leave compiler servers running in the background after the build (by default they linger for ten minutes or so and take a few hundred MB, which hurts when other programs are open)
# The console logger is set explicitly: with only -v quiet it hides why a test failed, not just the build noise
& $dotnet test (Join-Path $root 'tests\AppTests') --nologo -v quiet --disable-build-servers --logger 'console;verbosity=minimal'
exit $LASTEXITCODE
