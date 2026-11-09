param(
  [int]$Port = 47321,
  [string[]]$AllowedOrigins = @('http://localhost:5173', 'https://chase-grey.github.io'),
  [string]$VaultPath = "$env:USERPROFILE\Documents\Obsidian\Hivemind",
  [string[]]$ChatAllowedTools = @('Read', 'Glob', 'Grep', 'Edit', 'Write', 'Skill', 'mcp__office-assistant__*', 'Bash(node *)', 'Bash(curl http://127.0.0.1:47321/*)'),
  [int]$ChatTimeoutSec = 240,
  [string]$TranscriptInboxPath = "$env:USERPROFILE\OneDrive - Epic\TranscribeInbox",
  [int]$TranscriptIntervalSec = 120
)

# Routes:
#   GET  /status, GET /tasks, POST /tasks, PATCH /tasks/{id}   classic Outlook COM (started in the background if needed)
#   GET  /chat/status, POST /chat                               Claude Code headless (`claude -p`) with the vault as cwd
#   POST /transcripts/import                                    file Transcribe packages from OneDrive into the vault now
#   GET  /work/snapshot, POST /work/refresh                     vibes (EpicDW) work snapshot, cached in 99 System/work-snapshot.json
#   GET/PUT /work/config, POST /work/ignores, DELETE /work/ignores/{kind}/{id}   dashboard filters, ignores, outage window
# The listener handles one request at a time, so a chat turn (often 10-60 s) delays task requests until it returns.
# Between requests it files new transcript packages every $TranscriptIntervalSec (docs/transcripts.md) and
# rebuilds the work snapshot once it is older than an hour (docs/work-dashboard.md).

$ErrorActionPreference = 'Stop'
$utf8 = [Text.UTF8Encoding]::new($false)
try { [Console]::InputEncoding = $utf8; [Console]::OutputEncoding = $utf8 } catch { }
$claudeCommand = (Get-Command claude -ErrorAction SilentlyContinue).Source

. "$PSScriptRoot\transcript-inbox.ps1" -InboxPath $TranscriptInboxPath -VaultPath $VaultPath
. "$PSScriptRoot\work-dashboard.ps1" -VaultPath $VaultPath
$script:transcriptsFiled = 0
$script:transcriptsLastRun = $null
$script:transcriptsNextRun = Get-Date

function Invoke-TranscriptImport {
  $script:transcriptsNextRun = (Get-Date).AddSeconds($TranscriptIntervalSec)
  try {
    $outcome = Import-TranscribePackages -InboxPath $TranscriptInboxPath -VaultPath $VaultPath
    $script:transcriptsLastRun = (Get-Date).ToString('o')
    $script:transcriptsFiled += $outcome.filed.Count
    foreach ($path in $outcome.filed) { Write-Host "transcript filed: $path" }
    foreach ($problem in $outcome.errors) { Write-Warning "transcript: $problem" }
    return $outcome
  } catch {
    Write-Warning "transcript import failed: $($_.Exception.Message)"
    return [pscustomobject]@{ inbox = $TranscriptInboxPath; filed = @(); skipped = 0; errors = @($_.Exception.Message) }
  }
}

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()
Write-Host "my brain work bridge listening on 127.0.0.1:$Port"
Write-Host "chat: $(if ($claudeCommand) { $claudeCommand } else { 'claude not found on PATH' }) in $VaultPath"
Write-Host "transcripts: $TranscriptInboxPath -> $VaultPath every $TranscriptIntervalSec s"
Write-Host "work snapshot: $SqlServer/$SqlDatabase vibes -> 99 System/work-snapshot.json"
Invoke-TranscriptImport | Out-Null

function Write-JsonResponse($Context, [int]$Status, $Value) {
  $json = if ($null -eq $Value) { '' } else { $Value | ConvertTo-Json -Depth 8 -Compress }
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $Context.Response.StatusCode = $Status
  $Context.Response.ContentType = 'application/json; charset=utf-8'
  $Context.Response.ContentLength64 = $bytes.Length
  if ($bytes.Length) { $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length) }
  $Context.Response.Close()
}

