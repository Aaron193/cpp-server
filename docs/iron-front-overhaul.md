# Iron Front / Ironworks overhaul

Work is on branch `3d`. This is an implemented Conquest and presentation expansion,
not a claim that a browser prototype has reached Battlefield 4's production quality.
The map and models remain original procedural assets. The main-menu key art is
concept artwork, not a screenshot of gameplay.

## Architecture audit and implementation

| Area inspected | Finding and implemented response |
|---|---|
| Babylon renderer and scene | Existing PBR/quality/backend separation was sound. Added proper engine frame boundaries, Ultra, cascaded shadows, sky irradiance, analytic sky/fog, bounded steam, optional SSAO and restrained bloom. Shadow receivers configure source meshes where instanced; compiled chunks use shared-geometry clones. Material compilation waits for populated cascade render lists, avoiding frozen no-shadow variants. |
| Map format, compiler and loading | Retained package v2, strict metadata and content-hash handshake. Added deterministic Ironworks authoring, spatial/material batches, normals, world-scale UVs and original embedded albedo/normal/ORM textures. Existing graybox/copper package hashes remain unchanged. Collision debug geometry is now created on demand. |
| Jolt and movement | Both runtimes already supported slopes, steps, crouch/prone, sprint, slide, dash and mantle. New shared infantry configuration lowers movement speeds and air control, disables slide/dash for Conquest and preserves the legacy FFA configuration. Fixed a nested shape-settings double destruction that broke repeated WASM world creation. |
| Input, camera and reconciliation | Kept raw simulation aim separate from visual motion and authoritative replay. Added persisted sensitivity, ADS multiplier and inversion, tuned sprint/landing/crouch response, and repaired deployment focus/input blocking. No client position or damage authority was introduced. |
| Weapons, recoil and shots | Existing action prediction, cadence validation and recoil definitions were retained. Positive muzzle velocity now selects fixed-tick authoritative swept projectiles with gravity, flight time and range falloff. A fixed 1,024-slot server pool bounds projectile work. Existing zero-velocity weapons retain lag-compensated hitscan. |
| First-person animation | Added original detailed modular rifle/breacher rigs, calibrated optic/muzzle sockets, articulated hands, magazine reload motion, equip and sprint transitions. Reload presentation uses the advertised weapon definition. A bounded static clearance probe retracts the weapon near walls; rigid parts are batched by material. Offline ammo persists across weapon switches. |
| Remote entities and animations | Added a reusable original glTF operator asset with named joints/sockets, asynchronous loading and a fallback. Existing networked stance, aim, gait, fire, reload and death presentation drives the rig. Corrected shared-material disposal and animation time-domain consistency. |
| Audio and VFX | Retained bounded combat effect/voice pools. Added original procedural wind, steps, room tails, spatial distance filtering, HRTF positioning and live bus controls. Fixed an audio-unlock frame-loop failure and voice-node cleanup. Tracer flight uses advertised speed/drop; authoritative arrival displays impacts immediately. |
| HUD and minimap | Added tactical objective/ticket strip, ownership and capture bars, world-distance markers, team-only radar contacts, kill confirmation, low-health feedback, actual attacker bearing where available, and a revised peripheral ammo/health display. Radar uses package bounds and world-to-map projection. |
| Home and settings | Rebuilt the military front end around original Iron Front art/typography, match finding, server list, loadout information, settings and credits. Settings persist locally; video changes apply next session, controls/audio update live. Fonts are self-hosted with OFL licenses. |
| Spawn and match flow | Added manual tactical deployment, HQ/owned-sector spawn validation, loadout selection and readiness. The server prefers a clear physical slot within the requested sector; contested or actively neutralizing sectors are unavailable. Two server-balanced teams capture five objectives; mixed presence freezes capture, hostile ownership is neutralized before recapture, a majority drains tickets, deaths cost a ticket, and reset returns players to deployment. |
| Networking and security | Protocol 11 adds bounded Deploy and ConquestState messages and regenerated C++/TS fixtures. Capture, team, tickets, spawn eligibility, weapon configuration, hits and health remain server-owned. Existing snapshot interpolation, prediction/replay and session authentication remain in use. |
| Performance and tests | Added meaningful capture/deployment/projectile/ammo/settings/map tests and a two-browser native-server Conquest scenario. Fixed spatial centroid batching and performance sampling of unclamped frame intervals. GPU timings are not inferred from headless software rendering. |

## Play and regenerate

Use the root README development launcher, or start the API, native Release server
and Vite separately. Default server mode is `conquest`, default package is
`ironworks`, and its rules come from `server/infantry_config.json`.
To run legacy FFA, explicitly select `SERVER_MODE=ffa`, the desired original map,
and `GAME_CONFIG_PATH=.../server/game_config.json`.

