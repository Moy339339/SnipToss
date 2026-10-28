# Coverage of the shell (C#) (target: C# logic overall >= 70%, ADR-0004): xUnit (tests/AppTests) + real-shell tests (tests/shell, running the real SnipToss.exe) combined.
# With xUnit alone, code that needs a real window (windows, tray, capture overlay) shows 0, so the real-shell tests are counted too: dotnet-coverage wraps the Playwright run
# and attaches the collector to the child processes (test instances) through environment variables.
#   pwsh -File scripts/coverage-app.ps1          builds the UI and tests/shell/.app (with test hooks) and briefly opens windows on screen (same as npm run e2e:shell)
# Needs dotnet-coverage: dotnet tool install -g dotnet-coverage; if installed elsewhere (--tool-path <folder>), set SNIPTOSS_DOTNET_COVERAGE to its exe
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$dotnet = & (Join-Path $PSScriptRoot 'find-dotnet.ps1')
$collector = @(
    $env:SNIPTOSS_DOTNET_COVERAGE
    [Environment]::GetEnvironmentVariable('SNIPTOSS_DOTNET_COVERAGE', 'User')
    (Get-Command dotnet-coverage -ErrorAction SilentlyContinue)?.Source
    (Join-Path $env:USERPROFILE '.dotnet\tools\dotnet-coverage.exe')
) |
    Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $collector) { throw 'dotnet-coverage not found: run dotnet tool install dotnet-coverage --tool-path <folder>, then set SNIPTOSS_DOTNET_COVERAGE' }
$out = Join-Path $root 'coverage\app'
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory $out | Out-Null

Push-Location $root
try {
    npm run build --silent
    if ($LASTEXITCODE -ne 0) { throw 'UI build failed' }
    & (Join-Path $PSScriptRoot 'build-app.ps1') -Out tests/shell/.app -TestHooks
    & $dotnet test tests/AppTests --collect 'XPlat Code Coverage' --results-directory (Join-Path $out 'xunit') -nologo -v quiet --disable-build-servers
    if ($LASTEXITCODE -ne 0) { throw 'Shell unit tests failed' }
    & $collector collect -f cobertura -o (Join-Path $out 'shell.cobertura.xml') node node_modules/@playwright/test/cli.js test -c playwright.shell.config.ts
    if ($LASTEXITCODE -ne 0) { Write-Warning 'Some real-shell tests failed (coverage is still computed; look at the failures first)' }
} finally {
    Pop-Location
}

# Every line of every file: counts if either side ran it (generated code under obj doesn't count)
function Read-Lines([string] $path) {
    $map = @{}
    foreach ($pkg in ([xml](Get-Content $path)).coverage.packages.package) {
        if ($pkg.name -ne 'SnipToss') { continue }
        foreach ($c in $pkg.classes.class) {
            $file = $c.filename -replace '^.*[\\/]app[\\/]', ''
            if ($file -match 'obj[\\/]') { continue }
            if (-not $map[$file]) { $map[$file] = @{} }
            foreach ($l in $c.lines.line) {
                $n = [int]$l.number
                $map[$file][$n] = [Math]::Max([int]($map[$file][$n] ?? 0), [int]$l.hits)
            }
        }
    }
    $map
}
$sources = @(
    (Read-Lines (Get-ChildItem (Join-Path $out 'xunit') -Recurse -Filter coverage.cobertura.xml | Select-Object -First 1).FullName),
    (Read-Lines (Join-Path $out 'shell.cobertura.xml'))
)
$rows = foreach ($file in ($sources | ForEach-Object { $_.Keys } | Sort-Object -Unique)) {
    $lines = @{}
    foreach ($m in $sources) { if ($m[$file]) { foreach ($k in $m[$file].Keys) { $lines[$k] = [Math]::Max([int]($lines[$k] ?? 0), $m[$file][$k]) } } }
    $hit = @($lines.Values | Where-Object { $_ -gt 0 }).Count
    [pscustomobject]@{ File = $file; Lines = $lines.Count; Covered = $hit; Percent = [math]::Round(100 * $hit / [math]::Max(1, $lines.Count)) }
}
$total = ($rows | Measure-Object Lines -Sum).Sum
$covered = ($rows | Measure-Object Covered -Sum).Sum
$rows | Sort-Object { $_.Lines - $_.Covered } -Descending | Select-Object -First 15 | Format-Table -AutoSize
Write-Host ("Shell combined: {0} lines, {1} covered, {2:P1} (acceptance >= 70%); report in {3}" -f $total, $covered, ($covered / $total), $out)
