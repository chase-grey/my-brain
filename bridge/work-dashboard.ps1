param(
  [string]$VaultPath = "$env:USERPROFILE\Documents\Obsidian\Hivemind",
  [string]$SqlServer = 'thor-sql.epic.com',
  [string]$SqlDatabase = 'EpicDW',
  [int]$QueryTimeoutSec = 60,
  [int]$SnapshotMaxAgeMin = 60,
  [int]$ActivityDays = 14
)

# Work dashboard data for my brain. Reads the EpicDW `vibes` schema on Thor as the signed-in
# Windows user (docs/work-dashboard.md), writes one snapshot json into the vault, and keeps the
# per-person dashboard config (filters, ignores, outage window, products) beside it.
# Queries run one at a time and never retry on timeout: Thor is a shared replica.

$script:workSystemDir = Join-Path $VaultPath '99 System'
$script:workSnapshotPath = Join-Path $script:workSystemDir 'work-snapshot.json'
$script:workConfigPath = Join-Path $script:workSystemDir 'work-dashboard.json'
$script:workSnapshot = $null
$script:workSnapshotBuiltAt = $null
$script:workBuilding = $false
# Start from the snapshot already in the vault so the bridge answers right away and only rebuilds once it is stale.
if (Test-Path -LiteralPath $script:workSnapshotPath) {
  $script:workSnapshot = Get-Content -LiteralPath $script:workSnapshotPath -Raw -Encoding UTF8
  $script:workSnapshotBuiltAt = (Get-Item -LiteralPath $script:workSnapshotPath).LastWriteTime
}

function Get-WorkDefaultConfig {
  [ordered]@{
    version = 1
    me = $null
    products = @('SmartTools')
    filters = [ordered]@{
      teamActivityDays = 14
      teamBatonDays = 21
      pqaNearDays = 7
      designOptionalStaleDays = 21
      designOverdueGraceDays = 14
      reviewHorizonDays = 21
      optionalReviews = $false
      prjVersionsAhead = 1
      qanPriorityIds = @(1, 2, 4)
      qanStaleWorkdays = 30
    }
    ignores = @()
    outage = $null
  }
}

function Get-WorkConfig {
  $config = Get-WorkDefaultConfig
  if (Test-Path -LiteralPath $script:workConfigPath) {
    try {
      $stored = Get-Content -LiteralPath $script:workConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
      foreach ($property in $stored.PSObject.Properties) {
        if ($property.Name -eq 'filters' -and $null -ne $property.Value) {
          foreach ($filter in $property.Value.PSObject.Properties) { $config.filters[$filter.Name] = $filter.Value }
        } else {
          $config[$property.Name] = $property.Value
        }
      }
    } catch {
      Write-Warning "work dashboard config unreadable, using defaults: $($_.Exception.Message)"
    }
  }
  if ($null -eq $config.ignores) { $config.ignores = @() }
  $config.ignores = @($config.ignores)
  $config.products = @($config.products)
  return $config
}

function Save-WorkConfig($Config) {
  if (-not (Test-Path -LiteralPath $script:workSystemDir)) { New-Item -ItemType Directory -Path $script:workSystemDir | Out-Null }
  $json = $Config | ConvertTo-Json -Depth 8
  [IO.File]::WriteAllText($script:workConfigPath, $json, [Text.UTF8Encoding]::new($false))
  return $Config
}

function Add-WorkIgnore([string]$Kind, [string]$Id, [string]$Note, [string]$Until) {
  if ($Kind -notmatch '^(dlg|design|prj|qan|slg|person)$') { throw 'kind must be dlg, design, prj, qan, slg, or person' }
  if ($Id -notmatch '^[A-Za-z]?\d+$') { throw 'id must be a record id' }
  $config = Get-WorkConfig
  $kept = @($config.ignores | Where-Object { -not ($_.kind -eq $Kind -and [string]$_.id -eq $Id) })
  $entry = [ordered]@{ kind = $Kind; id = $Id; note = $Note; addedOn = (Get-Date).ToString('yyyy-MM-dd') }
  if ($Until -match '^\d{4}-\d{2}-\d{2}$') { $entry.until = $Until }
  $config.ignores = @($kept) + @([pscustomobject]$entry)
  return Save-WorkConfig $config
}

function Remove-WorkIgnore([string]$Kind, [string]$Id) {
  $config = Get-WorkConfig
  $config.ignores = @($config.ignores | Where-Object { -not ($_.kind -eq $Kind -and [string]$_.id -eq $Id) })
  return Save-WorkConfig $config
}

