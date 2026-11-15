#!/bin/bash
# Aimex Dispatch Server Launcher for macOS

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

# Ensure /usr/local/bin and /opt/homebrew/bin are in PATH
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
    echo "❌ Error: Node.js is not found in PATH."
    echo "Please install Node.js from https://nodejs.org/ or via Homebrew (brew install node)."
    exit 1
fi

echo "======================================================================"
echo "  📦 AIMEX AUSTRALIA — WAREHOUSE DISPATCH WEB APP (macOS)"
echo "======================================================================"
echo "Starting server on port 3000..."
echo "Opening http://localhost:3000 in your default browser..."
echo ""

# Open browser after 1 second in background
(sleep 1 && open "http://localhost:3000") &

# Start server
node server.js
