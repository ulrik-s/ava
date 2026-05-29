# Installerar ava-helper som user-task i Windows Task Scheduler.
#
# Körs från katalogen där zip-paketet är uppackat (PowerShell):
#   .\service\install-windows.ps1

$ErrorActionPreference = "Stop"

$binDir = Join-Path $env:LOCALAPPDATA "AVA"
$logDir = Join-Path $env:LOCALAPPDATA "AVA\Logs"
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$binSource = Join-Path $scriptDir "..\ava-helper.exe"
if (-Not (Test-Path $binSource)) {
    $binSource = Join-Path $scriptDir "ava-helper.exe"
}
if (-Not (Test-Path $binSource)) {
    Write-Error "Hittade inte ava-helper.exe (letade i $binSource)"
    exit 1
}

$binTarget = Join-Path $binDir "ava-helper.exe"
Copy-Item -Force $binSource $binTarget

# Substituera CURRENT_USER i task-XML:n med faktisk användare
$xmlSource = Join-Path $scriptDir "ava-helper.windows.xml"
$xmlTarget = Join-Path $env:TEMP "ava-helper.task.xml"
(Get-Content -Raw $xmlSource) -replace "CURRENT_USER", "$env:USERDOMAIN\$env:USERNAME" |
    Set-Content -Encoding Unicode $xmlTarget

# Registrera task
schtasks /create /tn "AVA Helper" /xml $xmlTarget /f | Out-Null
schtasks /run /tn "AVA Helper" | Out-Null

Start-Sleep -Seconds 2
try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:48761/ping" -TimeoutSec 2 -UseBasicParsing
    Write-Host "✓ ava-helper installerat och kör"
    Write-Host $r.Content
} catch {
    Write-Host "⚠ ava-helper installerat men svarar inte än. Kolla loggar:"
    Write-Host "  $logDir\helper.log"
}
