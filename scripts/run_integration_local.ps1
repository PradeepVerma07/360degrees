<#
PowerShell helper: apply migration, start server, run mocha integration test, stop server
Usage:
  From repo root:
    powershell -ExecutionPolicy Bypass -File .\scripts\run_integration_local.ps1

Environment variables (optional):
  DB_HOST (default: 127.0.0.1)
  DB_PORT (default: 3306)
  DB_USER (default: root)
  DB_PASSWORD (default: root)
  DB_NAME (default: ci360_local)
  NODE_ENV (optional)

This script requires `mysql` client on PATH and Node.js installed.
#>

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $repoRoot

$dbHost = $env:DB_HOST; if (-not $dbHost) { $dbHost = '127.0.0.1' }
$dbPort = $env:DB_PORT; if (-not $dbPort) { $dbPort = '3306' }
$dbUser = $env:DB_USER; if (-not $dbUser) { $dbUser = 'root' }
$dbPass = $env:DB_PASSWORD; if (-not $dbPass) { $dbPass = 'root' }
$dbName = $env:DB_NAME; if (-not $dbName) { $dbName = 'ci360_local' }

Write-Host "DB host:$dbHost port:$dbPort user:$dbUser db:$dbName"

# Check mysql client
$mysqlExe = Get-Command mysql -ErrorAction SilentlyContinue
if (-not $mysqlExe) {
  Write-Error "`mysql` client not found in PATH. Install MySQL client or add it to PATH and retry."
  exit 2
}

# Create database
Write-Host "Creating database $dbName if not exists..."
$createCmd = "CREATE DATABASE IF NOT EXISTS `$dbName CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
if ($dbPass -ne '') {
  & mysql -h $dbHost -P $dbPort -u $dbUser -p$dbPass -e $createCmd
} else {
  & mysql -h $dbHost -P $dbPort -u $dbUser -e $createCmd
}

# Apply migration
$mig = "database/migrations/20260813_add_responsibility_key.sql"
if (-not (Test-Path $mig)) { Write-Error "Migration file $mig not found"; exit 2 }
Write-Host "Applying migration $mig..."
if ($dbPass -ne '') {
  & mysql -h $dbHost -P $dbPort -u $dbUser -p$dbPass $dbName < $mig
} else {
  & mysql -h $dbHost -P $dbPort -u $dbUser $dbName < $mig
}

# Install server deps if node_modules missing
Push-Location server
if (-not (Test-Path "node_modules")) {
  Write-Host "Installing server dependencies..."
  npm ci
}

# Start server
Write-Host "Starting server..."
$env:DB_HOST = $dbHost
$env:DB_PORT = $dbPort
$env:DB_USER = $dbUser
$env:DB_PASSWORD = $dbPass
$env:DB_NAME = $dbName
$proc = Start-Process -FilePath node -ArgumentList 'src/index.js' -PassThru -NoNewWindow
Write-Host "Server PID: $($proc.Id)"

# Wait for /api/health
$healthUrl = 'http://localhost:4000/api/health'
$maxAttempts = 40
for ($i=0; $i -lt $maxAttempts; $i++) {
  try {
    $r = Invoke-RestMethod -Uri $healthUrl -Method GET -UseBasicParsing -TimeoutSec 5
    if ($r.ok -eq $true) { Write-Host 'Server healthy'; break }
    Write-Host "Waiting for server... ($i)"
  } catch {
    Start-Sleep -Seconds 2
  }
  if ($i -eq $maxAttempts-1) { Write-Error 'Server did not become healthy in time'; Stop-Process -Id $proc.Id -Force; exit 3 }
}

# Run mocha integration test
Write-Host "Running mocha integration test..."
Pop-Location
Push-Location server
try {
  npm run test:integration:mocha
  $exitCode = $LASTEXITCODE
} catch {
  Write-Error "Mocha test failed: $_"
  $exitCode = 2
}

# Stop server
Write-Host "Stopping server PID $($proc.Id)..."
Stop-Process -Id $proc.Id -ErrorAction SilentlyContinue

if ($exitCode -ne 0) { exit $exitCode }
Write-Host 'Integration run complete.'
