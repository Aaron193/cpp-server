# Browser 3D FPS

This repository contains a browser-based, right-handed Y-up 3D FPS and its
multiplayer stack:

- Babylon.js renders the Vite-built TypeScript client.
- Jolt Physics powers the browser character controller and the authoritative
  C++17 simulation.
- uWebSockets carries the generated protocol-v3 binary session protocol.
- Fastify and PostgreSQL provide authentication, server registration, and
  discovery.
- The authored `graybox-arena` package supplies a GLB render scene, versioned
  collision binary, spawn metadata, and a compatibility hash.

The active runtime is the Babylon/Jolt 3D path. PixiJS, Box2D, Webpack, and the
old 2D world/sprite runtime are not part of the production build.

## Repository layout

```text
client/                         Babylon.js/Jolt browser client and Vite build
client/maps/                    authored map sources
client/public/maps/             committed deployable map packages
protocol/                       protocol-v3 schema, generator, and fixtures
server/                         native Jolt/uWebSockets authoritative server
web/                            Fastify/PostgreSQL control plane
Dockerfile.{client,server,web}  production images
nginx.conf                      static, API, and WebSocket edge routing
docker-compose.yml              private service network and health ordering
scripts/validate-deployment.sh  read-only deployment invariant checks
```

## Prerequisites

- Node.js 20.19.5 and npm
- CMake 3.10+, a C++17 compiler, and Ninja or Make
- vcpkg at commit `9e593bb18ea69cc5095e012465dcd675a822ed0d` (Jolt 5.6.0)
- PostgreSQL 16 for the control plane
- Docker with Compose for the production-style deployment

## Build and test

Client, protocol, map compiler, Jolt smoke test, and Vite bundle:

```bash
cd client
npm ci
npm run protocol:check
npm run typecheck
npm test
npm run map:check
npm run smoke:jolt
npm run build
```

Control plane and migrations:

```bash
cd web
npm ci
npm run typecheck
npm test
npm run build
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/game_db npm run db:migrate
```

Native Release server and CTest suite:

```bash
git clone https://github.com/microsoft/vcpkg.git /opt/vcpkg
git -C /opt/vcpkg checkout 9e593bb18ea69cc5095e012465dcd675a822ed0d
/opt/vcpkg/bootstrap-vcpkg.sh -disableMetrics
export VCPKG_ROOT=/opt/vcpkg
cd server
./build.sh --release --test
```

The server build uses `server/.build/3d/release`; it does not reuse a legacy
2D build tree. To run the three development services separately, start
PostgreSQL, run `npm run dev` in `web/`, run `./build.sh --release --run` in
`server/`, and run `npm run dev` in `client/`. Copy each service's `.env.example`
when local overrides are needed.

## Production deployment

The production topology exposes only the client nginx port. PostgreSQL, the
control plane, and the raw game-server listener stay on the private Compose
network. A TLS terminator in front of nginx owns certificates and public port
443; nginx routes `/api/` to Fastify and preserves WebSocket Upgrade requests
at `/game/`.

```bash
cp .env.example .env
# Replace every change-me value and set the public HTTPS/WSS host.
./scripts/validate-deployment.sh --env-file .env
docker compose --env-file .env build --pull web gameserver client
docker compose --env-file .env up -d db
docker compose --env-file .env run --rm web node dist/db/migrate.js
docker compose --env-file .env up -d web gameserver client
docker compose --env-file .env ps
```

The web container also runs migrations before serving, so the explicit
migration command is useful as a controlled rollout gate but is idempotent.
`SERVER_WEBSOCKET_URL` must be a complete externally reachable URL such as
`wss://game.example.com/game/`; discovery returns this value verbatim. The
server and client images must use the same `SERVER_BUILD_ID`, protocol v3, and
`graybox-arena` package.

See [docs/deployment.md](docs/deployment.md) for TLS termination, cache and MIME
behavior, health checks, compatibility rollout order, rollback, and image
validation. The historical 2D recovery boundary remains documented in
[docs/3d-migration-guardrails.md](docs/3d-migration-guardrails.md).

## Map and protocol changes

Regenerate rather than hand-edit generated artifacts:

```bash
cd client
npm run protocol:generate
npm run map:compile
npm run protocol:check
npm run map:check
```

Protocol, map format/content hash, build ID, and mode are compatibility gates.
Deploy the database migration and control plane first, then the native server,
then the matching client/static image. Do not advertise a new server until its
matching client assets are ready to roll out.

## License

See [LICENSE](LICENSE).
