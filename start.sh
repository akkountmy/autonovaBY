#!/bin/sh
# Запуск сайта «Автонова с пробегом» на Linux/macOS.
#   PORT=8100 PUBLIC_BASE=https://autonova.by ./start.sh
set -e
cd "$(dirname "$0")"
export PORT="${PORT:-8100}"
export HOST="${HOST:-127.0.0.1}"
export PUBLIC_BASE="${PUBLIC_BASE:-http://127.0.0.1:$PORT}"
echo "Автонова с пробегом → $PUBLIC_BASE (${HOST}:${PORT})"
exec node server.mjs
