# 3D migration guardrails

## Recovery baseline

Commit `cffbb27` (`todo comment on bad gc perf`) is the last known 2D
revision and the target for the `2d-baseline` tag. The Phase 1 changes do not
rewrite history or move that commit. A maintainer with permission to publish
repository refs can create and push the annotated tag after review:

```sh
git tag -a 2d-baseline cffbb27 -m "Last 2D baseline before the 3D overhaul"
git push origin 2d-baseline
```

Do not retarget that tag to a later 3D commit. The existing 2D runtime remains
recoverable from the tag or commit even as it is removed from the `3d` branch.

## Retained and replaced systems

The cutover retains these concepts or services, although their interfaces may
evolve:

- EnTT ECS and entity/component ownership.
- uWebSockets and the current WebSocket deployment path.
- Packet reader/writer concepts, with generated definitions planned to replace
  duplicated message declarations.
- Weapon configuration as the source of gameplay tuning.
- Authentication, control-plane server registration/discovery, and Docker
  deployment.
- DOM-based chat and HUD concepts where they fit the FPS experience.

The cutover replaces these 2D-specific systems rather than maintaining two
runtimes:

- PixiJS rendering, sprite entities, 2D animation, grid, and minimap rendering.
- Box2D physics, pixel-to-meter conversion, and 2D transforms.
- Procedural island/biome terrain and its generated height/mesh artifacts.
- Camera-AABB relevance, planar movement/aim input, and the current 2D
  snapshot/interpolation protocol.

Phase 1 adds guardrails and characterization only. It does not begin those
runtime replacements.

## Generated output and build directories

Generated files must stay untracked and must be created by the developer or CI
user that invoked the build:

- C++: `server/.build/3d/<configuration>`.
- Web control plane: `web/.build/dist`.
- Browser client: `client/dist` (the active Vite production output).

`server/build` is a legacy cache tied to an obsolete vcpkg checkout and is not
reused. `server/build.sh` requires an explicit `VCPKG_ROOT` and configures a
fresh tree below `server/.build/3d`. `CPP_SERVER_BUILD_ROOT` may point to a
different user-writable root when needed. Pass `--test` to build and execute
the CTest suite after configuration.

The web build deliberately does not write to `web/dist`. That directory may
have been created by an older root/container workflow and can remain in place;
local typechecking, tests, and builds do not need to own, replace, or delete it.
Docker copies `web/.build/dist` from its isolated builder stage into the
runtime image's `/app/dist`.

## CI gates

Phase 1 CI runs real commands for:

- client TypeScript typechecking and production build;
- web TypeScript typechecking, server-discovery characterization tests, and
  production build;
- fresh C++ configure/build plus CTest characterization tests.

There is currently no shared-protocol generator, and CI intentionally has no
green placeholder for one. Phase 2B adds the offline map compiler: client CI
runs its unit/map tests and recompiles the committed graybox arena in `--check`
mode, failing when any generated package file is missing, unexpected, or has
drifted from its source.
