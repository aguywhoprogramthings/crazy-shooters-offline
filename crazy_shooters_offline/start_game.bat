@echo off
title Crazy Shooters - Offline Launcher
cd /d "%~dp0"

echo =======================================================
echo          CRAZY SHOOTERS - OFFLINE EDITION
echo =======================================================
echo Starting local offline HTTP streaming server...

:: 1. Try launching with Node.js
where node >nul 2>nul
if %ERRORLEVEL% equ 0 (
    start "" /b node server.js
    goto server_started
)

:: 2. Try launching with system Python
where python >nul 2>nul
if %ERRORLEVEL% equ 0 (
    start "" /b python server.py
    goto server_started
)

:: 3. Try launching with explicit Python installation
if exist "%LOCALAPPDATA%\Python\pythoncore-3.14-64\python.exe" (
    start "" /b "%LOCALAPPDATA%\Python\pythoncore-3.14-64\python.exe" server.py
    goto server_started
)

echo [ERROR] Neither Node.js nor Python was found to run the local server.
echo Please install Node.js or Python, or run server.js / server.py manually.
pause
exit /b 1

:server_started
echo Waiting for server to initialize...
timeout /t 2 /nobreak >nul

set GAME_URL=http://127.0.0.1:8088/index.html

:: Launch directly in Chrome app mode if available
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

:: Launch in Edge app mode
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
    start "" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" --app="%GAME_URL%"
    goto done
)

:: Fallback to default browser
start "" "%GAME_URL%"

:done
echo Game launched successfully at %GAME_URL%!
echo You can close this console window or leave it open.
