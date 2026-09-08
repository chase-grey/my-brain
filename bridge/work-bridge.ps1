param(
  [int]$Port = 47321,
  [string[]]$AllowedOrigins = @('http://localhost:5173', 'https://chase-grey.github.io')
)

$ErrorActionPreference = 'Stop'
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()
Write-Host "my brain work bridge listening on 127.0.0.1:$Port"

function Write-JsonResponse($Context, [int]$Status, $Value) {
  $json = if ($null -eq $Value) { '' } else { $Value | ConvertTo-Json -Depth 8 -Compress }
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $Context.Response.StatusCode = $Status
  $Context.Response.ContentType = 'application/json; charset=utf-8'
  $Context.Response.ContentLength64 = $bytes.Length
  if ($bytes.Length) { $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length) }
  $Context.Response.Close()
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

      $outlook = Get-OutlookApplication
      $namespace = $outlook.Session
      $path = $context.Request.Url.AbsolutePath

      if ($context.Request.HttpMethod -eq 'GET' -and $path -eq '/status') {
        Write-JsonResponse $context 200 @{
          tasks = $namespace.GetDefaultFolder(13).Items.Count
          calendarItems = $namespace.GetDefaultFolder(9).Items.Count
          inbox = $namespace.GetDefaultFolder(6).Items.Count
          important = @($namespace.GetDefaultFolder(6).Items | Where-Object { $_.Importance -eq 2 -or $_.IsMarkedAsTask }).Count
        }
        continue
      }

      if ($context.Request.HttpMethod -eq 'GET' -and $path -eq '/tasks') {
        $items = @($namespace.GetDefaultFolder(13).Items | ForEach-Object { Convert-Task $_ })
        Write-JsonResponse $context 200 $items
        continue
      }

      $reader = [IO.StreamReader]::new($context.Request.InputStream, $context.Request.ContentEncoding)
      $body = $reader.ReadToEnd() | ConvertFrom-Json
      if ($context.Request.HttpMethod -eq 'POST' -and $path -eq '/tasks') {
        $item = $outlook.CreateItem(3)
        $item.Subject = $body.title
        if ($body.dueDate) { $item.DueDate = [datetime]::ParseExact($body.dueDate, 'yyyy-MM-dd', $null) }
        $item.Save()
        Write-JsonResponse $context 201 (Convert-Task $item)
        continue
      }

      if ($context.Request.HttpMethod -eq 'PATCH' -and $path.StartsWith('/tasks/')) {
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
