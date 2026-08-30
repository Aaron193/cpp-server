#!/usr/bin/env bash
# Start or stop the host-run local development stack.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$ROOT/.dev"
PID_DIR="$STATE_DIR/pids"
LOG_DIR="$STATE_DIR/logs"
COMPOSE=(docker compose -p cpp-server-dev -f "$ROOT/docker-compose.dev.yml")

usage() {
    cat <<'EOF'
Usage: ./scripts/dev.sh --start|--stop|--status

Starts PostgreSQL in Docker, then the Fastify API, C++ game server, and Vite
client on the host. Logs and PID files are kept in .dev/.

Optional environment overrides:
  DEV_DB_PORT (5432), DEV_WEB_PORT (3000), DEV_GAME_PORT (9001),
  DEV_CLIENT_PORT (5173), POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB,
  DEV_DATABASE_URL
EOF
}

load_configuration() {
    # A root .env is optional and is never modified by this script.
    if [[ -f "$ROOT/.env" ]]; then
        set -a
        # shellcheck disable=SC1091
        source "$ROOT/.env"
        set +a
    fi

    DEV_DB_PORT="${DEV_DB_PORT:-5432}"
    DEV_WEB_PORT="${DEV_WEB_PORT:-3000}"
    DEV_GAME_PORT="${DEV_GAME_PORT:-9001}"
    DEV_CLIENT_PORT="${DEV_CLIENT_PORT:-5173}"
    POSTGRES_USER="${POSTGRES_USER:-postgres}"
    POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres}"
    POSTGRES_DB="${POSTGRES_DB:-game_db}"
    SERVER_SHARED_SECRET="${SERVER_SHARED_SECRET:-local-development-shared-secret}"
    JOIN_TICKET_SECRET="${JOIN_TICKET_SECRET:-local-development-join-ticket-secret-12345}"
    JOIN_TICKET_AUDIENCE="${JOIN_TICKET_AUDIENCE:-arena-game-server}"
    JWT_SECRET="${JWT_SECRET:-local-development-jwt-secret-1234567890}"
    SERVER_BUILD_ROOT="${CPP_SERVER_BUILD_ROOT:-$ROOT/server/.build/3d}"

    local encoded_user encoded_password encoded_database
    encoded_user="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$POSTGRES_USER")"
    encoded_password="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$POSTGRES_PASSWORD")"
    encoded_database="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$POSTGRES_DB")"
    DEV_DATABASE_URL="${DEV_DATABASE_URL:-postgresql://${encoded_user}:${encoded_password}@127.0.0.1:${DEV_DB_PORT}/${encoded_database}}"
    export DEV_DB_PORT POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB SERVER_BUILD_ROOT
}

pid_file() { printf '%s/%s.pid\n' "$PID_DIR" "$1"; }
log_file() { printf '%s/%s.log\n' "$LOG_DIR" "$1"; }

service_running() {
    local pid_path pid
    pid_path="$(pid_file "$1")"
    [[ -f "$pid_path" ]] || return 1
    pid="$(<"$pid_path")"
    kill -0 "$pid" 2>/dev/null
}

remove_stale_pid() {
    local name="$1"
    if [[ -f "$(pid_file "$name")" ]] && ! service_running "$name"; then
        rm -f "$(pid_file "$name")"
    fi
}

require_commands() {
    local command
    for command in docker node npm curl setsid; do
        command -v "$command" >/dev/null 2>&1 || {
            echo "ERROR: '$command' is required for local development." >&2
            exit 1
        }
    done
    docker compose version >/dev/null 2>&1 || {
        echo "ERROR: Docker Compose is required for the local PostgreSQL database." >&2
        exit 1
    }
}

ensure_dependencies() {
    local directory
    for directory in "$ROOT/web" "$ROOT/client"; do
        if [[ ! -d "$directory/node_modules" ]]; then
            echo "Installing Node dependencies in ${directory#$ROOT/}..."
            (cd "$directory" && npm ci)
        fi
    done
}

start_managed() {
    local name="$1"
    local directory="$2"
    shift 2
    remove_stale_pid "$name"
    if service_running "$name"; then
        echo "$name is already running."
        return
    fi
    echo "Starting $name (log: ${LOG_DIR#$ROOT/}/$name.log)..."
    (
        cd "$directory"
        exec setsid "$@"
    ) >>"$(log_file "$name")" 2>&1 &
    echo "$!" >"$(pid_file "$name")"
}

wait_for_database() {
    local attempt
    for attempt in {1..30}; do
        if "${COMPOSE[@]}" exec -T db pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
            return
        fi
        sleep 1
    done
    echo "ERROR: PostgreSQL did not become ready. See: ${LOG_DIR#$ROOT/}" >&2
    exit 1
}

