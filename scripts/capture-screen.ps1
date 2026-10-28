param([string]$Out, [int]$X = 0, [int]$Y = 0, [int]$W = 0, [int]$H = 0)
# Usage: pwsh -File scripts/capture-screen.ps1 -Out $env:TEMP/s.png [-X -Y -W -H]
# Captures the whole screen (or one region, in physical pixels), for looking at windows that cover the whole screen such as the capture overlay
Add-Type -AssemblyName System.Drawing, System.Windows.Forms
Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class Dpi { [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(System.IntPtr v); }'
[Dpi]::SetProcessDpiAwarenessContext([IntPtr]::new(-4)) | Out-Null # PER_MONITOR_AWARE_V2, coordinates are physical pixels
if ($W -eq 0) {
  $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $X = $b.X; $Y = $b.Y; $W = $b.Width; $H = $b.Height
}
$bmp = New-Object System.Drawing.Bitmap $W, $H
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($X, $Y, 0, 0, $bmp.Size)
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
"Saved $Out ($X,$Y ${W}x$H)"
