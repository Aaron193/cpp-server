#!/usr/bin/env bash

# Simple API test script
# Prerequisites: curl, jq (optional for JSON formatting)

set -e

BASE_URL="${BASE_URL:-http://localhost:3000}"
SERVER_SECRET="${SERVER_SECRET:-your_server_shared_secret}"

echo "Testing Game Control Plane API"
echo "Base URL: $BASE_URL"
echo "================================"
echo ""

# Test health endpoint
echo "1. Testing health endpoint..."
curl -s "$BASE_URL/health" | (command -v jq >/dev/null 2>&1 && jq . || cat)
echo ""
echo ""

# Register a user
echo "2. Registering a test user..."
REGISTER_RESPONSE=$(curl -s -c /tmp/cookies.txt -X POST "$BASE_URL/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser_'$(date +%s)'",
    "email": "test'$(date +%s)'@example.com",
    "password": "securepass123"
  }')
echo "$REGISTER_RESPONSE" | (command -v jq >/dev/null 2>&1 && jq . || cat)
echo ""
echo ""

# Get current user
echo "3. Getting current user (authenticated)..."
curl -s -b /tmp/cookies.txt "$BASE_URL/auth/me" | (command -v jq >/dev/null 2>&1 && jq . || cat)
echo ""
echo ""

# Logout
echo "4. Logging out..."
curl -s -b /tmp/cookies.txt -X POST "$BASE_URL/auth/logout" | (command -v jq >/dev/null 2>&1 && jq . || cat)
echo ""
echo ""

# Login
echo "5. Logging in with credentials..."
USERNAME=$(echo "$REGISTER_RESPONSE" | (command -v jq >/dev/null 2>&1 && jq -r '.user.username' || echo "testuser"))
curl -s -c /tmp/cookies.txt -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "usernameOrEmail": "'$USERNAME'",
    "password": "securepass123"
  }' | (command -v jq >/dev/null 2>&1 && jq . || cat)
echo ""
echo ""

# Register a game server
echo "6. Registering a game server..."
curl -s -X POST "$BASE_URL/servers/register" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SERVER_SECRET" \
  -d '{
    "id": "test-server-'$(date +%s)'",
    "host": "127.0.0.1",
    "port": 7777,
    "region": "us-east",
    "maxPlayers": 50
  }' | (command -v jq >/dev/null 2>&1 && jq . || cat)
echo ""
echo ""

# Send heartbeat
echo "7. Sending server heartbeat..."
SERVER_ID="test-server-$(date +%s)"
curl -s -X POST "$BASE_URL/servers/heartbeat" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SERVER_SECRET" \
  -d '{
    "id": "'$SERVER_ID'",
    "currentPlayers": 12
  }' | (command -v jq >/dev/null 2>&1 && jq . || cat)
echo ""
echo ""

# Get server list
echo "8. Getting server list..."
curl -s "$BASE_URL/servers" | (command -v jq >/dev/null 2>&1 && jq . || cat)
echo ""
echo ""

# Clean up
rm -f /tmp/cookies.txt

echo "================================"
echo "All tests completed!"
