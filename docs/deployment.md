# Production deployment

## Topology and trust boundary

Only the client nginx container publishes a host port. PostgreSQL, Fastify,
and the native game listener use the private `game-network` bridge. Put a
managed load balancer, ingress controller, Caddy, or a separate TLS-enabled
nginx in front of host port `HTTP_PORT` (8080 by default).

The TLS terminator must forward the original host/proto headers and preserve
these paths without rewriting them:

| Public path | Internal target | Notes |
| --- | --- | --- |
| `/` and `/maps/` | client nginx | Vite SPA and authored map package |
| `/api/` | Fastify through client nginx | nginx removes the `/api` prefix |
| `/game/` | native server through client nginx | HTTP/1.1 WebSocket Upgrade |

Configure the outer proxy's WebSocket idle timeout to at least 75 seconds.
Store certificates and private keys in the TLS service/secret manager or an
untracked host mount; do not copy them into these images or commit them. The
stock `nginx:1.27.5-alpine` client image deliberately serves HTTP only and does
not contain a Brotli module. It serves gzip for compressible responses.

For a single public origin, use:

```dotenv
CLIENT_ORIGIN=https://game.example.com
SERVER_WEBSOCKET_URL=wss://game.example.com/game/
```

The native server registers `SERVER_WEBSOCKET_URL` as a complete value and the
control plane returns it verbatim. Neither the control plane nor nginx rebuilds
it from `SERVER_HOST` or `SERVER_PORT`. `SERVER_HOST` remains registry metadata
only.

## Prepare and validate configuration

```bash
cp .env.example .env
chmod 600 .env
# Replace all change-me values with independent random production secrets.
./scripts/validate-deployment.sh --env-file .env
docker compose --env-file .env config --quiet
```

The validator is read-only. It checks the deployment file set, pinned vcpkg
commit and Jolt build flag, runtime config/map paths, non-root images, protocol
v3 and map metadata, nginx WASM/cache/CSP/Upgrade behavior, private PostgreSQL,
Compose health ordering, and production HTTPS/WSS values. Compose treats key
identity, secret, origin, build, and external WebSocket values as required;
defaults are limited to bounded non-secret settings.

`SERVER_BUILD_ID` is embedded into the Vite client and supplied to the native
server. Use an immutable release identifier. Do not use `dev` or reuse an ID
for different binaries.

## Build, migrate, and start

```bash
docker compose --env-file .env build --pull web gameserver client
docker compose --env-file .env up -d db
docker compose --env-file .env run --rm web node dist/db/migrate.js
docker compose --env-file .env up -d web
docker compose --env-file .env up -d gameserver
docker compose --env-file .env up -d client
docker compose --env-file .env ps
```

The web service command also applies migrations before starting Fastify. The
separate migration command makes schema migration an observable rollout gate.
Drizzle migrations are forward-only; back up PostgreSQL before applying a new
release and test restore procedures outside production.

The game image builds native dependencies from vcpkg commit
`9e593bb18ea69cc5095e012465dcd675a822ed0d` (Jolt 5.6.0), explicitly enables Jolt, copies
`server/game_config.json` to `/app/game_config.json`, and copies the committed
`graybox-arena` map package. It runs as `gameserver`, with
`GAME_CONFIG_PATH=/app/game_config.json` and
`MAP_PACKAGE_DIR=/app/maps/graybox-arena`. Invalid inputs stop startup before
the listener becomes healthy.

## Verify a release

```bash
docker compose --env-file .env ps
curl --fail --silent https://game.example.com/health
curl --fail --silent https://game.example.com/api/servers
curl --fail --silent --head https://game.example.com/maps/graybox-arena/manifest.json
```

Check browser developer tools as well:

- `.wasm` responses use `Content-Type: application/wasm`.
- `/assets/<name>-<hash>.*` uses one-year immutable caching.
- `index.html`, map manifests, GLB/collision payloads, and API discovery use
  `no-cache` or `no-store`.
- a missing `/assets/*.js`, `/maps/*`, or other file-like URL returns 404, not
  the SPA HTML.
- the discovery record contains the exact public `wss://.../game/` URL and the
  WebSocket upgrades successfully.
- CSP permits the bundled WASM/WebGPU application and WSS connection without
  inline script violations.

The inner health checks probe PostgreSQL readiness, Fastify `/health`, the
native listener over HTTP, and nginx `/health`. Compose waits for each upstream
to become healthy before starting its dependent service.

## Compatibility and rollout order

The join path checks this compatibility tuple:

1. generated binary protocol version (`3`),
2. `SERVER_BUILD_ID` embedded in both client and server,
3. map ID (`graybox-arena`), format version, and content hash,
4. game mode (`ffa` unless explicitly changed).

Roll forward in this order:

1. back up PostgreSQL, apply migrations, and deploy the control plane;
2. build the server and client from the same revision and build ID;
3. deploy the native server and wait for a healthy compatible discovery row;
4. deploy the matching client/nginx image;
5. verify discovery and a real WSS join before removing the prior images.

A strict build mismatch is intentionally not joinable, so a rolling release
may briefly show an incompatible server. For zero-downtime multi-instance
rollouts, publish the matching client first under a release-specific origin or
run old and new discovery pools until traffic moves to the new tuple.

For rollback, stop advertising the failed server, restore the previous server
and client images together, and confirm their build/map tuple. Only roll back a
database migration when a reviewed reverse migration and verified backup exist.

## Non-container validation

CI runs the same protocol, map, client, web, and native Release/CTest checks as
local development. Before publishing images, run:

```bash
./scripts/validate-deployment.sh

(cd client && npm ci && npm run protocol:check && npm run typecheck && npm test && npm run map:check && npm run smoke:jolt && npm run build)
(cd web && npm ci && npm run typecheck && npm test && npm run build)

export VCPKG_ROOT=/path/to/vcpkg-at-9e593bb18ea69cc5095e012465dcd675a822ed0d
(cd server && ./build.sh --release --test)

git diff --check
```

If Docker is available, `docker compose --env-file .env.example config --quiet`
validates interpolation without starting or downloading PostgreSQL. CI also
runs Dockerfile build checks; a release pipeline should build the client and
server images once, scan them, push immutable digests, and deploy those exact
digests rather than rebuilding on the host.
