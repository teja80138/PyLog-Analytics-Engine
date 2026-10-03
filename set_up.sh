#!/usr/bin/env bash
# PyLog-Analytics-Engine: Environment Setup Script

set -e

echo "[PyLog Setup] Checking Python 3 installation..."
if ! command -v python3 &> /dev/null; then
    echo "[PyLog Setup] Error: python3 is not installed or not in PATH."
    exit 1
fi

PYTHON_VERSION=$(python3 --version 2>&1)
echo "[PyLog Setup] Detected: ${PYTHON_VERSION}"

# Check or install pytest
echo "[PyLog Setup] Verifying pytest installation..."
if ! python3 -m pytest --version &> /dev/null; then
    echo "[PyLog Setup] Installing pytest for test runner..."
    python3 -m pip install --user --break-system-packages pytest || pip install pytest
fi

echo "[PyLog Setup] Running test suite to verify pipeline..."
python3 -m pytest tests/ -v

echo ""
echo "[PyLog Setup] Setup completed successfully."
echo "[PyLog Setup] You can now start the application with: ./run.sh"
