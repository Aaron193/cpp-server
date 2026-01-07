#!/bin/bash
set -e

# =============================================================================
# Development Startup Script
# =============================================================================

echo "Starting development environment..."
echo ""

# Check if database is running
if docker ps | grep -q game-db; then
    echo "Database already running"
else
    echo "Starting database..."
    docker compose up -d db
    echo "Waiting for database to be ready..."
    sleep 5
fi

echo ""
echo "Development services ready!"
echo ""
echo "Next steps:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Open 3 separate terminals and run:"
echo ""
echo "  Terminal 1 - Web API (with hot reload):"
echo "    cd web && npm run dev"
echo ""
echo "  Terminal 2 - Client (with hot reload):"
echo "    cd client && npm run dev"
echo ""
echo "  Terminal 3 - Game Server:"
echo "    cd server && ./build.sh --debug --run"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Then visit: http://localhost:3001"
echo ""
echo "Tip: Use 'npm run dev' for web and client to get hot reloading!"
echo "For server changes, Ctrl+C and rerun: ./build.sh --debug --run"
echo ""
