param(
  [int]$Port = 47321,
  [string[]]$AllowedOrigins = @('http://localhost:5173', 'https://chase-grey.github.io'),
  [string]$VaultPath = "$env:USERPROFILE\Documents\Obsidian\Hivemind",
  [string[]]$ChatAllowedTools = @('Read', 'Glob', 'Grep', 'Edit', 'Write', 'Skill', 'mcp__office-assistant__*'),
  [int]$ChatTimeoutSec = 240
)

# Routes:
#   GET  /status, GET /tasks, POST /tasks, PATCH /tasks/{id}   classic Outlook COM (Outlook must be running)
#   GET  /chat/status, POST /chat                               Claude Code headless (`claude -p`) with the vault as cwd
# The listener handles one request at a time, so a chat turn (often 10-60 s) delays task requests until it returns.

$ErrorActionPreference = 'Stop'
$utf8 = [Text.UTF8Encoding]::new($false)
try { [Console]::InputEncoding = $utf8; [Console]::OutputEncoding = $utf8 } catch { }
$claudeCommand = (Get-Command claude -ErrorAction SilentlyContinue).Source

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()
Write-Host "my brain work bridge listening on 127.0.0.1:$Port"
Write-Host "chat: $(if ($claudeCommand) { $claudeCommand } else { 'claude not found on PATH' }) in $VaultPath"

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
    throw 'classic outlook must already be running'
  }
}

function Convert-Task($Item) {
  [ordered]@{
    entryId = $Item.EntryID
    subject = $Item.Subject
    dueDate = if ($Item.DueDate -and $Item.DueDate.Year -gt 1900) { $Item.DueDate.ToString('yyyy-MM-dd') } else { $null }
    complete = [bool]$Item.Complete
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

function Invoke-ClaudeChat([string]$Text, [string]$SessionId, [string]$SystemPrompt) {
  if (-not $claudeCommand) { throw 'claude is not on PATH' }
  if (-not (Test-Path -LiteralPath $VaultPath)) { throw "vault folder not found: $VaultPath" }
  $isNew = [string]::IsNullOrWhiteSpace($SessionId)
  if ($isNew) { $SessionId = [guid]::NewGuid().ToString() }

  $arguments = @('-p', '--output-format', 'json', '--permission-mode', 'dontAsk', '--allowedTools') + $ChatAllowedTools
  $arguments += if ($isNew) { @('--session-id', $SessionId) } else { @('--resume', $SessionId) }
  if ($isNew -and -not [string]::IsNullOrWhiteSpace($SystemPrompt)) { $arguments += @('--append-system-prompt', $SystemPrompt) }

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
    $context = $listener.GetContext()
    try {
      $origin = $context.Request.Headers['Origin']
      if ($origin -and $origin -notin $AllowedOrigins) { Write-JsonResponse $context 403 @{ error = 'origin not allowed' }; continue }
      if ($origin) { $context.Response.Headers['Access-Control-Allow-Origin'] = $origin }
      $context.Response.Headers['Access-Control-Allow-Methods'] = 'GET, POST, PATCH, OPTIONS'
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
        }
        continue
      }

      if ($method -eq 'POST' -and $path -eq '/chat') {
        $body = Read-JsonBody $context
        if (-not $body -or [string]::IsNullOrWhiteSpace($body.text)) { Write-JsonResponse $context 400 @{ error = 'text is required' }; continue }
        Write-JsonResponse $context 200 (Invoke-ClaudeChat ([string]$body.text) ([string]$body.sessionId) ([string]$body.systemPrompt))
        continue
      }

      $outlook = Get-OutlookApplication
      $namespace = $outlook.Session

      if ($method -eq 'GET' -and $path -eq '/status') {
        Write-JsonResponse $context 200 @{
          tasks = $namespace.GetDefaultFolder(13).Items.Count
          calendarItems = $namespace.GetDefaultFolder(9).Items.Count
          inbox = $namespace.GetDefaultFolder(6).Items.Count
          important = @($namespace.GetDefaultFolder(6).Items | Where-Object { $_.Importance -eq 2 -or $_.IsMarkedAsTask }).Count
        }
        continue
      }

      if ($method -eq 'GET' -and $path -eq '/tasks') {
        $items = @($namespace.GetDefaultFolder(13).Items | ForEach-Object { Convert-Task $_ })
        Write-JsonResponse $context 200 $items
        continue
      }

      $body = Read-JsonBody $context
      if ($method -eq 'POST' -and $path -eq '/tasks') {
        $item = $outlook.CreateItem(3)
        $item.Subject = $body.title
        if ($body.dueDate) { $item.DueDate = [datetime]::ParseExact($body.dueDate, 'yyyy-MM-dd', $null) }
        $item.Save()
        Write-JsonResponse $context 201 (Convert-Task $item)
        continue
      }

      if ($method -eq 'PATCH' -and $path.StartsWith('/tasks/')) {
        $entryId = [Uri]::UnescapeDataString($path.Substring(7))
        $item = $namespace.GetItemFromID($entryId)
        if ($null -ne $body.title) { $item.Subject = $body.title }
        if ($null -ne $body.completed) { $item.Complete = [bool]$body.completed }
        if ($body.dueDate) { $item.DueDate = [datetime]::ParseExact($body.dueDate, 'yyyy-MM-dd', $null) }
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
