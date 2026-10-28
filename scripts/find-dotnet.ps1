# Finds a .NET 10 or newer SDK and returns the path of its dotnet.exe (shared by build-app.ps1 and test-app.ps1).
# Order: the SNIPTOSS_DOTNET environment variable (the user-level value is read too, so no terminal restart is needed after setting it) -> dotnet on PATH -> default install locations
$candidates = @(
    $env:SNIPTOSS_DOTNET
    [Environment]::GetEnvironmentVariable('SNIPTOSS_DOTNET', 'User')
    (Get-Command dotnet -ErrorAction SilentlyContinue)?.Source
    (Join-Path $env:ProgramFiles 'dotnet\dotnet.exe')
    (Join-Path $env:USERPROFILE '.dotnet\dotnet.exe')
) | Where-Object { $_ -and (Test-Path $_) }
$dotnet = $candidates | Where-Object { (& $_ --list-sdks) -match '^(1\d|[2-9]\d)\.' } | Select-Object -First 1
if (-not $dotnet) { throw 'No .NET 10 or newer SDK found. Install one, or point the SNIPTOSS_DOTNET environment variable at its dotnet.exe' }
$dotnet
