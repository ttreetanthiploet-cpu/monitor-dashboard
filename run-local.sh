#!/usr/bin/env bash
set -e
PORT=${1:-3000}
if command -v python3 >/dev/null 2>&1; then
  echo "Starting python http.server on port $PORT"
  python3 -m http.server "$PORT"
elif command -v npx >/dev/null 2>&1; then
  echo "Starting npx serve on port $PORT"
  npx serve -s . -l $PORT
else
  echo "Install Python 3 or Node (npx) to run local server"
  exit 1
fi
