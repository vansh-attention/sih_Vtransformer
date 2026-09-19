@echo off
setlocal enabledelayedexpansion
REM Delayed expansion is REQUIRED here for the same reason it is in Start Aavaran.bat:
REM cmd.exe expands %VAR% when it PARSES a block, so a variable set inside an if-block
REM reads as empty. The commit hashes below are set and read inside blocks.
REM Update Aavaran - double-click this file.
REM
REM It pulls the latest code, rebuilds the extension, and restarts the reasoning
REM server. You do not download anything from the releases page again.
REM
REM It installs nothing and it never touches your work: if you have local changes it
REM stops and says so rather than throwing them away.
REM
REM Windows SmartScreen may warn the first time because this came from a download.
REM "More info" then "Run anyway" is the consent step for that.
cd /d "%~dp0"

REM -- 0. is this a clone, or an unzipped copy? --------------------------------
REM An unzipped release has no git history, so there is nothing to pull. Telling
REM somebody with no repository to run git pull is the same defect as telling them to
REM cd into a server folder the zip never contained.
if not exist ".git" (
  echo.
  echo   This folder is a downloaded copy, not a clone, so there is nothing to update from.
  echo   To get automatic updates, clone the repository once instead:
  echo.
  echo       git clone https://github.com/AavaranAI/Aavaran.git
  echo       cd Aavaran
  echo.
  echo   Then load THAT folder in chrome://extensions, and run this file from inside it.
  echo   You need access to the repo - ask Harsh if github says not found.
  echo.
  pause
  exit /b 1
)

where git >nul 2>&1
if errorlevel 1 (
  echo   git is not installed. Get it from https://git-scm.com/download/win
  pause
  exit /b 1
)

REM -- 1. never destroy uncommitted work ---------------------------------------
git diff --quiet
if errorlevel 1 goto dirty
git diff --cached --quiet
if errorlevel 1 goto dirty
goto clean

:dirty
echo.
echo   You have uncommitted changes in this folder, so this is not going to pull over them.
echo.
git status --short
echo.
echo   Commit or stash them first, then run this again.
pause
exit /b 1

:clean
for /f %%i in ('git rev-parse HEAD') do set BEFORE=%%i

echo.
echo   Fetching...
git pull --ff-only
if errorlevel 1 (
  echo.
  echo   The pull did not fast-forward - your branch has diverged from the remote.
  echo   Sort that out by hand; this script will not guess which side you want.
  pause
  exit /b 1
)

for /f %%i in ('git rev-parse HEAD') do set AFTER=%%i

if "!BEFORE!"=="!AFTER!" (
  echo   Already up to date - nothing changed.
) else (
  echo.
  echo   Updated:
  git --no-pager log --oneline !BEFORE!..!AFTER!
)

REM -- 2. rebuild, every time --------------------------------------------------
REM NOT only when the pull moved. A previous run may have failed halfway, and a dist
REM older than its source is this project's most repeated bug rather than a rare one.
where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo   node is not installed, so the extension cannot be rebuilt.
  echo   Install it from https://nodejs.org, then run this again.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo.
  echo   Installing dependencies ^(first time only^)...
  call npm install --silent
)

echo.
echo   Rebuilding the extension...
call node build.mjs
if errorlevel 1 (
  echo   The build failed. Nothing was changed in Chrome - it is still running the last good build.
  pause
  exit /b 1
)

if exist "server\.venv\Scripts\pip.exe" (
  if exist "server\requirements.txt" (
    echo   Checking the server's Python packages...
    "server\.venv\Scripts\pip.exe" install -q -r server\requirements.txt
  )
)

REM -- 3. restart the server ---------------------------------------------------
REM The extension is reloaded by Chrome. The server is a process somebody started days
REM ago and it goes on serving the old code with no sign anything is wrong. That silent
REM mismatch is why /health reports a version and the panel compares it.
curl -s -m 2 http://127.0.0.1:8975/health >nul 2>&1
if not errorlevel 1 (
  echo   Stopping the old reasoning server...
  REM Match the window title the launcher would use rather than killing every python.
  taskkill /f /fi "WINDOWTITLE eq Aavaran server*" >nul 2>&1
  for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:"TCP.*:8975 .*LISTENING"') do taskkill /f /pid %%p >nul 2>&1
  timeout /t 2 /nobreak >nul
)

echo.
echo   ------------------------------------------------------------------
echo   ONE STEP LEFT, and Chrome will not do it for you:
echo.
echo       open  chrome://extensions
echo       press the reload arrow on the Aavaran card
echo.
echo   Chrome also picks it up on its own if you quit and reopen Chrome.
echo   ------------------------------------------------------------------
echo.

if not exist "server\.venv\Scripts\uvicorn.exe" (
  echo   No Python environment yet - run setup once if you want the agent.
  pause
  exit /b 0
)

echo   Starting the reasoning server on http://127.0.0.1:8975
echo   Leave this window open while you use the extension. Ctrl-C stops it.
echo.
title Aavaran server
"server\.venv\Scripts\uvicorn.exe" main:app --port 8975 --app-dir server
