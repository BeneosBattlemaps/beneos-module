# Beneos Wiki i18n compiler.
#
# Reads the authoring sources (wiki-strings.json + content/<key>.html) and
# merges the resulting BENEOS.Wiki.* / BENEOS.Toolbar.OpenWiki flat keys into
# every lang/*.json. English values are written into all 13 languages for now
# (the dedicated localization wave translates them later). The merge is
# idempotent and minimal: existing managed keys are stripped line-by-line and
# the fresh block is re-inserted before the closing brace, leaving every other
# key and the file's newline style untouched.
#
# Run:  pwsh -File docs/_wiki-source/authoring/build-wiki.ps1

$ErrorActionPreference = "Stop"

$root      = Split-Path -Parent $PSScriptRoot          # docs/_wiki-source
$moduleDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path  # module root
$authoring = $PSScriptRoot
$contentDir= Join-Path $authoring "content"
$langDir   = Join-Path $moduleDir "lang"

Write-Host "Module dir : $moduleDir"
Write-Host "Lang dir   : $langDir"

$strings = Get-Content (Join-Path $authoring "wiki-strings.json") -Raw | ConvertFrom-Json

# Build an ordered list of flat key/value pairs.
$pairs = [System.Collections.Generic.List[object]]::new()
function Add-Pair([string]$k, [string]$v) { $script:pairs.Add([pscustomobject]@{ Key = $k; Val = $v }) }

Add-Pair "BENEOS.Wiki.Title"                 $strings.ui.Title
Add-Pair "BENEOS.Wiki.Ui.SearchPlaceholder"  $strings.ui.'Ui.SearchPlaceholder'
Add-Pair "BENEOS.Wiki.Ui.Results"            $strings.ui.'Ui.Results'
Add-Pair "BENEOS.Wiki.Ui.NoResult"           $strings.ui.'Ui.NoResult'
Add-Pair "BENEOS.Wiki.Ui.Prev"               $strings.ui.'Ui.Prev'
Add-Pair "BENEOS.Wiki.Ui.Next"               $strings.ui.'Ui.Next'
Add-Pair "BENEOS.Wiki.Ui.Footer"             $strings.ui.'Ui.Footer'
Add-Pair "BENEOS.Wiki.Ui.TourMissing"        $strings.ui.'Ui.TourMissing'
Add-Pair "BENEOS.Toolbar.OpenWiki"           $strings.ui.ToolbarOpenWiki

foreach ($c in $strings.cat.PSObject.Properties) {
  Add-Pair ("BENEOS.Wiki.Cat." + $c.Name) $c.Value
}

$missing = @()
foreach ($p in $strings.pages.PSObject.Properties) {
  $key = $p.Name
  Add-Pair ("BENEOS.Wiki.Page.$key.Title")  $p.Value.title
  Add-Pair ("BENEOS.Wiki.Page.$key.Search") $p.Value.search
  $bodyFile = Join-Path $contentDir "$key.html"
  if (Test-Path $bodyFile) {
    $body = (Get-Content $bodyFile -Raw).Trim()
  } else {
    $body = "<p><em>Documentation for this topic is coming soon.</em></p>"
    $missing += $key
  }
  Add-Pair ("BENEOS.Wiki.Page.$key.Body") $body
}

Write-Host ("Prepared {0} keys ({1} pages, {2} missing body files)." -f $pairs.Count, $strings.pages.PSObject.Properties.Count, $missing.Count)
if ($missing.Count) { Write-Host ("  Missing bodies: " + ($missing -join ", ")) -ForegroundColor Yellow }

# Render the JSON block (one key per physical line).
function Render-Block([string]$nl) {
  $lines = foreach ($p in $pairs) {
    $k = $p.Key | ConvertTo-Json -Compress
    $v = ($p.Val) | ConvertTo-Json -Compress
    "  $k`: $v"
  }
  return ($lines -join (",$nl"))
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$langFiles = Get-ChildItem $langDir -Filter *.json | Sort-Object Name

foreach ($f in $langFiles) {
  $raw = [System.IO.File]::ReadAllText($f.FullName)
  $nl  = if ($raw -match "`r`n") { "`r`n" } else { "`n" }

  # Strip previously-managed keys (each lives on its own physical line).
  $kept = ($raw -split "`r?`n") | Where-Object {
    ($_ -notmatch '^\s*"BENEOS\.Wiki\.') -and ($_ -notmatch '^\s*"BENEOS\.Toolbar\.OpenWiki"\s*:')
  }
  $text = ($kept -join $nl)

  $idx = $text.LastIndexOf('}')
  if ($idx -lt 0) { throw "No closing brace in $($f.Name)" }
  $head = $text.Substring(0, $idx).TrimEnd()
  $head = $head.TrimEnd(',').TrimEnd()

  $block = Render-Block $nl
  $new = $head + "," + $nl + $block + $nl + "}" + $nl

  [System.IO.File]::WriteAllText($f.FullName, $new, $utf8NoBom)

  # Validate JSON round-trips. Use -AsHashtable: these lang files legitimately
  # contain keys that differ only by case (e.g. Phase.startOfTurn vs
  # Phase.StartOfTurn), which the default (case-insensitive object) parser
  # rejects even though the JSON itself is valid.
  try { [void]([System.IO.File]::ReadAllText($f.FullName) | ConvertFrom-Json -AsHashtable) }
  catch { throw "Invalid JSON produced for $($f.Name): $_" }

  Write-Host ("  ok  {0}" -f $f.Name)
}

Write-Host "Done. Wiki keys merged into all language files." -ForegroundColor Green