wait_for_web() {
    local attempt
    for attempt in {1..30}; do
        if curl --fail --silent "http://127.0.0.1:${DEV_WEB_PORT}/health" >/dev/null; then
            return
        fi
        if ! service_running web; then
            echo "ERROR: Web API exited; see $(log_file web)." >&2
            exit 1
        fi
        sleep 1
    done
    echo "ERROR: Web API did not become ready; see $(log_file web)." >&2
    exit 1
}

start_stack() {
    require_commands
    load_configuration
    mkdir -p "$PID_DIR" "$LOG_DIR"
    remove_stale_pid web
    remove_stale_pid game
    remove_stale_pid client

    if service_running web && service_running game && service_running client; then
        echo "Local development stack is already running."
        echo "Game: http://127.0.0.1:${DEV_CLIENT_PORT}"
        return
    fi
    if [[ -z "${VCPKG_ROOT:-}" || ! -f "${VCPKG_ROOT}/scripts/buildsystems/vcpkg.cmake" ]]; then
        echo "ERROR: Set VCPKG_ROOT to a bootstrapped vcpkg checkout before starting the game server." >&2
        exit 1
    fi

    ensure_dependencies
    echo "Starting local PostgreSQL..."
    "${COMPOSE[@]}" up -d db
    wait_for_database

    echo "Applying database migrations..."
    (cd "$ROOT/web" && env DATABASE_URL="$DEV_DATABASE_URL" npm run db:migrate)

    start_managed web "$ROOT/web" env \
        NODE_ENV=development PORT="$DEV_WEB_PORT" DATABASE_URL="$DEV_DATABASE_URL" \
        JWT_SECRET="$JWT_SECRET" SERVER_SHARED_SECRET="$SERVER_SHARED_SECRET" \
        JOIN_TICKET_SECRET="$JOIN_TICKET_SECRET" JOIN_TICKET_AUDIENCE="$JOIN_TICKET_AUDIENCE" \
        ALLOW_GUEST_JOINS=true CLIENT_ORIGIN="http://127.0.0.1:${DEV_CLIENT_PORT}" \
        npm run dev
    wait_for_web

    # Build without --run: build.sh loads server/.env only for --run, which
    # would otherwise override the launcher-managed local connection settings.
    echo "Building native game server..."
    (cd "$ROOT/server" && ./build.sh --release)
    start_managed game "$ROOT/server" env \
        SERVER_ID=server-1 SERVER_HOST=localhost SERVER_PORT="$DEV_GAME_PORT" SERVER_REGION=local \
        MAX_PLAYERS=12 SERVER_MODE=ffa SERVER_BUILD_ID=dev \
        SERVER_WEBSOCKET_URL="ws://127.0.0.1:${DEV_GAME_PORT}/" \
        GAME_CONFIG_PATH="$ROOT/server/game_config.json" \
        MAP_PACKAGE_DIR="$ROOT/client/public/maps/graybox-arena" \
        WEB_API_URL="http://127.0.0.1:${DEV_WEB_PORT}" SERVER_SHARED_SECRET="$SERVER_SHARED_SECRET" \
        JOIN_TICKET_SECRET="$JOIN_TICKET_SECRET" JOIN_TICKET_AUDIENCE="$JOIN_TICKET_AUDIENCE" \
        "$SERVER_BUILD_ROOT/release/server"

    start_managed client "$ROOT/client" env \
        VITE_CLIENT_API_BASE="http://127.0.0.1:${DEV_WEB_PORT}" \
        VITE_CLIENT_BUILD_ID=dev \
        npm run dev -- --host 127.0.0.1 --port "$DEV_CLIENT_PORT" --strictPort

    echo "Local development stack is starting."
    echo "Game: http://127.0.0.1:${DEV_CLIENT_PORT}"
    echo "Logs: $LOG_DIR"
}

stop_managed() {
    local name="$1" pid_path pid attempt
    pid_path="$(pid_file "$name")"
    remove_stale_pid "$name"
    [[ -f "$pid_path" ]] || { echo "$name is not running."; return; }
    pid="$(<"$pid_path")"
    echo "Stopping $name..."
    kill -- -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
    for attempt in {1..10}; do
        service_running "$name" || break
        sleep 1
    done
    if service_running "$name"; then
        kill -KILL -- -"$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
    fi
    rm -f "$pid_path"
}

stop_stack() {
    load_configuration
    mkdir -p "$PID_DIR"
    stop_managed client
    stop_managed game
    stop_managed web
    echo "Stopping local PostgreSQL (data volume is preserved)..."
    "${COMPOSE[@]}" stop db
}

status_stack() {
    load_configuration
    local name
    for name in web game client; do
        if service_running "$name"; then echo "$name: running"; else echo "$name: stopped"; fi
    done
    "${COMPOSE[@]}" ps db
}

[[ $# -eq 1 ]] || { usage >&2; exit 2; }
case "$1" in
    --start) start_stack ;;
    --stop) stop_stack ;;
    --status) status_stack ;;
    --help|-h) usage ;;
    *) usage >&2; exit 2 ;;
esac
