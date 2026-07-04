# Beneos Wiki i18n compiler (language-aware).
#
# Reads the authoring sources and merges the resulting BENEOS.Wiki.* /
# BENEOS.Toolbar.OpenWiki flat keys into every lang/*.json. Each language is
# built from its own sources with an English fallback per key/file, so this
# script never overwrites an existing translation with English:
#
#   wiki-strings.json               English master (ui, cat, pages: title+search)
#   i18n/<lang>/wiki-strings.json   translated ui/cat/pages values (same shape)
#   content/en/<key>.html           English article bodies
#   content/<lang>/<key>.html       translated article bodies
#
# A language without a translation for a page/key simply gets the English
# value until the translation lands. The merge into lang/*.json is idempotent
# and minimal: existing managed keys are stripped line-by-line and the fresh
# block is re-inserted before the closing brace, leaving every other key and
# the file's newline style untouched.
#
# Run:  pwsh -File docs/_wiki-source/authoring/build-wiki.ps1

$ErrorActionPreference = "Stop"

$moduleDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path  # module root
$authoring = $PSScriptRoot
$contentDir= Join-Path $authoring "content"
$i18nDir   = Join-Path $authoring "i18n"
$langDir   = Join-Path $moduleDir "lang"

Write-Host "Module dir : $moduleDir"
Write-Host "Lang dir   : $langDir"

$master = Get-Content (Join-Path $authoring "wiki-strings.json") -Raw | ConvertFrom-Json

# Returns the ordered key/value pairs for one language, plus fallback stats.
function Build-Pairs([string]$lang) {
  $pairs = [System.Collections.Generic.List[object]]::new()
  $stats = @{ Keys = 0; Bodies = 0 }

  $local = $null
  $localFile = Join-Path $i18nDir "$lang\wiki-strings.json"
  if ($lang -ne "en" -and (Test-Path $localFile)) {
    $local = Get-Content $localFile -Raw | ConvertFrom-Json
  }

  # Localized value with English fallback. $section: "ui" | "cat".
  function Resolve-Str([string]$section, [string]$name) {
    $enVal = $master.$section.$name
    if ($null -ne $local -and $null -ne $local.$section -and $null -ne $local.$section.$name -and "$($local.$section.$name)" -ne "") {
      return $local.$section.$name
    }
    if ($lang -ne "en") { $stats.Keys++ }
    return $enVal
  }

  $add = { param($k, $v) $pairs.Add([pscustomobject]@{ Key = $k; Val = $v }) }

  & $add "BENEOS.Wiki.Title"                (Resolve-Str "ui" "Title")
  & $add "BENEOS.Wiki.Ui.SearchPlaceholder" (Resolve-Str "ui" "Ui.SearchPlaceholder")
  & $add "BENEOS.Wiki.Ui.Results"           (Resolve-Str "ui" "Ui.Results")
  & $add "BENEOS.Wiki.Ui.NoResult"          (Resolve-Str "ui" "Ui.NoResult")
  & $add "BENEOS.Wiki.Ui.Prev"              (Resolve-Str "ui" "Ui.Prev")
  & $add "BENEOS.Wiki.Ui.Next"              (Resolve-Str "ui" "Ui.Next")
  & $add "BENEOS.Wiki.Ui.Footer"            (Resolve-Str "ui" "Ui.Footer")
  & $add "BENEOS.Wiki.Ui.TourMissing"       (Resolve-Str "ui" "Ui.TourMissing")
  & $add "BENEOS.Toolbar.OpenWiki"          (Resolve-Str "ui" "ToolbarOpenWiki")

  foreach ($c in $master.cat.PSObject.Properties) {
    & $add ("BENEOS.Wiki.Cat." + $c.Name) (Resolve-Str "cat" $c.Name)
  }

  foreach ($p in $master.pages.PSObject.Properties) {
    $key = $p.Name
    $title  = $p.Value.title
    $search = $p.Value.search
    if ($null -ne $local -and $null -ne $local.pages -and $null -ne $local.pages.$key) {
      if ("$($local.pages.$key.title)"  -ne "") { $title  = $local.pages.$key.title }  else { $stats.Keys++ }
      if ("$($local.pages.$key.search)" -ne "") { $search = $local.pages.$key.search } else { $stats.Keys++ }
    } elseif ($lang -ne "en") {
      $stats.Keys += 2
    }
    & $add ("BENEOS.Wiki.Page.$key.Title")  $title
    & $add ("BENEOS.Wiki.Page.$key.Search") $search

    $bodyFile = Join-Path $contentDir "$lang\$key.html"
    if ($lang -eq "en" -or -not (Test-Path $bodyFile)) {
      $bodyFile = Join-Path $contentDir "en\$key.html"
      if ($lang -ne "en") { $stats.Bodies++ }
    }
    if (Test-Path $bodyFile) {
      $body = (Get-Content $bodyFile -Raw).Trim()
    } else {
      $body = "<p><em>Documentation for this topic is coming soon.</em></p>"
      $script:missingEnBodies += $key
    }
    & $add ("BENEOS.Wiki.Page.$key.Body") $body
  }

  return ,@($pairs, $stats)
}

# Render the JSON block (one key per physical line).
function Render-Block($pairs, [string]$nl) {
  $lines = foreach ($p in $pairs) {
    $k = $p.Key | ConvertTo-Json -Compress
    $v = ($p.Val) | ConvertTo-Json -Compress
    "  $k`: $v"
  }
  return ($lines -join (",$nl"))
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$langFiles = Get-ChildItem $langDir -Filter *.json | Sort-Object Name
$pageCount = $master.pages.PSObject.Properties.Name.Count

foreach ($f in $langFiles) {
  $lang = $f.BaseName
  $script:missingEnBodies = @()
  $built = Build-Pairs $lang
  $pairs = $built[0]; $stats = $built[1]

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

  $block = Render-Block $pairs $nl
  $new = $head + "," + $nl + $block + $nl + "}" + $nl

  [System.IO.File]::WriteAllText($f.FullName, $new, $utf8NoBom)

  # Validate JSON round-trips. Use -AsHashtable: these lang files legitimately
  # contain keys that differ only by case (e.g. Phase.startOfTurn vs
  # Phase.StartOfTurn), which the default (case-insensitive object) parser
  # rejects even though the JSON itself is valid.
  try { [void]([System.IO.File]::ReadAllText($f.FullName) | ConvertFrom-Json -AsHashtable) }
  catch { throw "Invalid JSON produced for $($f.Name): $_" }

  if ($lang -eq "en") {
    $note = ""
    if ($script:missingEnBodies.Count) { $note = "  MISSING EN BODIES: " + ($script:missingEnBodies -join ", ") }
    Write-Host ("  ok  {0,-11} (master){1}" -f $f.Name, $note)
  } else {
    Write-Host ("  ok  {0,-11} en-fallback: {1}/{2} bodies, {3} string keys" -f $f.Name, $stats.Bodies, $pageCount, $stats.Keys)
  }
}

Write-Host "Done. Wiki keys merged into all language files." -ForegroundColor Green
