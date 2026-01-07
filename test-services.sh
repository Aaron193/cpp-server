#!/bin/bash

# =============================================================================
# Service Testing Script
# =============================================================================

echo "Testing all services..."
echo ""

# Test Client (Nginx)
echo "Testing Client (Nginx)..."
if curl -s -I http://localhost/ | grep -q "200 OK"; then
    echo "   Client homepage: OK"
else
    echo "   Client homepage: FAILED"
fi

if curl -s -I http://localhost/assets/styles/style.css | grep -q "200 OK"; then
    echo "   CSS file: OK"
else
    echo "   CSS file: FAILED"
fi

if curl -s -I http://localhost/assets/img/rock.png | grep -q "200 OK"; then
    echo "   Image files: OK"
else
    echo "   Image files: FAILED"
fi

echo ""

# Test Web API
echo "Testing Web API..."
if curl -s http://localhost:3000/health | grep -q "ok"; then
    echo "   Health endpoint: OK"
else
    echo "   Health endpoint: FAILED"
fi

# Test CORS
if curl -s -I -H "Origin: http://localhost" http://localhost:3000/auth/me | grep -q "access-control-allow-origin"; then
    echo "   CORS headers: OK"
else
    echo "   CORS headers: FAILED"
fi

echo ""

# Test Database
echo "Testing Database..."
if docker compose exec -T db pg_isready -U postgres > /dev/null 2>&1; then
    echo "   Database connection: OK"
else
    echo "   Database connection: FAILED"
fi

echo ""

# Test Game Server
echo "Testing Game Server..."
if timeout 2 bash -c "</dev/tcp/localhost/9001" 2>/dev/null; then
    echo "   WebSocket port open: OK"
else
    echo "   WebSocket port open: FAILED"
fi

echo ""

# Service Status
echo "Service Status:"
docker compose ps

echo ""
echo "Testing complete!"
echo ""
echo "Next steps:"
echo "   1. Visit http://localhost in your browser"
echo "   2. Check browser console for any remaining errors"
echo "   3. Try logging in or registering"
echo "   4. Check game server connection"
