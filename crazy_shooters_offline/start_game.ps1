# Crazy Shooters - Online and Offline PowerShell Launcher
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $ScriptDir

Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "         CRAZY SHOOTERS - ONLINE AND OFFLINE            " -ForegroundColor Yellow
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "Starting the server for this copy of the game..." -ForegroundColor Green

$ServerProcess = $null
$ReadyFile = Join-Path ([IO.Path]::GetTempPath()) ("crazy-shooters-" + [Guid]::NewGuid() + ".ready")
$ServerLog = "$ReadyFile.log"
$ServerErrorLog = "$ReadyFile.err.log"
$PreviousHost = $env:HOST
$PreviousReadyFile = $env:CSO_PORT_FILE
$env:HOST = '127.0.0.1'
$env:CSO_PORT_FILE = $ReadyFile

try {
    if (Get-Command node -ErrorAction SilentlyContinue) {
        $Executable = 'node'
        $ServerScript = 'server.js'
    }
    elseif (Get-Command python -ErrorAction SilentlyContinue) {
        $Executable = 'python'
        $ServerScript = 'server.py'
    }
    elseif (Test-Path "$env:LOCALAPPDATA\Python\pythoncore-3.14-64\python.exe") {
        $Executable = "$env:LOCALAPPDATA\Python\pythoncore-3.14-64\python.exe"
        $ServerScript = 'server.py'
    }
    else {
        throw 'Neither Node.js nor Python was found. Please install one or start the server manually.'
    }

    $ServerProcess = Start-Process $Executable -ArgumentList $ServerScript -WorkingDirectory $ScriptDir `
        -WindowStyle Hidden -RedirectStandardOutput $ServerLog -RedirectStandardError $ServerErrorLog -PassThru
}
catch {
    Write-Host "[ERROR] Could not start the server: $_" -ForegroundColor Red
    if ($env:CSO_NO_BROWSER -ne '1') { Read-Host 'Press Enter to exit' }
    exit 1
}
finally {
    # The child inherited its own environment; do not change the caller's.
    $env:HOST = $PreviousHost
    $env:CSO_PORT_FILE = $PreviousReadyFile
}

try {
    # The default port may already belong to an older installation. Wait for
    # the new process to publish the port it actually bound to instead.
    $Deadline = (Get-Date).AddSeconds(30)
    while (-not (Test-Path $ReadyFile)) {
        $ServerProcess.Refresh()
        if ($ServerProcess.HasExited) { throw 'The server exited before it was ready.' }
        if ((Get-Date) -ge $Deadline) { throw 'The server did not become ready within 30 seconds.' }
        Start-Sleep -Milliseconds 250
    }
    $ReadyInfo = (Get-Content -Raw -LiteralPath $ReadyFile).Trim()
    if ($ReadyInfo -notmatch '^(\d{1,5}),(\d+)$') { throw 'Invalid server startup information.' }
    $GamePort = [int]$Matches[1]
    $GamePid = [int]$Matches[2]
    if ($GamePort -lt 1 -or $GamePort -gt 65535 -or $GamePid -lt 1) { throw 'Invalid server startup information.' }
}
catch {
    Write-Host "[ERROR] $($_.Exception.Message) The game was not opened." -ForegroundColor Red
    if (Test-Path $ServerLog) { Get-Content $ServerLog }
    if (Test-Path $ServerErrorLog) { Get-Content $ServerErrorLog }
    if ($ServerProcess -and -not $ServerProcess.HasExited) { $ServerProcess.Kill() }
    if ($env:CSO_NO_BROWSER -ne '1') { Read-Host 'Press Enter to exit' }
    exit 1
}
finally {
    Remove-Item -LiteralPath $ReadyFile -Force -ErrorAction SilentlyContinue
}

$GameUrl = "http://127.0.0.1:$GamePort/index.html"
Write-Host "Server ready: port $GamePort, PID $GamePid." -ForegroundColor Green
Write-Host "Server logs: $ServerLog and $ServerErrorLog" -ForegroundColor Gray

# Used by automated launcher tests; it still starts the real server.
if ($env:CSO_NO_BROWSER -eq '1') {
    Write-Host "Game URL: $GameUrl"
    exit 0
}

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
    Write-Host "Opening game in the default web browser..." -ForegroundColor Cyan
    Start-Process $GameUrl
}

Write-Host "Game URL: $GameUrl" -ForegroundColor Green
