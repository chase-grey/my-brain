#Requires -Version 5.1
<#
Files work transcripts from Mark Zakharov's Transcribe app into the Hivemind vault (docs/transcripts.md).

The app's "send transcript" writes a package folder to the signed-in work OneDrive under
TranscribeInbox\YYYY\MM\<utc>_<id>_<title>\ holding manifest.v1.json, transcript.v1.json, and
transcript.md. OneDrive syncs it to this PC. Each package becomes
"07 Meetings\Transcripts\YYYY-MM-DD <title>.md": frontmatter from the JSON, body from the markdown.

A ledger of filed artifact ids under %LOCALAPPDATA%\my-brain keeps re-runs idempotent; the packages
in OneDrive are never touched.

Dot-source for Import-TranscribePackages (the work bridge does), or run alone:
  powershell -NoProfile -File bridge/transcript-inbox.ps1 -Once
#>
param(
  [switch]$Once,
  [string]$InboxPath = "$env:USERPROFILE\OneDrive - Epic\TranscribeInbox",
  [string]$VaultPath = "$env:USERPROFILE\Documents\Obsidian\Hivemind",
  [string]$LedgerPath = "$env:LOCALAPPDATA\my-brain\transcripts-filed.json"
)

$script:TranscriptsFolder = '07 Meetings\Transcripts'

function Get-SafeTranscriptTitle([string]$Raw, [int]$MaxLength = 60) {
  $chars = foreach ($ch in $Raw.ToCharArray()) {
    if ('"*:<>?/\|'.IndexOf($ch) -ge 0 -or ([int]$ch -lt 32 -and -not [char]::IsWhiteSpace($ch))) { '_' } else { $ch }
  }
  $cleaned = ((-join $chars) -replace '\s+', ' ').Trim().Trim('.', ' ')
  if ($cleaned.Length -gt $MaxLength) { $cleaned = $cleaned.Substring(0, $MaxLength).Trim('.', ' ') }
  if (-not $cleaned) { return 'recording' }
  $stem = $cleaned.Split('.')[0].ToUpperInvariant()
  $reserved = @('CON', 'PRN', 'AUX', 'NUL') + (1..9 | ForEach-Object { "COM$_"; "LPT$_" })
  if ($reserved -contains $stem) { $cleaned = "_$cleaned" }
  return $cleaned
}

function Read-TranscriptLedger([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return @{} }
  $table = @{}
  try {
    $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($property in $raw.PSObject.Properties) { $table[$property.Name] = $property.Value }
  } catch {
    Write-Warning "transcript ledger unreadable at $Path; starting a new one ($($_.Exception.Message))"
  }
  return $table
}

function Save-TranscriptLedger([string]$Path, [hashtable]$Ledger) {
  $folder = Split-Path -Parent $Path
  if (-not (Test-Path -LiteralPath $folder)) { New-Item -ItemType Directory -Path $folder -Force | Out-Null }
  $utf8 = [Text.UTF8Encoding]::new($false)
  [IO.File]::WriteAllText($Path, ($Ledger | ConvertTo-Json -Depth 4), $utf8)
}

function ConvertTo-YamlString([string]$Value) {
  return '"' + ($Value -replace '\\', '\\' -replace '"', '\"') + '"'
}

function Format-TranscriptDuration([long]$Ms) {
  $total = [math]::Max(0, [math]::Floor($Ms / 1000))
  $hours = [math]::Floor($total / 3600)
  $minutes = [math]::Floor(($total % 3600) / 60)
  $seconds = $total % 60
  if ($hours -gt 0) { return ('{0}:{1:00}:{2:00}' -f $hours, $minutes, $seconds) }
  return ('{0:00}:{1:00}' -f $minutes, $seconds)
}

