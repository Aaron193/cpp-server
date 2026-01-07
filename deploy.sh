#!/bin/bash
set -e

# =============================================================================
# Production Deployment Script
# =============================================================================

echo "Starting production deployment..."

# Check if .env exists
if [ ! -f .env ]; then
    echo "Error: .env file not found"
    echo "Please copy .env.example to .env and configure your environment variables:"
    echo "   cp .env.example .env"
    echo "   nano .env  # or use your preferred editor"
    exit 1
fi

# Source environment variables
set -a
source .env
set +a

# Validate critical environment variables
REQUIRED_VARS=(
    "POSTGRES_PASSWORD"
    "JWT_SECRET"
    "SERVER_SHARED_SECRET"
    "DATABASE_URL"
)

echo "Validating environment variables..."
for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var}" ]; then
        echo "Error: Required environment variable $var is not set"
        exit 1
    fi
    
    # Check for placeholder values
    if [[ "${!var}" == *"change_this"* ]]; then
        echo "Warning: $var still contains placeholder value 'change_this'"
        echo "   Please update this in your .env file for production security"
        exit 1
    fi
done

echo "✅ Environment validation passed"

# Build services
echo "Building Docker images..."
docker compose build --parallel

# Start services
echo "Starting services..."
docker compose up -d

# Wait for services to be healthy
echo "Waiting for services to be healthy..."
sleep 5

# Check service health
echo "Checking service health..."
services=("game-db" "game-web" "game-server" "game-client")
all_healthy=true

for service in "${services[@]}"; do
    if docker ps --filter "name=${service}" --filter "health=healthy" --format "{{.Names}}" | grep -q "${service}"; then
        echo "${service} is healthy"
    elif docker ps --filter "name=${service}" --format "{{.Names}}" | grep -q "${service}"; then
        echo "${service} is starting..."
    else
        echo "${service} is not running"
        all_healthy=false
    fi
done

# Display service status
echo ""
echo "Service Status:"
docker compose ps

echo ""
echo "Deployment complete!"
echo ""
echo "Service URLs:"
echo "   Client (Game):     http://localhost:${NGINX_PORT:-80}"
echo "   Web API:           http://localhost:${WEB_PORT:-3000}"
echo "   Game Server (WS):  ws://localhost:${SERVER_PORT:-9001}"
echo "   Database:          localhost:5432 (internal only)"
echo ""
echo "Useful commands:"
echo "   View logs:         docker compose logs -f"
echo "   Stop services:     docker compose down"
echo "   Restart service:   docker compose restart [service-name]"
echo "   View status:       docker compose ps"
echo ""

if [ "$all_healthy" = false ]; then
    echo "Some services are not healthy. Check logs with: docker compose logs"
    exit 1
fi
