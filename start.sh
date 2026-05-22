#!/usr/bin/env bash
# Spustí webovou aplikaci chess-pick.
# Otevři http://127.0.0.1:8000 v prohlížeči. Zastavit lze Ctrl+C.

set -e
cd "$(dirname "$0")"

if [ ! -x ".venv/bin/uvicorn" ]; then
  echo "[chess-pick] .venv neni vytvoreny. Spust:"
  echo "  python -m venv .venv"
  echo "  .venv/bin/pip install -r requirements-dev.txt"
  exit 1
fi

exec .venv/bin/uvicorn web.app:app --host 127.0.0.1 --port 8000