# Builds the note text for one package. Pure, so it is testable without OneDrive or the vault.
function New-TranscriptNote($Transcript, [string]$Markdown) {
  $recording = $Transcript.recording
  $title = if ($recording.title) { [string]$recording.title } else { 'recording' }
  $created = [datetimeoffset]::Parse([string]$recording.createdAtUtc, [Globalization.CultureInfo]::InvariantCulture).ToLocalTime()
  $front = [Collections.Generic.List[string]]::new()
  $front.Add('---')
  $front.Add("date: $($created.ToString('yyyy-MM-dd'))")
  $front.Add('type: transcript')
  if ($recording.durationMs) { $front.Add("duration: $(ConvertTo-YamlString (Format-TranscriptDuration ([long]$recording.durationMs)))") }
  if ($Transcript.speakers) { $front.Add("speakers: $(@($Transcript.speakers).Count)") }
  $attendees = @()
  if ($recording.linkedEvent -and $recording.linkedEvent.attendees) {
    $attendees = @($recording.linkedEvent.attendees | ForEach-Object { if ($_.name) { [string]$_.name } elseif ($_.email) { [string]$_.email } } | Where-Object { $_ })
  }
  if ($attendees.Count) {
    $front.Add('attendees:')
    foreach ($name in $attendees) { $front.Add("  - $(ConvertTo-YamlString $name)") }
  } else {
    $front.Add('attendees: []')
  }
  if ($recording.linkedEvent -and $recording.linkedEvent.subject) { $front.Add("meeting: $(ConvertTo-YamlString ([string]$recording.linkedEvent.subject))") }
  $front.Add('source: transcribe')
  $front.Add('---')

  # The markdown export opens with the heading and a Date/Duration/Speakers bullet header that the
  # frontmatter now carries; keep only the transcript lines under a heading.
  $lines = ($Markdown -replace "`r`n", "`n").Split("`n")
  $index = 0
  while ($index -lt $lines.Count) {
    $line = $lines[$index].Trim()
    if (-not $line -or $line.StartsWith('# ') -or $line -match '^- (Date|Duration|Speakers):') { $index++; continue }
    break
  }
  $body = "# $title`n`n" + (($lines[$index..($lines.Count - 1)] -join "`n").Trim())
  return [pscustomobject]@{
    Title = $title
    Date = $created.ToString('yyyy-MM-dd')
    Content = (($front -join "`n") + "`n" + $body + "`n")
  }
}

function Import-TranscribePackages {
  param(
    [string]$InboxPath = $script:DefaultInboxPath,
    [string]$VaultPath = $script:DefaultVaultPath,
    [string]$LedgerPath = $script:DefaultLedgerPath
  )
  $result = [ordered]@{ inbox = $InboxPath; filed = @(); skipped = 0; errors = @() }
  if (-not (Test-Path -LiteralPath $InboxPath)) { return [pscustomobject]$result }
  if (-not (Test-Path -LiteralPath $VaultPath)) { $result.errors += "vault missing at $VaultPath"; return [pscustomobject]$result }

  $ledger = Read-TranscriptLedger $LedgerPath
  $target = Join-Path $VaultPath $script:TranscriptsFolder
  $utf8 = [Text.UTF8Encoding]::new($false)

  foreach ($manifestFile in Get-ChildItem -LiteralPath $InboxPath -Filter 'manifest.v1.json' -Recurse -File -ErrorAction SilentlyContinue) {
    $folder = $manifestFile.DirectoryName
    try {
      $manifest = Get-Content -LiteralPath $manifestFile.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
      $artifactId = [string]$manifest.artifactId
      if (-not $artifactId) { $artifactId = $folder }
      if ($ledger.ContainsKey($artifactId)) { $result.skipped++; continue }
      if ($manifest.state -and $manifest.state -ne 'complete') { continue }

      $jsonPath = Join-Path $folder 'transcript.v1.json'
      $mdPath = Join-Path $folder 'transcript.md'
      if (-not (Test-Path -LiteralPath $jsonPath) -or -not (Test-Path -LiteralPath $mdPath)) { continue }
      $transcript = Get-Content -LiteralPath $jsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
      $markdown = Get-Content -LiteralPath $mdPath -Raw -Encoding UTF8
      $note = New-TranscriptNote $transcript $markdown

      if (-not (Test-Path -LiteralPath $target)) { New-Item -ItemType Directory -Path $target -Force | Out-Null }
      $base = "$($note.Date) $(Get-SafeTranscriptTitle $note.Title)"
      $path = Join-Path $target "$base.md"
      $suffix = 2
      while (Test-Path -LiteralPath $path) { $path = Join-Path $target "$base $suffix.md"; $suffix++ }
      [IO.File]::WriteAllText($path, $note.Content, $utf8)

      $relative = $path.Substring($VaultPath.TrimEnd('\').Length + 1)
      $ledger[$artifactId] = [ordered]@{ path = $relative; filedAt = (Get-Date).ToString('o'); package = $folder }
      Save-TranscriptLedger $LedgerPath $ledger
      $result.filed += $relative
    } catch {
      $result.errors += "$folder`: $($_.Exception.Message)"
    }
  }
  return [pscustomobject]$result
}

$script:DefaultInboxPath = $InboxPath
$script:DefaultVaultPath = $VaultPath
$script:DefaultLedgerPath = $LedgerPath

if ($Once) {
  $outcome = Import-TranscribePackages -InboxPath $InboxPath -VaultPath $VaultPath -LedgerPath $LedgerPath
  foreach ($path in $outcome.filed) { Write-Host "filed $path" }
  foreach ($problem in $outcome.errors) { Write-Warning $problem }
  Write-Host "transcripts: $($outcome.filed.Count) filed, $($outcome.skipped) already filed"
}
