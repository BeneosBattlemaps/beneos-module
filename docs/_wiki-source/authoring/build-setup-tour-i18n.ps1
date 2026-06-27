# Beneos Setup Tour i18n compiler.
#
# The Setup Tour was rebuilt off Moulinette/Scene Packer onto the Beneos Cloud
# flow. This script strips the obsolete BENEOS.Tour.Setup.* keys (and the two
# outdated "SetupTour" hints + the FirstRun content that named Moulinette) from
# every lang/*.json and re-adds the new Cloud-based set, English in all 13
# languages for now (re-translated later). Same idempotent, minimal-diff,
# preserve-newline approach as build-wiki.ps1. It does NOT touch the Demo,
# Page* or tutorial tours, or the SetupTour Name/Label/Action keys.
#
# Run:  pwsh -File docs/_wiki-source/authoring/build-setup-tour-i18n.ps1

$ErrorActionPreference = "Stop"
$moduleDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$langDir   = Join-Path $moduleDir "lang"
Write-Host "Lang dir: $langDir"

# Ordered key -> English value to (re)add.
$pairs = [System.Collections.Specialized.OrderedDictionary]::new()
$pairs["BENEOS.Tour.Setup.Title"] = "Beneos Setup Guide"
$pairs["BENEOS.Tour.Setup.Desc"]  = "Walk through your account, Patreon and your first install, step by step."
$pairs["BENEOS.Tour.Setup.WelcomeIntro.Title"]   = "Welcome to Beneos"
$pairs["BENEOS.Tour.Setup.WelcomeIntro.Content"] = "<p>This guide gets you from a fresh install to your first map on the table.</p><p>We will sign you in, sort out Patreon, and install your first piece of content together. A couple of minutes, no guesswork.</p><p><small>You can restart it any time from Module Settings, Beneos.</small></p>"
$pairs["BENEOS.Tour.Setup.SetupLanguages.Title"]   = "Available in your language"
$pairs["BENEOS.Tour.Setup.SetupLanguages.Content"] = "<p>Beneos speaks <strong>13 languages</strong>: Catala, Cestina, Deutsch, English, Espanol, Francais, Italiano, Polski, Portugues (Brasil), Portugues (Portugal), and three more for Japanese, Korean and Traditional Chinese.</p><p>Change yours any time under Configure Settings, Core Settings, Language.</p>"
$pairs["BENEOS.Tour.Setup.PrepareCanvas.Title"]   = "Open a scene first"
$pairs["BENEOS.Tour.Setup.PrepareCanvas.Content"] = "<p>Foundry's tools sit on the left toolbar, and that toolbar only appears when a scene is open.</p><p>If you did not have one yet, we just opened a blank scene for you, so the Beneos button is ready in the next step.</p>"
$pairs["BENEOS.Tour.Setup.OpenCloud.Title"]   = "Open the Beneos Cloud"
$pairs["BENEOS.Tour.Setup.OpenCloud.Content"] = "<p>Everything Beneos installs from one place: the <strong>Beneos Cloud</strong> window.</p><p>Click the Beneos icon in the left toolbar to open it. We do the rest from inside.</p>"
$pairs["BENEOS.Tour.Setup.CloudTabs.Title"]   = "One window for everything"
$pairs["BENEOS.Tour.Setup.CloudTabs.Content"] = "<p>These tabs are your whole library: <strong>Maps</strong>, <strong>Creatures</strong>, <strong>Loot</strong> and <strong>Spells</strong>, plus a <strong>Home</strong> tab for news and sign-in.</p><p>Pick a tab, browse, install. That is the loop.</p>"
$pairs["BENEOS.Tour.Setup.CloudSignin.Title"]   = "Sign in, no password"
$pairs["BENEOS.Tour.Setup.CloudSignin.Content"] = "<p>Sign in here. Type your email and you are in; your account is created on the spot, no password.</p><p><strong>Use the same email you use on Patreon.</strong> Then your membership links automatically and your content just appears.</p><p>The same account works on <strong>beneos-battlemaps.com</strong> too, where you can download ZIP files and browse all your assets online.</p>"
$pairs["BENEOS.Tour.Setup.CloudPatreon.Title"]   = "How Patreon unlocks content"
$pairs["BENEOS.Tour.Setup.CloudPatreon.Content"] = "<p>Your Patreon membership decides what you can install. And there is a free option of every kind: free maps, creatures, loot and spells.</p><p>Locked items still show here with a <strong>Join</strong> prompt, so you always see what a membership would add.</p>"
$pairs["BENEOS.Tour.Setup.CloudFindTour.Title"]   = "Install the Getting Started Tour"
$pairs["BENEOS.Tour.Setup.CloudFindTour.Content"] = "<p>Let's get you a guided start. We will install the <strong>Getting Started Tour</strong>: it takes over from here and shows you how to work with every kind of Beneos content.</p><p>We searched <strong>tour</strong> and switched to the <strong>Releases</strong> view. There it is, highlighted.</p>"
$pairs["BENEOS.Tour.Setup.CloudInstall.Title"]   = "Click Install"
$pairs["BENEOS.Tour.Setup.CloudInstall.Content"] = "<p>Click <strong>Install</strong> to get the Getting Started Tour. Beneos downloads it straight into your world, ready to play.</p><p>Not signed in or no access yet? No problem, you can do this later. The tour will not block you.</p>"
$pairs["BENEOS.Tour.Setup.SetupComplete.Title"]   = "You are set"
$pairs["BENEOS.Tour.Setup.SetupComplete.Content"] = "<p>That is it. You have an account, you know how Patreon and the free content work, and you can install anything from the Cloud window.</p><p>If you installed the Getting Started Tour, we are opening it for you now: it picks up from here and walks you through the rest. Have fun.</p>"
$pairs["BENEOS.Settings.SetupTour.Hint"]       = "Walks you through your account, Patreon and your first install in the Beneos Cloud."
$pairs["BENEOS.Cloud.Settings.SetupTour.Hint"] = "Walk through your account, Patreon and your first install."
$pairs["BENEOS.Tour.FirstRun.Content"]         = "<p>A new install or update was detected. If you are new to Beneos, the Setup Guide walks you through your account, Patreon and your first install in a couple of minutes.</p>"
$pairs["BENEOS.Settings.Documentation.Name"]   = "Beneos Documentation"
$pairs["BENEOS.Settings.Documentation.Label"]  = "Open Documentation"
$pairs["BENEOS.Settings.Documentation.Hint"]   = "Open the Beneos documentation: setup, accounts, maps, creatures and items."
$pairs["BENEOS.Cloud.Settings.Documentation.Label"]  = "Documentation"
$pairs["BENEOS.Cloud.Settings.Documentation.Hint"]   = "Open the Beneos documentation in a window."
$pairs["BENEOS.Cloud.Settings.Documentation.Action"] = "Open"