function Invoke-VibesQuery([string]$Sql, [hashtable]$Parameters = @{}) {
  $connection = [Data.SqlClient.SqlConnection]::new("Server=$SqlServer;Database=$SqlDatabase;Integrated Security=SSPI;TrustServerCertificate=True;Connect Timeout=10;Application Name=my-brain work bridge")
  try {
    $connection.Open()
    $command = $connection.CreateCommand()
    $command.CommandText = $Sql
    $command.CommandTimeout = $QueryTimeoutSec
    foreach ($key in $Parameters.Keys) { [void]$command.Parameters.AddWithValue("@$key", $Parameters[$key]) }
    $reader = $command.ExecuteReader()
    $rows = [Collections.Generic.List[object]]::new()
    while ($reader.Read()) {
      $row = [ordered]@{}
      for ($i = 0; $i -lt $reader.FieldCount; $i++) {
        $value = $reader.GetValue($i)
        if ($value -is [DBNull]) { $value = $null }
        elseif ($value -is [datetime]) { $value = if ($value.TimeOfDay -eq [TimeSpan]::Zero) { $value.ToString('yyyy-MM-dd') } else { $value.ToString('yyyy-MM-ddTHH:mm:ss') } }
        elseif ($value -is [decimal]) { $value = [double]$value }
        $row[$reader.GetName($i)] = $value
      }
      $rows.Add([pscustomobject]$row)
    }
    $reader.Close()
    # Written to the pipeline unwrapped on purpose: callers collect with @(...), which keeps ConvertTo-Json from seeing a wrapped array.
    $rows.ToArray()
  } finally {
    $connection.Dispose()
  }
}

# Build an IN (...) list from numeric ids. Employee ids are varchar in most vibes views, so quote them.
function ConvertTo-SqlIdList([string[]]$Ids) {
  $clean = @($Ids | Where-Object { $_ -match '^\d+$' } | Select-Object -Unique)
  if (-not $clean.Count) { return "('-1')" }
  return '(' + (($clean | ForEach-Object { "'$_'" }) -join ',') + ')'
}

# Record ids travel as strings (FS DLGs look like Y206683); TLG lines use -1 for "none".
function ConvertTo-RecordId($Value) {
  $text = [string]$Value
  if ([string]::IsNullOrWhiteSpace($text) -or $text -eq '-1' -or $text -eq '0') { return $null }
  return $text
}

function ConvertTo-SqlNameList([string[]]$Names) {
  $clean = @($Names | Where-Object { $_ -and $_ -notmatch "['\x00-\x1f]" } | Select-Object -Unique)
  if (-not $clean.Count) { return "('')" }
  return '(' + (($clean | ForEach-Object { "'$_'" }) -join ',') + ')'
}

