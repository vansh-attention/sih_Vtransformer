@echo off
REM Start Aavaran - double-click this file.
REM
REM It STARTS things. It NEVER installs anything, and it is kept short enough that you
REM can read all of it before trusting it. That is deliberate: this project's argument
REM is that you should not have to take our word for anything, and a launcher you
REM cannot read is exactly what a careful person should refuse to run.
REM
REM Windows SmartScreen may warn the first time because this came from a download.
REM "More info" then "Run anyway" is the consent step for that.
cd /d "%~dp0"

REM -- 1. ollama ---------------------------------------------------------------
REM Not installed is a STOP, not something to fix silently. Installing a background
REM service on somebody's machine without asking is precisely what we tell people to
REM be suspicious of.
where ollama >nul 2>&1
if errorlevel 1 (
  echo.
  echo   ollama is not installed - it is the one piece you have to install yourself.
  echo   Opening https://ollama.com/download ; install it, then run this again.
  start "" "https://ollama.com/download"
  echo.
  pause
  exit /b 1
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
