# Test script: fetch productivity meta and post a sample job including responsibilityKey
$base = $env:CI360_API_URL
if (-not $base) { $base = 'http://localhost:4000' }
Write-Host "Using API base: $base"
try {
  $meta = Invoke-RestMethod -Uri "$base/api/productivity/meta" -Method Get -UseBasicParsing
} catch {
  Write-Error "Failed to fetch meta: $_"
  exit 1
}
if (-not $meta.clients -or $meta.clients.Count -eq 0) { Write-Error "No clients available in meta; cannot continue."; exit 1 }
if (-not $meta.services -or $meta.services.Count -eq 0) { Write-Error "No services available in meta; cannot continue."; exit 1 }
if (-not $meta.employees -or $meta.employees.Count -eq 0) { Write-Error "No employees available in meta; cannot continue."; exit 1 }
$clientId = $meta.clients[0].id
$serviceId = $meta.services[0].id
$employees = $meta.employees | Select-Object -First 2
$resps = $meta.responsibilities

$assignments = @()
if ($employees.Count -eq 1) {
  $assignments += @{ userId = $employees[0].id; revenuePercent = 100; hoursSpent = 2; responsibilityKey = $resps[0].key }
} else {
  $assignments += @{ userId = $employees[0].id; revenuePercent = 60; hoursSpent = 3; responsibilityKey = $resps[0].key }
  $assignments += @{ userId = $employees[1].id; revenuePercent = 40; hoursSpent = 2; responsibilityKey = ($resps[1].key) }
}
$body = @{
  clientId = $clientId
  startDate = (Get-Date).ToString('yyyy-MM-dd')
  valueAmount = 1000
  description = 'Integration test job with role'
  serviceIds = @($serviceId)
  assignments = $assignments
}
$json = $body | ConvertTo-Json -Depth 5
Write-Host "Posting payload: $json"
try {
  $resp = Invoke-RestMethod -Uri "$base/api/productivity/jobs" -Method Post -Body $json -ContentType 'application/json' -UseBasicParsing
  Write-Host "Response:`n" ($resp | ConvertTo-Json -Depth 5)
} catch {
  Write-Error "POST failed: $_"
  if ($_.Exception.Response) { $_.Exception.Response.GetResponseStream() | 
    ForEach-Object { $r = New-Object System.IO.StreamReader($_); Write-Error $r.ReadToEnd() } }
  exit 1
}
