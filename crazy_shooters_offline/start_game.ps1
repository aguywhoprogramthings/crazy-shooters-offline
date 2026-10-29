# Crazy Shooters - Offline PowerShell Launcher
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $ScriptDir

Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "         CRAZY SHOOTERS - OFFLINE EDITION              " -ForegroundColor Yellow
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "Starting local offline HTTP streaming server..." -ForegroundColor Green

$ServerProcess = $null

# 1. Try Node.js
if (Get-Command node -ErrorAction SilentlyContinue) {
    Write-Host "Booting server with Node.js..." -ForegroundColor Gray
    $ServerProcess = Start-Process node -ArgumentList "server.js" -WorkingDirectory $ScriptDir -WindowStyle Hidden -PassThru
}
# 2. Try Python
elseif (Get-Command python -ErrorAction SilentlyContinue) {
    Write-Host "Booting server with Python..." -ForegroundColor Gray
    $ServerProcess = Start-Process python -ArgumentList "server.py" -WorkingDirectory $ScriptDir -WindowStyle Hidden -PassThru
}
# 3. Explicit Python path
elseif (Test-Path "$env:LOCALAPPDATA\Python\pythoncore-3.14-64\python.exe") {
    Write-Host "Booting server with Python 3.14..." -ForegroundColor Gray
    $ServerProcess = Start-Process "$env:LOCALAPPDATA\Python\pythoncore-3.14-64\python.exe" -ArgumentList "server.py" -WorkingDirectory $ScriptDir -WindowStyle Hidden -PassThru
}
else {
    Write-Error "Neither Node.js nor Python was found. Please start server.js or server.py manually."
    Read-Host "Press Enter to exit"
    exit 1
}

Start-Sleep -Seconds 2

$GameUrl = "http://127.0.0.1:8088/index.html"

# Chrome paths
$ChromePaths = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)

$Launched = $false
foreach ($p in $ChromePaths) {
    if (Test-Path $p) {
        Write-Host "Opening game in Chrome App mode..." -ForegroundColor Cyan
        Start-Process $p -ArgumentList "--app=$GameUrl"
        $Launched = $true
        break
    }
}

if (-not $Launched) {
    $EdgePath = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
    if (Test-Path $EdgePath) {
        Write-Host "Opening game in Edge App mode..." -ForegroundColor Cyan
        Start-Process $EdgePath -ArgumentList "--app=$GameUrl"
        $Launched = $true
    }
}

if (-not $Launched) {
    Write-Host "Opening game in default web browser..." -ForegroundColor Cyan
    Start-Process $GameUrl
}

Write-Host "Game successfully launched at $GameUrl (Server PID: $($ServerProcess.Id))" -ForegroundColor Green
