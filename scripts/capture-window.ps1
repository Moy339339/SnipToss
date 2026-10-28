# Screenshots the running SnipToss window (for developer self-checks). Works even when the window is covered: it uses PrintWindow(PW_RENDERFULLCONTENT).
#   pwsh -File scripts/capture-window.ps1 -Out shot.png
param(
    [Parameter(Mandatory)] [string] $Out,
    [string] $ProcessName = 'SnipToss',
    # Which one to capture when several SnipToss processes are running; if omitted, the most recently started one
    [int] $ProcessId = 0
)
$ErrorActionPreference = 'Stop'

Add-Type -ReferencedAssemblies System.Drawing.Common, System.Drawing.Primitives, System.Private.Windows.GdiPlus, System.Private.Windows.Core -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class SnipTossCapture {
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    public static void Save(IntPtr hwnd, string path) {
        SetProcessDPIAware();
        GetWindowRect(hwnd, out var r);
        using var bmp = new Bitmap(r.R - r.L, r.B - r.T);
        using (var g = Graphics.FromImage(bmp)) {
            var hdc = g.GetHdc();
            PrintWindow(hwnd, hdc, 2);
            g.ReleaseHdc(hdc);
        }
        bmp.Save(path, ImageFormat.Png);
    }
}
'@

$p = if ($ProcessId) { Get-Process -Id $ProcessId } else {
    Get-Process $ProcessName | Where-Object MainWindowHandle -ne 0 | Sort-Object StartTime -Descending | Select-Object -First 1
}
if (-not $p) { throw "No window found for $ProcessName" }
[SnipTossCapture]::Save($p.MainWindowHandle, [IO.Path]::GetFullPath($Out))
Write-Host "Saved $Out"
