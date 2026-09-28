param(
  [Parameter(Mandatory=$true)][string]$InputDir,
  [Parameter(Mandatory=$true)][string]$OutputDir
)
$pptApp = New-Object -ComObject PowerPoint.Application
try {
  New-Item -ItemType Directory -Force $OutputDir | Out-Null
  Get-ChildItem $InputDir -Filter '*.pptx' | ForEach-Object {
    $name = [IO.Path]::GetFileNameWithoutExtension($_.Name)
    $dir = Join-Path $OutputDir $name
    New-Item -ItemType Directory -Force $dir | Out-Null
    Get-ChildItem $dir -Filter 'slide-*.png' -ErrorAction SilentlyContinue | Remove-Item -Force
    $presentation = $pptApp.Presentations.Open($_.FullName, $true, $true, $false)
    try {
      for ($i = 1; $i -le $presentation.Slides.Count; $i++) {
        $presentation.Slides.Item($i).Export((Join-Path $dir "slide-$i.png"), 'PNG', 1122, 631)
      }
      Write-Output "$($_.Name): $($presentation.Slides.Count) slides"
    } finally { $presentation.Close() }
  }
} finally { $pptApp.Quit() }