The home screen's **Explore the Battlefield** option opens local exploration and
manual deployment. It does not simulate opponents or counterfeit Conquest scores.
Multiplayer **Find a Match** uses the existing authenticated discovery/join flow.

Controls: WASD movement, Shift sprint/stand, C cycles standing/crouch/prone,
Space jumps or mantles, RMB aims, LMB fires, R reloads, 1/2 selects weapons,
Tab displays the scoreboard, Enter chats, and F3 toggles development diagnostics.
The new settings panel controls sensitivity, ADS sensitivity, inversion, FOV,
motion, render scale, quality, AO, bloom and sound buses.

Rebuild original authored assets from the client directory:

```sh
node --import tsx tools/map-authoring/ironworks.ts
node --import tsx tools/assets/operator.ts
npm run map:compile
```

The 448 × 336 m package has five capture zones, 16 team HQ spawn positions,
15 objective spawn positions, linked route metadata, two 52 × 88 m halls with
4 m mezzanines, a below-grade service gallery, rail and storage lanes, outlying
warehouses, plant equipment and woodland flanks. The radar is generated from
package geometry and is not a captured game-camera image.

## Validation

The September 5 validation passed 131 client tests across 28 files, all eight
Playwright scenarios, all four native CTest suites (including 61 simulation tests),
protocol/fixture consistency, type checking, map validation, Jolt smoke tests,
production builds and deployment invariants. The web API's type check, two test
files and build also passed. Vite still reports a large-bundle warning.

The implementation is exercised with protocol/fixture checks, TypeScript,
Vitest, deterministic map checks, Jolt traversal of all three maps, Vite production
build, native Release CTest suites and deployment invariant validation.
`client/e2e/conquest.e2e.ts` starts two signed sessions against the native
Conquest server, checks opposing HQ deployment, sprint displacement, remote
stance, ADS, authoritative ammunition and reload completion.

Playwright uses a separate Vite cache, a legacy FFA server on port 9002 and an
Ironworks Conquest server on 9003. Build `server/.build/3d/release/server` first. The Jolt smoke suite also verifies all 31 spawn positions, full service-gallery traversal and all eight mezzanine stairways.

```sh
cd client
npm run test:e2e
```

The local capture tools write ignored `client/artifacts/` screenshots. High
preset captures under SwiftShader are visual diagnostics. They do not establish
a 60 FPS claim on physical gaming hardware. Compare presets on the same route,
resolution and GPU using `window.__arenaProfile()` in a development build.
It reports actual frame-interval p50/p95, draw calls, active geometry, loading,
shadow cost, effect capacity and network correction statistics.

The checked [measurement report](baselines/ironworks-overhaul.json) records the
tested map hash, package sizes, browser profiles and both native benchmark runs.
The 12-player, 30-second Conquest simulation measured a 0.096 ms p95 tick and
13.54 KB/player/s outbound traffic, using in-memory transport and synthetic
backpressure. This is not a live network soak. The fixed-camera SwiftShader
captures measured approximately 1.4 FPS on High and 7.1 FPS on the software preset.
These results establish neither acceptable gaming performance nor an improvement
over the historical Node frame-work proxy. Physical GPU profiling remains required.

## Production gaps and replacement contracts

The environment currently has procedural architecture/materials and simplified
foliage. It needs authored damaged building modules, texture variation/decal
atlases, more natural terrain/woodland and repeated multiplayer route playtests
before it should be called finished environment art. The current chunks support
frustum culling and material reuse; there is no large-map streaming system or
occlusion-query implementation. Grass has preset-dependent distance culling. Trees still need stronger LOD treatment.

The operator is an articulated static glTF hierarchy with procedural motion, not
a skinned motion-capture character. A replacement should retain the `calibration`,
`torso-joint`, `head-joint`, `left/right-arm`, `left/right-leg`, `world-weapon`
and `socket-*` names, right-handed Y-up metre units and -Z forward. Authored skinning
and animation clips will substantially improve close-range character quality.
The first-person rig has independently named optic, muzzle, magazine and hand
nodes for the corresponding replacement, but still uses procedural geometry.

The sound system accepts replaceable source/tail/step assets through its cue
registry. Original synthesis establishes timing and spatial behavior; authored
licensed weapon recordings, distinct indoor/outdoor tails, equipment Foley and
material-specific footfalls would improve it. Current VFX are bounded but do not
include a full explosion/destruction/shell-ejection system.

Conquest is an infantry foundation. Squad selection/spawn, spotting, vehicles,
classes/equipment abilities, destruction, suppression gameplay and voice chat are
not implemented. Projectile flight currently tests present-time authoritative
capsules; unlike the retained hitscan path it does not rewind a bullet's flight
for shooter latency. The 12-player configuration is tested; a large-player-count
network/GPU soak is still required. None of these gaps are hidden by the menu art.
