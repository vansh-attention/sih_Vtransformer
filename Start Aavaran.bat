@echo off
setlocal enabledelayedexpansion
REM Delayed expansion is REQUIRED: cmd.exe expands %VAR% when it parses a block, so a
REM variable set by `set /p` inside an if-block reads as empty. The prompt below would
REM have taken every answer as "no", including "y".
REM Start Aavaran - double-click this file.
REM
REM It starts ollama and the reasoning server. It installs NOTHING without asking you
REM first, with the exact command it would run, the disk cost, and what still works if
REM you decline. The default answer is No.
REM
REM It is kept short enough to read before you trust it: this project's argument is that
REM you should not have to take our word for anything.
REM
REM Windows SmartScreen may warn the first time because this came from a download.
REM "More info" then "Run anyway" is the consent step for that.
cd /d "%~dp0"

REM -- 1. ollama ---------------------------------------------------------------
REM OFFERED, NEVER ASSUMED. Silently installing a background service is what we tell
REM people to be suspicious of; saying nothing and sending them away is not better,
REM because then they do not know what they are missing. State what it is for, state
REM exactly what will run, state what still works if they decline, default to No.
where ollama >nul 2>&1
if errorlevel 1 (
  echo.
  echo   ollama is not installed.
  echo.
  echo   WHAT IT IS FOR
  echo     Aavaran uses it to run the language model on your own machine, rather than
  echo     sending your screen to somebody's cloud. It is required for "Run on this
  echo     tab" - the agent that fills in a form for you.
  echo.
  echo   WHAT IT COSTS ON DISK
  echo     ollama itself      ~0.5 GB
  echo     the model          ~6.0 GB   ^(one download, kept, never fetched again^)
  echo     total              ~6.5 GB
  echo.
  echo   IF YOU SAY NO
  echo     "Scan this page" still works, needs nothing, and is the whole privacy
  echo     demonstration. Only the agent is unavailable.
  echo.
  echo     You can install it later - see INSTALL-OLLAMA.txt in this folder, which
  echo     also covers removing it again.
  echo.
  where winget >nul 2>&1
  if errorlevel 1 (
    echo   winget is not available, so this cannot do it for you.
    echo   Download the installer from https://ollama.com/download, then run this again.
    echo   Full instructions, sizes and removal: INSTALL-OLLAMA.txt in this folder.
    start "" "https://ollama.com/download"
    echo.
    pause
    exit /b 1
  )
  echo   IF YOU SAY YES, exactly this runs and nothing else:
  echo.
  echo       winget install Ollama.Ollama
  echo.
  set /p REPLY="  Install ollama now? [y/N] "
  if /i not "!REPLY!"=="y" (
    echo.
    echo   Not installing. Scan still works - load the extension and press Scan.
    echo   To install later, see INSTALL-OLLAMA.txt in this folder.
    echo.
    pause
    exit /b 0
  )
  echo   Running: winget install Ollama.Ollama
  winget install Ollama.Ollama
  where ollama >nul 2>&1
  if errorlevel 1 (
    echo   Install did not complete. Try https://ollama.com/download
    pause
    exit /b 1
  )
)

curl -s -m 2 http://127.0.0.1:11434/api/tags >nul 2>&1
if errorlevel 1 (
  echo   Starting ollama...
  start "" /b ollama serve
  timeout /t 6 /nobreak >nul
) else (
  echo   ollama is already running.
)

REM -- 2. the reasoning server -------------------------------------------------
REM setup.sh builds this venv. Without it there is nothing to run, and saying so beats
REM a Python traceback.
if not exist "server\.venv\Scripts\uvicorn.exe" (
  echo.
  echo   No Python environment yet. Run setup once, then run this again.
  echo.
  pause
  exit /b 1
)

curl -s -m 2 http://127.0.0.1:8975/health >nul 2>&1
if not errorlevel 1 (
  echo   The reasoning server is already running. Nothing to do.
  echo.
  pause
  exit /b 0
)

echo.
echo   Starting the reasoning server on http://127.0.0.1:8975
echo   Leave this window open while you use the extension. Ctrl-C stops it.
echo.
REM --app-dir instead of a cd: the command then depends on no working directory.
"server\.venv\Scripts\uvicorn.exe" main:app --port 8975 --app-dir server
