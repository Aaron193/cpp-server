#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
env_file=""

usage() {
    echo "Usage: $0 [--env-file PATH]" >&2
}

while (($#)); do
    case "$1" in
        --env-file)
            [[ $# -ge 2 ]] || { usage; exit 2; }
            env_file="$2"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            usage
            exit 2
            ;;
    esac
done

failures=0

fail() {
    echo "FAIL: $*" >&2
    failures=$((failures + 1))
}

pass() {
    echo "PASS: $*"
}

require_file() {
    local path="$1"
    if [[ -f "${repo_root}/${path}" ]]; then
        pass "${path} exists"
    else
        fail "missing ${path}"
    fi
}

require_pattern() {
    local path="$1"
    local pattern="$2"
    local description="$3"
    if grep -Eq -- "$pattern" "${repo_root}/${path}"; then
        pass "$description"
    else
        fail "$description"
    fi
}

reject_pattern() {
    local path="$1"
    local pattern="$2"
    local description="$3"
    if grep -Eq -- "$pattern" "${repo_root}/${path}"; then
        fail "$description"
    else
        pass "$description"
    fi
}

for path in \
    Dockerfile.client Dockerfile.server Dockerfile.web docker-compose.yml \
    nginx.conf server/game_config.json protocol/schema.json \
    client/public/maps/graybox-arena/manifest.json \
    client/public/maps/graybox-arena/scene.glb \
    client/public/maps/graybox-arena/collision.bin \
    client/public/maps/copper-yard/manifest.json \
    client/public/maps/copper-yard/scene.glb \
    client/public/maps/copper-yard/collision.bin; do
    require_file "$path"
done

require_pattern Dockerfile.server '^ARG VCPKG_COMMIT=[0-9a-f]{40}$' \
    "vcpkg registry is pinned to an exact commit"
require_pattern Dockerfile.server '-DSERVER_ENABLE_JOLT=ON' \
    "native server image explicitly enables Jolt"
require_pattern Dockerfile.server 'COPY --from=builder /build/game_config.json ./game_config.json' \
    "server image includes game_config.json"
require_pattern Dockerfile.server 'COPY client/public/maps ./maps' \
    "server image includes all authored map packages"
require_pattern Dockerfile.server 'GAME_CONFIG_PATH=/app/game_config.json' \
    "server selects /app/game_config.json"
require_pattern Dockerfile.server 'MAP_PACKAGE_ROOT=/app/maps' \
    "server selects maps from the packaged map root"
require_pattern Dockerfile.server '^USER gameserver$' \
    "server runtime is non-root"
require_pattern Dockerfile.server '^HEALTHCHECK ' \
    "server image defines a healthcheck"
require_pattern Dockerfile.server '"curl".*"--fail".*127\.0\.0\.1' \
    "server healthcheck probes its HTTP listener"

require_pattern nginx.conf 'default_type application/wasm;' \
    "WASM is served as application/wasm"
require_pattern nginx.conf '^[[:space:]]*gzip on;' \
    "gzip delivery is enabled"
reject_pattern nginx.conf '^[[:space:]]*brotli(_[a-z]+)?[[:space:]]+on;' \
    "Brotli is not enabled on the stock image"
require_pattern nginx.conf 'public, max-age=31536000, immutable' \
    "hashed Vite assets receive immutable caching"
require_pattern nginx.conf 'assets/.+\{8,\}.*public, max-age=31536000, immutable|assets/.+\{8,\}' \
    "immutable caching is keyed by a Vite-style filename hash"
reject_pattern nginx.conf '^[[:space:]]*expires[[:space:]]+1y;' \
    "unhashed extensions do not receive blanket one-year caching"
require_pattern nginx.conf '=\/index\.html "no-store"' \
    "index.html is never cached"
require_pattern nginx.conf 'default "no-cache";' \
    "manifests, discovery, and unhashed files revalidate by default"
require_pattern nginx.conf '^([[:space:]]*)location /assets/' \
    "Vite assets have a dedicated location"
require_pattern nginx.conf 'try_files \$uri =404;' \
    "missing file-like assets return 404"
require_pattern nginx.conf 'Content-Security-Policy.*wasm-unsafe-eval.*wss:' \
    "CSP permits WASM and secure WebSocket connections"
require_pattern nginx.conf 'location /game/' \
    "secure public WebSocket path is proxied"
require_pattern nginx.conf 'proxy_pass http://gameserver:9001;' \
    "WebSocket path targets the private native server"
require_pattern nginx.conf 'proxy_set_header Upgrade \$http_upgrade;' \
    "WebSocket Upgrade is preserved"
require_pattern nginx.conf 'proxy_read_timeout 75s;' \
    "WebSocket proxy has an idle timeout"

require_pattern docker-compose.yml 'SERVER_BUILD_ID:.*\?SERVER_BUILD_ID is required' \
    "Compose requires a shared server/client build ID"
require_pattern docker-compose.yml 'SERVER_PROTOCOL_VERSION: "8"' \
    "Compose supplies protocol v8"
require_pattern docker-compose.yml 'JOIN_TICKET_SECRET:.*\?JOIN_TICKET_SECRET is required' \
    "Compose requires the shared join-ticket signing secret"
require_pattern docker-compose.yml 'SERVER_MAP_ID:.*\$\{SERVER_MAP_ID:-graybox-arena\}' \
    "Compose supplies an overridable production map ID"
require_pattern docker-compose.yml 'SERVER_WEBSOCKET_URL:.*\?Set the complete externally reachable wss URL' \
    "Compose requires the externally supplied WebSocket URL"
require_pattern docker-compose.yml 'GAME_CONFIG_PATH: /app/game_config.json' \
    "Compose selects the packaged game configuration"
require_pattern docker-compose.yml 'condition: service_healthy' \
    "Compose startup uses health dependencies"
require_pattern docker-compose.yml 'CLIENT_BUILD_ID:.*\?SERVER_BUILD_ID is required' \
    "Vite client embeds the same required build ID"

db_block="$(sed -n '/^  db:/,/^  web:/p' "${repo_root}/docker-compose.yml")"
if grep -Eq '^[[:space:]]+ports:' <<<"$db_block"; then
    fail "Postgres must not publish a host port by default"
else
    pass "Postgres is private to the Compose network"
fi

web_block="$(sed -n '/^  web:/,/^  gameserver:/p' "${repo_root}/docker-compose.yml")"
game_block="$(sed -n '/^  gameserver:/,/^  client:/p' "${repo_root}/docker-compose.yml")"
if grep -Eq '^[[:space:]]+ports:' <<<"${web_block}${game_block}"; then
    fail "control plane and raw game listener must not publish host ports"
else
    pass "only the nginx edge publishes a host port"
fi

if command -v node >/dev/null 2>&1; then
    if node --input-type=module - "${repo_root}" <<'NODE'
import fs from 'node:fs'
import path from 'node:path'

const root = process.argv[2]
const schema = JSON.parse(fs.readFileSync(path.join(root, 'protocol/schema.json'), 'utf8'))
for (const mapId of ['graybox-arena', 'copper-yard']) {
  const manifestPath = path.join(root, `client/public/maps/${mapId}/manifest.json`)
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  if (manifest.mapId !== mapId || manifest.format !== 'cpp-server-map' || manifest.formatVersion !== 2) {
    throw new Error(`invalid ${mapId} format metadata`)
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(manifest.contentHash)) throw new Error(`invalid ${mapId} content hash`)
  const required = Object.values(manifest.assets).filter((asset) => asset !== null)
  if (Object.keys(manifest.assetHashes).sort().join('\0') !== [...required].sort().join('\0')) throw new Error(`${mapId} asset hash coverage mismatch`)
  for (const asset of required) {
    if (typeof asset !== 'string' || !fs.existsSync(path.join(path.dirname(manifestPath), asset))) throw new Error(`missing ${mapId} asset: ${asset}`)
  }
}
if (schema.version !== 8) throw new Error(`protocol schema is v${schema.version}, expected v8`)
NODE
    then
        pass "map v2 package paths/hash metadata and protocol v8 agree"
    else
        fail "map package paths/hash metadata or protocol version is invalid"
    fi
else
    fail "node is required to validate JSON deployment metadata"
fi

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    if docker compose --env-file "${repo_root}/.env.example" \
        -f "${repo_root}/docker-compose.yml" config --quiet; then
        pass "docker compose configuration resolves"
    else
        fail "docker compose configuration does not resolve"
    fi
else
    echo "SKIP: docker compose is unavailable; static checks still ran"
fi

if [[ -n "$env_file" ]]; then
    if [[ "$env_file" != /* ]]; then
        env_file="${repo_root}/${env_file}"
    fi
    if [[ ! -f "$env_file" ]]; then
        fail "environment file not found: ${env_file}"
    else
        declare -A production_env=()
        while IFS='=' read -r key value; do
            [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
            production_env["$key"]="$value"
        done < <(grep -Ev '^[[:space:]]*(#|$)' "$env_file")

        for key in POSTGRES_PASSWORD DATABASE_URL JWT_SECRET \
            SERVER_SHARED_SECRET JOIN_TICKET_SECRET CLIENT_ORIGIN SERVER_ID SERVER_HOST \
            SERVER_REGION SERVER_BUILD_ID SERVER_WEBSOCKET_URL; do
            value="${production_env[$key]:-}"
            [[ -n "$value" ]] || fail "${key} is required in ${env_file}"
            [[ "$value" != *change-me* ]] || fail "${key} still contains change-me"
        done
        [[ "${production_env[CLIENT_ORIGIN]:-}" =~ ^https://[^/]+$ ]] || \
            fail "CLIENT_ORIGIN must be an https origin without a path"
        [[ "${production_env[SERVER_WEBSOCKET_URL]:-}" =~ ^wss://[^/]+/.+ ]] || \
            fail "SERVER_WEBSOCKET_URL must be a complete wss URL with a path"
        [[ "${production_env[SERVER_WEBSOCKET_URL]:-}" == */game/ ]] || \
            fail "SERVER_WEBSOCKET_URL must route through /game/"
        if ((failures == 0)); then
            pass "production environment values are structurally safe"
        fi
    fi
fi

if ((failures > 0)); then
    echo "Deployment validation failed with ${failures} issue(s)." >&2
    exit 1
fi

echo "Deployment validation passed."
