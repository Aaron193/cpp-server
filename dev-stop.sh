#!/bin/bash

# =============================================================================
# Stop Development Environment
# =============================================================================

echo "topping development environment..."

# Kill development processes
echo "   Stopping Node.js processes..."
pkill -f "tsx.*src/index.ts" 2>/dev/null || true
pkill -f "webpack.*serve" 2>/dev/null || true

echo "   Stopping game server..."
pkill -f "server/build/server" 2>/dev/null || true

# Stop database
echo "   Stopping database..."
docker compose down

echo ""
echo "Development environment stopped"
echo ""
