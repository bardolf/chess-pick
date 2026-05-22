@echo off
REM Spustí webovou aplikaci chess-pick.
REM Otevři http://127.0.0.1:8000 v prohlížeči.
REM Zastavit lze Ctrl+C.

cd /d "%~dp0"

if not exist ".venv\Scripts\uvicorn.exe" (
  echo [chess-pick] .venv neni vytvoreny. Spust:
  echo   python -m venv .venv
  echo   .venv\Scripts\pip install -r requirements-dev.txt
  pause
  exit /b 1
)

.venv\Scripts\uvicorn web.app:app --host 127.0.0.1 --port 8000
pause
