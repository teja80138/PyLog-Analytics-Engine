#!/usr/bin/env bash
# PyLog-Analytics-Engine: Local Execution Script

PORT="${PORT:-8080}"

# Auto-detect if port is already in use and find next free port
while lsof -Pi :${PORT} -sTCP:LISTEN -t >/dev/null 2>&1 ; do
    echo "[PyLog] Notice: Port ${PORT} is already in use, trying port $((PORT + 1))..."
    PORT=$((PORT + 1))
done

echo "=========================================================="
echo " PyLog Analytics Engine : Local WebAssembly Server"
echo " Serving at: http://localhost:${PORT}"
echo " Press Ctrl+C to terminate server."
echo "=========================================================="

# Attempt to open browser automatically on macOS
if command -v open &> /dev/null; then
    (sleep 1 && open "http://localhost:${PORT}") &
elif command -v xdg-open &> /dev/null; then
    (sleep 1 && xdg-open "http://localhost:${PORT}") &
fi

exec python3 -m http.server "${PORT}"
