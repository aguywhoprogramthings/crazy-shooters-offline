@echo off
setlocal
title Crazy Shooters - Offline Launcher
cd /d "%~dp0"

echo =======================================================
echo          CRAZY SHOOTERS - OFFLINE EDITION
echo =======================================================
echo Starting the server for this copy of the game...

:: Do not open port 8088 blindly: it may belong to an older copy. The server
:: writes its actual port and PID to a unique file only after it is listening.
set "HOST=127.0.0.1"
set "CSO_PORT_FILE=%TEMP%\crazy-shooters-%RANDOM%-%RANDOM%.ready"
set "SERVER_LOG=%CSO_PORT_FILE%.log"
if exist "%CSO_PORT_FILE%" del /q "%CSO_PORT_FILE%" >nul 2>nul

where node >nul 2>nul
if not errorlevel 1 (
    start "" /b node server.js >"%SERVER_LOG%" 2>&1
    goto server_started
)

where python >nul 2>nul
if not errorlevel 1 (
    start "" /b python server.py >"%SERVER_LOG%" 2>&1
    goto server_started
)

if exist "%LOCALAPPDATA%\Python\pythoncore-3.14-64\python.exe" (
    start "" /b "%LOCALAPPDATA%\Python\pythoncore-3.14-64\python.exe" server.py >"%SERVER_LOG%" 2>&1
    goto server_started
)

echo [ERROR] Neither Node.js nor Python was found to run the local server.
echo Please install Node.js or Python, or run server.js / server.py manually.
if not "%CSO_NO_BROWSER%"=="1" pause
exit /b 1

:server_started
echo Waiting for the server to be ready...
for /L %%N in (1,1,30) do (
    if exist "%CSO_PORT_FILE%" goto server_ready
    ping -n 2 -w 1000 127.0.0.1 >nul
)
echo [ERROR] The server did not become ready. The game was not opened.
if exist "%SERVER_LOG%" type "%SERVER_LOG%"
if not "%CSO_NO_BROWSER%"=="1" pause
exit /b 1

:server_ready
set "GAME_PORT="
set "GAME_PID="
for /f "usebackq tokens=1,2 delims=," %%A in ("%CSO_PORT_FILE%") do (
    set "GAME_PORT=%%A"
    set "GAME_PID=%%B"
)
del /q "%CSO_PORT_FILE%" >nul 2>nul
if not defined GAME_PORT goto invalid_ready
if not defined GAME_PID goto invalid_ready
for /f "delims=0123456789" %%A in ("%GAME_PORT%%GAME_PID%") do goto invalid_ready

set "GAME_URL=http://127.0.0.1:%GAME_PORT%/index.html"
echo Server ready: port %GAME_PORT%, PID %GAME_PID%.
echo Server log: %SERVER_LOG%
if "%CSO_NO_BROWSER%"=="1" goto done

:: Launch directly in Chrome app mode if available.
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
    start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" --app="%GAME_URL%"
    goto done
)
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
    start "" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" --app="%GAME_URL%"
    goto done
)
if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" (
    start "" "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" --app="%GAME_URL%"
    goto done
)

if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
    start "" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" --app="%GAME_URL%"
    goto done
)
start "" "%GAME_URL%"

:done
echo Game URL: %GAME_URL%
if not "%CSO_NO_BROWSER%"=="1" echo Keep this console window open while playing.
exit /b 0

:invalid_ready
echo [ERROR] The server returned invalid startup information. The game was not opened.
if not "%CSO_NO_BROWSER%"=="1" pause
exit /b 1
