#!/bin/bash
set -e

# =============================================================================
# Stop Production Deployment
# =============================================================================

echo "Stopping production services..."

docker compose down

echo ""
echo "All services stopped"
echo ""
echo "Useful commands:"
echo "   Start again:       ./deploy.sh"
echo "   Remove volumes:    docker compose down -v  (⚠️  WARNING: Deletes database!)"
echo "   View stopped:      docker compose ps -a"
echo ""
