#!/usr/bin/env bash
# Start all 3 services in separate Terminal tabs (macOS)
# Usage: ./dev.sh

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

osascript <<EOF
tell application "Terminal"
    activate
    do script "cd '$PROJECT_DIR/mbbank-api' && python3 -m uvicorn app.main:app --port 8000"
    delay 0.5
    do script "cd '$PROJECT_DIR' && source ~/.nvm/nvm.sh && nvm use 20 && npm start"
    delay 0.5
    do script "cd '$PROJECT_DIR/web' && source ~/.nvm/nvm.sh && nvm use 20 && npm run dev"
end tell
EOF

echo "✅ Taikhoantenhat — started 3 services in Terminal tabs"
echo "   - MBBank API:    http://localhost:8000"
echo "   - Backend API:   http://localhost:3000"
echo "   - Web frontend:  http://localhost:3001"
