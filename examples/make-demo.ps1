# Generates a demo project, examples/demo (images + videos + a few notes), for trying the UI by hand.
# Needs ffmpeg. The output is not committed to git.
$ErrorActionPreference = 'Stop'
$demo = Join-Path $PSScriptRoot 'demo'
New-Item -ItemType Directory -Force "$demo/assets", "$demo/video", "$demo/.sniptoss/annotations" | Out-Null
ffmpeg -v error -y -f lavfi -i "testsrc2=size=1920x1080" -frames:v 1 "$demo/assets/hero.png"
ffmpeg -v error -y -f lavfi -i "smptehdbars=size=1080x1350" -frames:v 1 "$demo/assets/poster-02.jpg"
ffmpeg -v error -y -f lavfi -i "testsrc2=size=1280x720:rate=30" -f lavfi -i "sine=frequency=440" -t 20 `
  -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "$demo/video/intro.mp4"
# Portrait items: for testing Fit to Window
ffmpeg -v error -y -f lavfi -i "testsrc2=size=1080x1920:rate=30" -t 6 -c:v libx264 -pix_fmt yuv420p "$demo/video/portrait-9x16.mp4"
ffmpeg -v error -y -f lavfi -i "smptebars=size=1080x2400" -frames:v 1 "$demo/assets/long-screenshot.png"
Copy-Item "$PSScriptRoot/../packages/core/test/fixture/.sniptoss/annotations/*.json" "$demo/.sniptoss/annotations/"
Write-Host "Generated $demo"