function Resolve-WorkMe($Config) {
  if ($Config.me -and [string]$Config.me -match '^\d+$') {
    $rows = @(Invoke-VibesQuery "SELECT EmployeeId, EmployeeName, TeamLeadId, TeamLeadName, GuruRoleName, GuruTeamName, IsTeamLeadYN FROM vibes.Employee WHERE EmployeeId = @Id" @{ Id = [int]$Config.me })
  } else {
    $rows = @(Invoke-VibesQuery "SELECT EmployeeId, EmployeeName, TeamLeadId, TeamLeadName, GuruRoleName, GuruTeamName, IsTeamLeadYN FROM vibes.Employee WHERE WindowsLogin = @Login AND ActiveYN = 'Y'" @{ Login = $env:USERNAME })
  }
  if (-not $rows.Count) { throw "no vibes.Employee row for $($env:USERNAME); set `"me`" in work-dashboard.json" }
  $row = $rows[0]
  [ordered]@{ id = [string]$row.EmployeeId; name = $row.EmployeeName; teamLeadId = [string]$row.TeamLeadId; teamLeadName = $row.TeamLeadName; role = $row.GuruRoleName; team = $row.GuruTeamName; level = 0 }
}

function Build-WorkSnapshot {
  $config = Get-WorkConfig
  $errors = [Collections.Generic.List[string]]::new()
  $started = Get-Date
  $me = Resolve-WorkMe $config
  $snapshot = [ordered]@{
    capturedAt = $started.ToString('o')
    source = [ordered]@{ server = $SqlServer; database = $SqlDatabase; schema = 'vibes'; note = 'track data refreshes nightly at 10pm central with dlg/qan passes at noon and 4pm' }
    me = $me
    team = @(); designReviews = @(); designs = @(); dlgs = @(); prjs = @(); qans = @(); qanSummary = @(); slgs = @(); outages = @(); activity = @()
    errors = @()
  }

  function Run([string]$Name, [scriptblock]$Query) {
    try { return @(& $Query) } catch { $errors.Add("${Name}: $($_.Exception.Message)"); return @() }
  }

  $snapshot.team = @(Run 'team' {
    Invoke-VibesQuery @"
SELECT t.EmployeeId AS id, t.EmployeeName AS name, t.RecursiveLevel AS level, CAST(e.TeamLeadId AS varchar(20)) AS teamLeadId, e.TeamLeadName AS teamLeadName, e.GuruRoleName AS role, e.GuruTeamName AS team
FROM vibes.TeamLeadRecursiveEmployees t
JOIN vibes.Employee e ON CAST(e.EmployeeId AS varchar(20)) = t.EmployeeId
WHERE t.TeamLeadId = @Me AND e.ActiveYN = 'Y' AND e.IsPersonYN = 'Y'
ORDER BY t.RecursiveLevel, t.EmployeeName
"@ @{ Me = $me.id }
  })
  $people = ConvertTo-SqlIdList (@($me.id) + @($snapshot.team | ForEach-Object { [string]$_.id }))
  $products = ConvertTo-SqlNameList $config.products

  $snapshot.designReviews = @(Run 'designReviews' {
    Invoke-VibesQuery @"
SELECT d.DesignId AS designId, d.DesignName AS name, CAST(r.ReviewerEmployeeId AS varchar(20)) AS reviewerId, CAST(d.DesignLeadEmployeeId AS varchar(20)) AS leadId, d.DesignLeadName AS leadName,
  d.DesignStatusName AS status, CASE WHEN r.ReviewerRequiredYN = 'Y' THEN 1 ELSE 0 END AS required, r.ReviewerPerspectiveName AS perspective,
  d.InReviewByDate AS inReviewBy, d.ApprovalByDate AS approvalBy, d.SubmissionDate AS submittedOn, d.LastUpdateDate AS lastUpdate, d.LastCommentDate AS lastComment,
  d.ActiveReviewers AS activeReviewers, d.TotalReviewers AS totalReviewers, d.RequiredReviewers AS requiredReviewers, d.EMC2ProductId AS productId, d.ProductAlias AS product
FROM vibes.DesignReview r
JOIN vibes.Design d ON d.DesignId = r.DesignId
WHERE r.ReviewerEmployeeId IN $people AND r.ReviewStatusName = 'No Decision' AND d.DesignStatusName IN ('In Review', 'Under Revision')
ORDER BY d.ApprovalByDate
"@
  })

  $snapshot.designs = @(Run 'designs' {
    Invoke-VibesQuery @"
SELECT d.DesignId AS id, d.DesignName AS name, d.DesignStatusName AS status, CAST(d.DesignLeadEmployeeId AS varchar(20)) AS leadId, d.DesignLeadName AS leadName, CAST(d.DesignCreatorEmployeeId AS varchar(20)) AS creatorId,
  d.CreationDate AS createdOn, d.SubmissionDate AS submittedOn, d.InReviewByDate AS inReviewBy, d.ApprovalByDate AS approvalBy, d.LastUpdateDate AS lastUpdate, d.LastCommentDate AS lastComment,
  d.TotalReviewers AS totalReviewers, d.ActiveReviewers AS activeReviewers, d.ProductAlias AS product,
  (SELECT COUNT(*) FROM vibes.DesignReview r WHERE r.DesignId = d.DesignId AND r.ReviewStatusName = 'No Decision') AS pendingReviewers,
  (SELECT COUNT(*) FROM vibes.DesignReview r WHERE r.DesignId = d.DesignId AND r.ReviewStatusName = 'No Decision' AND r.ReviewerRequiredYN = 'Y') AS pendingRequired,
  (SELECT COUNT(*) FROM vibes.DesignReview r WHERE r.DesignId = d.DesignId AND r.ReviewStatusName = 'Waiting for Changes') AS waitingForChanges
FROM vibes.Design d
WHERE (d.DesignLeadEmployeeId IN $people OR d.DesignCreatorEmployeeId IN $people) AND d.DesignStatusName <> 'Approved'
ORDER BY d.LastUpdateDate DESC
"@
  })

  $snapshot.dlgs = @(Run 'dlgs' {
    Invoke-VibesQuery @"
SELECT d.DLGId AS id, d.DLGName AS name, d.DLGLogStatusId AS statusId, d.DLGLogStatusName AS status, d.DLGLogTypeName AS type,
  d.DeveloperEmployeeId AS developerId, d.ResponsibleEmployeeId AS responsibleId, d.Responsible AS responsibleName, d.ResponsibleEmpRole AS responsibleRole,
  d.StageOnePQAEmployeeId AS pqa1Id, d.StageTwoPQAEmployeeId AS pqa2Id, d.StageOneQAEmployeeId AS qa1Id, d.StageTwoQAEmployeeId AS qa2Id, d.WriterEmployeeId AS writerId,
  d.DevCompDeadline AS devCompDeadline, d.StageOnePQADeadline AS pqa1Deadline, d.StageOneQADeadline AS qa1Deadline, d.StageTwoPQADeadline AS pqa2Deadline, d.StageTwoQADeadline AS qa2Deadline, d.CurrentDueDate AS currentDue,
  d.DaysInStatus AS daysInStatus, d.WorkDaysInStatus AS workDaysInStatus, d.LastBatonPass AS lastBatonPass, d.BatonPassesInCurrentStatus AS batonPassesInStatus, d.UnderDevDate AS underDevSince,
  d.IsSU AS isSu, d.BrokenWatchout AS brokenWatchout, d.HighPriOpenQAComments AS highPriOpenComments, d.VersionName AS version, d.ReleaseVersionName AS releaseVersion, d.EMC2ProductId AS productId, d.Paused AS paused, d.Action AS action,
  (SELECT STRING_AGG(CAST(b.PRJId AS varchar(20)), ',') FROM vibes.PRJToDLGs b WHERE b.DLGId = d.DLGId) AS prjIds
FROM vibes.DLG d
WHERE d.IsComplete = 0 AND (d.DeveloperEmployeeId IN $people OR d.ResponsibleEmployeeId IN $people OR d.StageOnePQAEmployeeId IN $people OR d.StageTwoPQAEmployeeId IN $people OR d.StageOneQAEmployeeId IN $people OR d.StageTwoQAEmployeeId IN $people)
ORDER BY d.DLGLogStatusId DESC, d.LastBatonPass DESC
"@
  })

  $snapshot.prjs = @(Run 'prjs' {
    # Gather candidate ids first; filtering vibes.PRJ through PRJToDLGs and PRJPointPeople in one statement times out.
    $linked = @($snapshot.dlgs | ForEach-Object { if ($_.prjIds) { [string]$_.prjIds -split ',' } })
    $pointed = @(Invoke-VibesQuery "SELECT DISTINCT CAST(pp.PRJId AS varchar(20)) AS id FROM vibes.PRJPointPeople pp WHERE pp.EmployeeId IN $people" | ForEach-Object { [string]$_.id })
    $prjIds = ConvertTo-SqlIdList ($linked + $pointed)
    Invoke-VibesQuery @"
SELECT p.PRJId AS id, p.PRJName AS name, p.PRJStatusName AS status, CASE WHEN p.ActiveInactivePRJ = 'Active PRJs' THEN 1 ELSE 0 END AS active, p.PRJTypeName AS type,
  p.OnTrackStatusName AS onTrack, p.OnTrackStatusSetDate AS onTrackSetOn, p.OnTrackStatusComment AS onTrackComment, p.OnTrackStatusOverdue AS onTrackOverdue, p.QAConfidenceName AS qaConfidence,
  p.TargetVersionName AS targetVersion, p.TargetReleaseVersionNum AS targetReleaseNum, p.CommittedVersionName AS committedVersion, p.LeadAppCommitLevelName AS commitLevel,
  CAST(p.OwnerEmployeeId AS varchar(20)) AS ownerId, CAST(p.QAOwnerEmployeeId AS varchar(20)) AS qaOwnerId,
  p.PlannedStartDate AS plannedStart, p.PlannedDevCompDate AS plannedDevComp, p.PlannedQA1Date AS plannedQa1, p.PlannedReadinessDate AS plannedReadiness, p.ReadinessDate AS readinessOn, p.DueDate AS dueOn,
  p.EstimatedHours AS estimatedHours, p.RemainingHours AS remainingHours, p.TLGHours AS loggedHours, p.OpenImportantIssues AS openImportantIssues, p.EMC2ProductName AS product,
  (SELECT STRING_AGG(CAST(pp.EmployeeId AS varchar(20)) + ':' + pp.PRJRoleName, ',') FROM vibes.PRJPointPeople pp WHERE pp.PRJId = p.PRJId) AS pointPeople,
  CASE WHEN EXISTS (SELECT 1 FROM vibes.PRJProjectList pl WHERE pl.PRJId = p.PRJId AND pl.IsBacklogYN = 'Y') THEN 1 ELSE 0 END AS onBacklog
FROM vibes.PRJ p
WHERE p.PRJId IN $prjIds
   OR (p.ActiveInactivePRJ = 'Active PRJs' AND (p.OwnerEmployeeId IN $people OR p.QAOwnerEmployeeId IN $people OR p.EMC2ProductName IN $products))
ORDER BY p.PRJName
"@
  })

  $snapshot.qans = @(Run 'qans' {
    Invoke-VibesQuery @"
SELECT q.QANId AS id, q.QANName AS name, q.QANStatusName AS status, q.FixPriorityId AS priorityId, q.FixPriorityName AS priority, q.QANNoteTypeName AS type,
  q.AssignedToFixEmployeeId AS fixerId, q.OwnerEmployeeId AS ownerId, q.AuthorEmployeeId AS authorId, q.WorkDaysInStatus AS workDaysInStatus, q.VersionNum AS version,
  q.EMC2ProductName AS product, q.FunctionalAreaName AS functionalArea, q.QANEntryDate AS enteredOn, q.FirstEscalatedDate AS escalatedOn, q.AffectsReleasedName AS affectsReleased
FROM vibes.QAN q
WHERE q.QANStatusName NOT LIKE 'Closed%' AND q.PassesStandardQANStatusFilterBit = 1
  AND (q.AssignedToFixEmployeeId IN $people OR (q.EMC2ProductName IN $products AND q.IncludedInStandardQANBit = 1 AND q.FixPriorityId IN (1, 2, 4)))
ORDER BY q.FixPriorityId, q.WorkDaysInStatus DESC
"@
  })

  $snapshot.qanSummary = @(Run 'qanSummary' {
    Invoke-VibesQuery @"
SELECT q.EMC2ProductName AS product, q.FixPriorityId AS priorityId, q.FixPriorityName AS priority, COUNT(DISTINCT q.QANId) AS openCount,
  COUNT(DISTINCT CASE WHEN q.FirstEscalatedDate IS NOT NULL THEN q.QANId END) AS escalated,
  COUNT(DISTINCT CASE WHEN q.WorkDaysInStatus > 30 THEN q.QANId END) AS stale
FROM vibes.QAN q
WHERE q.EMC2ProductName IN $products AND q.QANStatusName NOT LIKE 'Closed%' AND q.PassesStandardQANStatusFilterBit = 1 AND q.IncludedInStandardQANBit = 1
GROUP BY q.EMC2ProductName, q.FixPriorityId, q.FixPriorityName
ORDER BY q.EMC2ProductName, q.FixPriorityId
"@
  })

  $snapshot.slgs = @(Run 'slgs' {
    Invoke-VibesQuery @"
SELECT s.SLGId AS id, s.SLGTitle AS title, s.CustomerName AS customer, s.SLGStatusName AS status, s.SLGPriorityName AS priority, s.SLGTypeName AS type,
  CAST(s.AssignedToEmployeeId AS varchar(20)) AS assignedId, CAST(s.BatonHolderEmployeeId AS varchar(20)) AS batonId, s.LastEpicPostDate AS lastEpicPost, s.LastCustomerPostDate AS lastCustomerPost, s.CreatedDate AS createdOn
FROM vibes.SLG s
WHERE (s.AssignedToEmployeeId IN $people OR s.BatonHolderEmployeeId IN $people) AND s.SLGStatusName NOT LIKE 'Closed%' AND s.LastClosedDate IS NULL
ORDER BY s.LastCustomerPostDate DESC
"@
  })

  $snapshot.outages = @(Run 'outages' {
    Invoke-VibesQuery @"
SELECT o.EmployeeId AS employeeId, o.EmployeeName AS employeeName, o.EventTypeName AS type, o.EventStartDate AS startOn, o.EventEndDate AS endOn, o.IsOOO AS isOoo, o.Approved AS approved
FROM vibes.EmployeeOutage o
WHERE o.EmployeeId IN $people AND o.IsOOO = 1 AND o.EventEndDate >= CAST(GETDATE() AS date) AND o.EventStartDate <= DATEADD(day, 60, CAST(GETDATE() AS date))
ORDER BY o.EventStartDate
"@
  })

  $snapshot.activity = @(Run 'activity' {
    $ids = (@($me.id) + @($snapshot.team | ForEach-Object { [string]$_.id })) -join ','
    $rows = Invoke-VibesQuery "EXEC vibes.GetTLGData @StartDate = @Start, @EndDate = @End, @EmployeeIds = @Ids" @{
      Start = (Get-Date).AddDays(-$ActivityDays).ToString('yyyy-MM-dd'); End = (Get-Date).ToString('yyyy-MM-dd'); Ids = $ids
    }
    $grouped = @{}
    foreach ($row in $rows) {
      $key = "$($row.EmployeeId)|$($row.DLGId)|$($row.PRJId)|$($row.QANId)|$($row.SLGId)"
      if (-not $grouped.ContainsKey($key)) {
        $grouped[$key] = [ordered]@{
          employeeId = [string]$row.EmployeeId
          dlgId = ConvertTo-RecordId $row.DLGId
          prjId = ConvertTo-RecordId $row.PRJId
          qanId = ConvertTo-RecordId $row.QANId
          slgId = ConvertTo-RecordId $row.SLGId
          hours = 0.0
          lastOn = $null
          descriptions = [Collections.Generic.List[string]]::new()
        }
      }
      $entry = $grouped[$key]
      $entry.hours += [double]$row.LoggedHours
      $day = [string]$row.CalendarDate
      if (-not $entry.lastOn -or $day -gt $entry.lastOn) { $entry.lastOn = $day }
      if ($row.Description -and -not $entry.descriptions.Contains([string]$row.Description) -and $entry.descriptions.Count -lt 3) { $entry.descriptions.Add([string]$row.Description) }
    }
    $grouped.Values | ForEach-Object { $_.descriptions = @($_.descriptions); [pscustomobject]$_ }
  })

  $snapshot.errors = @($errors)
  $snapshot.durationMs = [int]((Get-Date) - $started).TotalMilliseconds
  if (-not (Test-Path -LiteralPath $script:workSystemDir)) { New-Item -ItemType Directory -Path $script:workSystemDir | Out-Null }
  $json = $snapshot | ConvertTo-Json -Depth 8 -Compress
  [IO.File]::WriteAllText($script:workSnapshotPath, $json, [Text.UTF8Encoding]::new($false))
  $script:workSnapshot = $json
  $script:workSnapshotBuiltAt = Get-Date
  foreach ($problem in $errors) { Write-Warning "work snapshot: $problem" }
  Write-Host "work snapshot: $($snapshot.dlgs.Count) dlgs, $($snapshot.designReviews.Count) reviews, $($snapshot.prjs.Count) prjs, $($snapshot.qans.Count) qans in $($snapshot.durationMs) ms"
  return $json
}

# Returns the snapshot json, rebuilding when missing or older than $SnapshotMaxAgeMin unless $Force is false and a stale copy is acceptable.
function Get-WorkSnapshotJson([bool]$Force = $false, [bool]$AllowStale = $false) {
  if (-not $Force -and $script:workSnapshot -and $script:workSnapshotBuiltAt -and ((Get-Date) - $script:workSnapshotBuiltAt).TotalMinutes -lt $SnapshotMaxAgeMin) { return $script:workSnapshot }
  if (-not $Force -and -not $script:workSnapshot -and (Test-Path -LiteralPath $script:workSnapshotPath)) {
    $script:workSnapshot = Get-Content -LiteralPath $script:workSnapshotPath -Raw -Encoding UTF8
    $script:workSnapshotBuiltAt = (Get-Item -LiteralPath $script:workSnapshotPath).LastWriteTime
    if (((Get-Date) - $script:workSnapshotBuiltAt).TotalMinutes -lt $SnapshotMaxAgeMin) { return $script:workSnapshot }
  }
  if ($AllowStale -and $script:workSnapshot) { return $script:workSnapshot }
  return Build-WorkSnapshot
}

function Test-WorkSnapshotStale {
  if ($script:workBuilding) { return $false }
  if (-not $script:workSnapshotBuiltAt) { return $true }
  return ((Get-Date) - $script:workSnapshotBuiltAt).TotalMinutes -ge $SnapshotMaxAgeMin
}
