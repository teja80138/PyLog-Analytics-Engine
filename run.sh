#!/usr/bin/env bash
# PyLog-Analytics-Engine: Local Execution Script

PORT="${PORT:-8080}"

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