# Line-strip patterns: remove all old setup-tour keys + the keys we re-add.
$stripPatterns = @(
  '^\s*"BENEOS\.Tour\.Setup\.',
  '^\s*"BENEOS\.Settings\.SetupTour\.Hint"\s*:',
  '^\s*"BENEOS\.Cloud\.Settings\.SetupTour\.Hint"\s*:',
  '^\s*"BENEOS\.Tour\.FirstRun\.Content"\s*:',
  '^\s*"BENEOS\.Settings\.Documentation\.',
  '^\s*"BENEOS\.Cloud\.Settings\.Documentation\.'
)

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
foreach ($f in (Get-ChildItem $langDir -Filter *.json | Sort-Object Name)) {
  $raw = [System.IO.File]::ReadAllText($f.FullName)
  $nl  = if ($raw -match "`r`n") { "`r`n" } else { "`n" }
  $kept = ($raw -split "`r?`n") | Where-Object {
    $line = $_
    -not ($stripPatterns | Where-Object { $line -match $_ })
  }
  $text = ($kept -join $nl)
  $idx = $text.LastIndexOf('}')
  $head = $text.Substring(0, $idx).TrimEnd().TrimEnd(',').TrimEnd()
  $lines = foreach ($k in $pairs.Keys) {
    "  " + ($k | ConvertTo-Json -Compress) + ": " + (($pairs[$k]) | ConvertTo-Json -Compress)
  }
  $block = ($lines -join (",$nl"))
  $new = $head + "," + $nl + $block + $nl + "}" + $nl
  [System.IO.File]::WriteAllText($f.FullName, $new, $utf8NoBom)
  try { [void]([System.IO.File]::ReadAllText($f.FullName) | ConvertFrom-Json -AsHashtable) }
  catch { throw "Invalid JSON produced for $($f.Name): $_" }
  Write-Host ("  ok  {0}" -f $f.Name)
}
Write-Host "Done. Setup Tour keys rebuilt across all language files." -ForegroundColor Green
