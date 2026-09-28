param([Parameter(Mandatory=$true)][string]$InputDir)
Add-Type -AssemblyName System.IO.Compression.FileSystem
$failed = $false
Get-ChildItem $InputDir -Filter '*.pptx' | ForEach-Object {
  $zip = [IO.Compression.ZipFile]::OpenRead($_.FullName)
  try {
    $names = @($zip.Entries | ForEach-Object FullName)
    $slideNames = @($names | Where-Object { $_ -match '^ppt/slides/slide\d+\.xml$' })
    if (!$names.Contains('[Content_Types].xml') -or $slideNames.Count -eq 0) { throw 'missing content types or slides' }
    $ids = @{}
    foreach ($slideName in $slideNames) {
      $entry = $zip.GetEntry($slideName)
      $reader = New-Object IO.StreamReader($entry.Open())
      try { $xml = [xml]$reader.ReadToEnd() } finally { $reader.Close() }
      $seen = @{}
      foreach ($node in $xml.SelectNodes('//*[local-name()="cNvPr"]')) {
        $id = [string]$node.id
        if ($seen.ContainsKey($id)) { throw "duplicate shape id $id in $slideName" }
        $seen[$id] = $true
      }
      $relName = $slideName -replace '^ppt/slides/', 'ppt/slides/_rels/'
      $relName = $relName -replace '\.xml$', '.xml.rels'
      if (!$names.Contains($relName)) { throw "missing rels for $slideName" }
    }
    Write-Output "$($_.Name): valid XML, $($slideNames.Count) slides, unique shape ids"
  } catch { Write-Error "$($_.Name): $($_.Exception.Message)"; $failed = $true }
  finally { $zip.Dispose() }
}
if ($failed) { exit 1 }