function Read-JsonBody($Context) {
  $reader = [IO.StreamReader]::new($Context.Request.InputStream, [Text.Encoding]::UTF8)
  $raw = $reader.ReadToEnd()
  if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
  return $raw | ConvertFrom-Json
}

function Get-OutlookApplication {
  try {
    return [Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application')
  } catch {
    # Not running: COM starts classic Outlook in the background (the new Outlook has no COM surface).
    try { return New-Object -ComObject Outlook.Application } catch { throw 'classic outlook is not installed or could not start' }
  }
}

# Open tasks plus anything completed in the last two weeks; the thousands of older completions stay in Outlook.
function Get-WorkTaskItems($Namespace) {
  $folder = $Namespace.GetDefaultFolder(13)
  # Outlook's filter parser takes a short date only; a time of day makes the clause match nothing.
  $since = (Get-Date).AddDays(-14).ToString('d')
  $open = @($folder.Items.Restrict('[Complete] = False'))
  $recent = @($folder.Items.Restrict("[Complete] = True AND [DateCompleted] >= '$since'"))
  @($open + $recent) | Where-Object { $_.Class -eq 48 }
}

function Convert-Task($Item) {
  [ordered]@{
    entryId = $Item.EntryID
    subject = $Item.Subject
    dueDate = if ($Item.DueDate -and $Item.DueDate.Year -gt 1900 -and $Item.DueDate.Year -lt 4500) { $Item.DueDate.ToString('yyyy-MM-dd') } else { $null }
    complete = [bool]$Item.Complete
    completedOn = if ($Item.Complete -and $Item.DateCompleted -and $Item.DateCompleted.Year -gt 1900 -and $Item.DateCompleted.Year -lt 4500) { $Item.DateCompleted.ToString('yyyy-MM-dd') } else { $null }
    importance = [int]$Item.Importance
    notes = if ($Item.Body) { ([string]$Item.Body).Trim() } else { '' }
  }
}

# Quote one argument the way the Windows C runtime expects (CommandLineToArgvW rules).
function ConvertTo-WindowsArgument([string]$Value) {
  if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') { return $Value }
  $builder = [Text.StringBuilder]::new('"')
  $backslashes = 0
  foreach ($char in $Value.ToCharArray()) {
    if ($char -eq '\') { $backslashes++; continue }
    if ($char -eq '"') { [void]$builder.Append('\' * ($backslashes * 2 + 1)).Append('"'); $backslashes = 0; continue }
    if ($backslashes) { [void]$builder.Append('\' * $backslashes); $backslashes = 0 }
    [void]$builder.Append($char)
  }
  if ($backslashes) { [void]$builder.Append('\' * ($backslashes * 2)) }
  return $builder.Append('"').ToString()
}

function Invoke-ClaudeChat([string]$Text, [string]$SessionId, [string]$SystemPrompt, [string]$Model, [string]$Effort) {
  if (-not $claudeCommand) { throw 'claude is not on PATH' }
  if (-not (Test-Path -LiteralPath $VaultPath)) { throw "vault folder not found: $VaultPath" }
  $isNew = [string]::IsNullOrWhiteSpace($SessionId)
  if ($isNew) { $SessionId = [guid]::NewGuid().ToString() }

  $arguments = @('-p', '--output-format', 'json', '--permission-mode', 'dontAsk', '--allowedTools') + $ChatAllowedTools
  $arguments += if ($isNew) { @('--session-id', $SessionId) } else { @('--resume', $SessionId) }
  if ($isNew -and -not [string]::IsNullOrWhiteSpace($SystemPrompt)) { $arguments += @('--append-system-prompt', $SystemPrompt) }
  # The app picks these per message; they apply to resumed sessions too. Only plain names get through to the command line.
  if ($Model -match '^[A-Za-z0-9._-]+$') { $arguments += @('--model', $Model) }
  if ($Effort -match '^(low|medium|high|xhigh|max)$') { $arguments += @('--effort', $Effort) }

  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $claudeCommand
  $startInfo.Arguments = ($arguments | ForEach-Object { ConvertTo-WindowsArgument $_ }) -join ' '
  $startInfo.WorkingDirectory = $VaultPath
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardInput = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.StandardOutputEncoding = $utf8
  $startInfo.StandardErrorEncoding = $utf8

  $process = [Diagnostics.Process]::Start($startInfo)
  $stdout = $process.StandardOutput.ReadToEndAsync()
  $stderr = $process.StandardError.ReadToEndAsync()
  $process.StandardInput.Write($Text)
  $process.StandardInput.Close()
  if (-not $process.WaitForExit($ChatTimeoutSec * 1000)) {
    try { $process.Kill() } catch { }
    throw "claude did not answer within $ChatTimeoutSec seconds"
  }

  $output = $stdout.Result
  try {
    $result = $output | ConvertFrom-Json
  } catch {
    $detail = if ($stderr.Result) { $stderr.Result.Trim() } else { $output.Trim() }
    throw "claude returned something other than json: $detail"
  }
  if ($null -eq $result) { throw "claude returned nothing: $($stderr.Result)" }

  $sessionOut = if ($result.session_id) { [string]$result.session_id } else { $SessionId }
  [ordered]@{
    text = [string]$result.result
    sessionId = $sessionOut
    isError = [bool]$result.is_error -or $process.ExitCode -ne 0
  }
}

try {
  while ($listener.IsListening) {
    # Wait for a request in one-second slices so transcript packages get filed while the bridge is idle.
    $pending = $listener.GetContextAsync()
    while (-not $pending.Wait(1000)) {
      if ((Get-Date) -ge $script:transcriptsNextRun) { Invoke-TranscriptImport | Out-Null }
      if (Test-WorkSnapshotStale) {
        $script:workBuilding = $true
        try { Build-WorkSnapshot | Out-Null } catch { Write-Warning "work snapshot failed: $($_.Exception.Message)"; $script:workSnapshotBuiltAt = Get-Date } finally { $script:workBuilding = $false }
      }
    }
    $context = $pending.Result
    try {
      $origin = $context.Request.Headers['Origin']
      if ($origin -and $origin -notin $AllowedOrigins) { Write-JsonResponse $context 403 @{ error = 'origin not allowed' }; continue }
      if ($origin) { $context.Response.Headers['Access-Control-Allow-Origin'] = $origin }
      $context.Response.Headers['Access-Control-Allow-Methods'] = 'GET, POST, PATCH, PUT, DELETE, OPTIONS'
      $context.Response.Headers['Access-Control-Allow-Headers'] = 'Content-Type'
      if ($context.Request.HttpMethod -eq 'OPTIONS') { Write-JsonResponse $context 204 $null; continue }

      $method = $context.Request.HttpMethod
      $path = $context.Request.Url.AbsolutePath

      if ($method -eq 'GET' -and $path -eq '/chat/status') {
        Write-JsonResponse $context 200 @{
          claude = [bool]$claudeCommand
          claudePath = $claudeCommand
          vault = (Test-Path -LiteralPath $VaultPath)
          vaultPath = $VaultPath
          transcripts = @{ inbox = $TranscriptInboxPath; filed = $script:transcriptsFiled; lastRun = $script:transcriptsLastRun }
        }
        continue
      }

      if ($method -eq 'POST' -and $path -eq '/transcripts/import') {
        Write-JsonResponse $context 200 (Invoke-TranscriptImport)
        continue
      }

      if ($path -eq '/work/snapshot' -or $path -eq '/work/refresh') {
        if ($method -eq 'GET' -and $path -eq '/work/snapshot') { $json = Get-WorkSnapshotJson $false $true }
        elseif ($method -eq 'POST' -and $path -eq '/work/refresh') { $json = Build-WorkSnapshot }
        else { Write-JsonResponse $context 405 @{ error = 'method not allowed' }; continue }
        $bytes = $utf8.GetBytes($json)
        $context.Response.StatusCode = 200
        $context.Response.ContentType = 'application/json; charset=utf-8'
        $context.Response.ContentLength64 = $bytes.Length
        $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        $context.Response.Close()
        continue
      }

      if ($path -eq '/work/config') {
        if ($method -eq 'GET') { Write-JsonResponse $context 200 (Get-WorkConfig); continue }
        if ($method -eq 'PUT') {
          $body = Read-JsonBody $context
          if (-not $body) { Write-JsonResponse $context 400 @{ error = 'config body is required' }; continue }
          $current = Get-WorkConfig
          foreach ($property in $body.PSObject.Properties) {
            if ($property.Name -eq 'filters' -and $null -ne $property.Value) { foreach ($filter in $property.Value.PSObject.Properties) { $current.filters[$filter.Name] = $filter.Value } }
            elseif ($property.Name -ne 'version') { $current[$property.Name] = $property.Value }
          }
          Write-JsonResponse $context 200 (Save-WorkConfig $current)
          continue
        }
        Write-JsonResponse $context 405 @{ error = 'method not allowed' }; continue
      }

      if ($method -eq 'POST' -and $path -eq '/work/ignores') {
        $body = Read-JsonBody $context
        if (-not $body -or -not $body.kind -or -not $body.id) { Write-JsonResponse $context 400 @{ error = 'kind and id are required' }; continue }
        Write-JsonResponse $context 200 (Add-WorkIgnore ([string]$body.kind) ([string]$body.id) ([string]$body.note) ([string]$body.until))
        continue
      }

      if ($method -eq 'DELETE' -and $path -match '^/work/ignores/([a-z]+)/([A-Za-z]?\d+)$') {
        Write-JsonResponse $context 200 (Remove-WorkIgnore $Matches[1] $Matches[2])
        continue
      }

      if ($method -eq 'POST' -and $path -eq '/chat') {
        $body = Read-JsonBody $context
        if (-not $body -or [string]::IsNullOrWhiteSpace($body.text)) { Write-JsonResponse $context 400 @{ error = 'text is required' }; continue }
        Write-JsonResponse $context 200 (Invoke-ClaudeChat ([string]$body.text) ([string]$body.sessionId) ([string]$body.systemPrompt) ([string]$body.model) ([string]$body.effort))
        continue
      }

      $outlook = Get-OutlookApplication
      $namespace = $outlook.Session

      if ($method -eq 'GET' -and $path -eq '/status') {
        Write-JsonResponse $context 200 @{
          tasks = @($namespace.GetDefaultFolder(13).Items.Restrict('[Complete] = False')).Count
          calendarItems = $namespace.GetDefaultFolder(9).Items.Count
          inbox = $namespace.GetDefaultFolder(6).Items.Count
          important = @($namespace.GetDefaultFolder(6).Items | Where-Object { $_.Importance -eq 2 -or $_.IsMarkedAsTask }).Count
        }
        continue
      }

      if ($method -eq 'GET' -and $path -eq '/tasks') {
        $items = @(Get-WorkTaskItems $namespace | ForEach-Object { Convert-Task $_ })
        Write-JsonResponse $context 200 $items
        continue
      }

      $body = Read-JsonBody $context
      if ($method -eq 'POST' -and $path -eq '/tasks') {
        $item = $outlook.CreateItem(3)
        $item.Subject = $body.title
        if ($body.dueDate) { $item.DueDate = [datetime]::ParseExact($body.dueDate, 'yyyy-MM-dd', $null) }
        if ($body.notes) { $item.Body = [string]$body.notes }
        $item.Save()
        Write-JsonResponse $context 201 (Convert-Task $item)
        continue
      }

      if ($method -eq 'PATCH' -and $path.StartsWith('/tasks/')) {
        $entryId = [Uri]::UnescapeDataString($path.Substring(7))
        $item = $namespace.GetItemFromID($entryId)
        if ($null -ne $body.title) { $item.Subject = $body.title }
        if ($null -ne $body.completed) { $item.Complete = [bool]$body.completed }
        if ($body.PSObject.Properties['dueDate']) {
          # Outlook stores "no due date" as 1/1/4501.
          $item.DueDate = if ($body.dueDate) { [datetime]::ParseExact($body.dueDate, 'yyyy-MM-dd', $null) } else { [datetime]'4501-01-01' }
        }
        if ($null -ne $body.notes) { $item.Body = [string]$body.notes }
        $item.Save()
        Write-JsonResponse $context 200 (Convert-Task $item)
        continue
      }

      Write-JsonResponse $context 404 @{ error = 'not found' }
    } catch {
      Write-JsonResponse $context 500 @{ error = $_.Exception.Message }
    }
  }
} finally {
  $listener.Stop()
}
