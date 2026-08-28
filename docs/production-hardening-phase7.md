# Phase 7 production hardening report

Captured in this workspace on 2026-08-28. Results below distinguish deterministic
simulation, local CPU measurements, SwiftShader captures, and work that still
requires real hardware or external tooling. Reproduce the primary report with:

```sh
cd client
npm run hardening:phase7
```

## Numerical gates and rationale

Phase 0 measured correction p95 at `0.0400000013 m` and native egress at
`11,534 B/player/s`. Phase 7 gates ordinary horizontal correction p95 at
`0.10 m` (2.5x the baseline), p99 at `0.18 m`, and max at the existing `0.60 m`
hard-sync boundary. Vertical p95 is tighter at `0.08 m`; its max uses the same
`0.60 m` boundary. Egress is capped at `16 KiB/player/s`, 42% above Phase 0.

Capacity gates come directly from production bounds: pending input `128`, replay
steps `64`, history overflow `0`, interpolation delay `250 ms`, queued/buffered
bytes `256 KiB`, snapshot p95 `1,024 B`, and 77 maximum changed fields for the
current eleven-remote-player pressure record. Clock drift is at most 1.5 ticks
with confidence p50 at least 0.45. Generated v6 encoding p95 has a deliberately
loose local-CPU gate of 2 ms; compare distributions rather than treating it as a
cross-host benchmark.

## Deterministic impairment and soak result

The pairwise matrix uses 42 scenarios and 214 simulated seconds. It covers FPS
30/60/120/144; RTT 0/30/60/120/200/350 ms; jitter 0/5/20/50 ms; 100/250/500/2000
ms stalls; reconnect during movement, fire, reload, death, respawn, and map
load; uint32 sequence/tick wrap; a hidden tab; and a 144 FPS frame spike. This
avoids the 4,608-case full Cartesian product while covering every FPS/RTT pair
and every required recovery state.

| Captured fact | Result | Gate |
|---|---:|---:|
| Horizontal correction p50/p95/p99/max | 0.0291 / 0.0583 / 0.0744 / 0.0878 m | p95 <= 0.10; p99 <= 0.18; max <= 0.60 |
| Vertical correction p50/p95/p99/max | 0.0111 / 0.0219 / 0.0273 / 0.0311 m | p95 <= 0.08; max <= 0.60 |
| Hard syncs | 42 first, 6 clock discontinuity, 6 reconnect generation | explicit reasons present |
| Pending/replay high-water; overflow | 27 / 27; 0 | 128 / 64; 0 |
| Clock confidence p50; drift max | 0.916; 1 tick | >= 0.45; <= 1.5 ticks |
| Commands accepted/late/future/duplicate/held/neutralized | 12,383 / 2 / 0 / 0 / 3,645 / 238 | classified and bounded |
| Interpolated/extrapolated/frozen | 4,066 / 181 / 5 | modes captured |
| Interpolation delay p95/p99/max; underflow | 224.35 / 246.34 / 250 ms; 5 | max <= 250 ms; underflow <= 25% |
| Snapshot bytes p50/p95/p99/max | 513 / 513 / 645 / 652 B | p95 <= 1,024 B |
| Changed fields p50/p95/p99/max | 22 / 22 / 77 / 77 | max <= 77 |
| Generated encoding p50/p95/p99 | 0.037 / 0.081 / 0.271 ms | p95 <= 2 ms |
| Buffered/coalesced | 20,520 B / 5,015 | <= 256 KiB; coalescing exercised |
| Simulated egress | 10,393 B/player/s | <= 16 KiB/player/s |

The accelerated 30-minute soak reached, but never exceeded, its fixed storage:
prediction 14/256, remote history 32/32, entities 64/64, FX 40/40, decals 60/96,
audio voices 24/24, killcam poses 7,680/7,680, killcam events 256/256, and
network queue 40/256. This is bounded-state evidence, not a substitute for a
multi-hour live production soak.

## Movement, protocol, maps, rendering, and load

The shared movement fixtures now run identical tuning and command shapes through
browser WASM and native Jolt on `graybox-arena` and `copper-yard`. Checkpoints
cover settle/movement, jump apex/landing, changed yaw, wall approach, authored
slope/step traversal where present, terminal-velocity characterization, and
two authoritative reset/replay points. Both adapters fail on NaN, world escape,
ground disagreement, position error over 0.35 m, or velocity error over 0.5 m/s.

Generated TS/C++ tests enumerate all 127 non-empty delta field masks and reject
empty, unknown-bit, presence-mismatched, truncated, oversized, invalid enum,
and unknown-message cases. Baseline reset, handle reuse, relevance hysteresis,
owner privacy, reconnect reset, and reliable ordering under slow-client pressure
are automated. The native 12-player benchmark forces eleven moving remote
records per recipient (at least 440 changed position/velocity fields per second)
and includes a five-second 200 KiB slow transport interval.

The current local Release benchmark measured tick p95/p99/max at
`0.0749/0.1102/0.1317 ms`, snapshot encoding p95 at `0.00274 ms`, snapshot p95
at `513 B`, and egress at `11,962 B/player/s`. Queue/buffer high-water was
`205,480/204,800 B`; 100 snapshots coalesced and the three pressure events
arrived in exact order. All native gates passed. These are in-process results
on this workspace, not production host or regional network measurements.

Both map-v2 packages are reproducibly compiled and parsed in TS/C++. Compiler
audits cover every role, unknown metadata, missing nav links, cycles, duplicate
IDs, transforms, non-finite/degenerate/out-of-bounds geometry, spawn coverage,
zone bounds, radar generation, and asset hashes. Native Jolt tests exercise
spawn probes, static rays, bounds, jumping, slopes, steps, walls, landing, and
terminal fall. Map v1 parsing was removed after both committed packages,
discovery metadata, compiler output, container paths, and runtime loaders passed
the v2 migration gates.

SwiftShader WebGL2/software captures are automated at 4:3 DPR 1, 16:9 DPR 2,
and ultrawide DPR 1. They gate the 50 ms software frame p95, shader readiness,
effective DPR, shadows, final-grade passes, and FX capacity. Explicit WebGPU
unavailability must render a visible startup failure. Stepped-clock JSON captures
cover connection/mismatch, damage/reload, death/killcam/spectate, HUD pulses,
and minimap privacy. These are software fallback facts, not hardware GPU data.

## Migration decisions

- Map v1 loaders were removed: every in-repository producer and consumer is v2,
  both packages pass reproducibility/hash gates, and deployment pins map v2.
- Legacy full `Snapshot` message ID 5 remains in protocol v6. Phase 0 fixture
  lock and prediction reconciliation tests still use it. Remove it only in the
  v7 schema after those tests emit `SnapshotDelta`, all golden vectors are
  regenerated in TS/C++, and a release search finds no ID-5 producer/consumer.
- Prediction lead/time dilation remains unimplemented/default-off. Remove the
  design flag language only after live traces show a lead controller improves
  late/held input without worsening correction p95/p99.

## Genuinely manual or external work

- Real hardware WebGPU and WebGL2 captures across representative integrated and
  discrete GPUs, drivers, DPRs, and thermally sustained ten-minute runs.
- Human camera-comfort, animation/hitbox, muzzle socket, positional audio mix,
  wall-tuck clipping, radar landmark, and killcam framing review.
- DCC/Blender source collection-name, unapplied-transform, material, UV, and
  visual/collision overlay review before accepting new authored maps.
- Multi-hour live WSS soak, regional packet shaping, proxy/load-balancer timeout,
  certificate rotation, backup/restore, and rolling rollback drills.
- Image SBOM/vulnerability scan, signed provenance/attestations, immutable digest
  publication, and independent third-party asset/license review. No external
  registry, hardware, DCC, SBOM, or provenance result is claimed here.

## Local validation summary

- Client: protocol generation check, updated fixture lock, typecheck, 103 tests,
  both reproducible map hashes, both-map Jolt smoke, and Vite production build
  passed. The bundle retains the existing large-chunk advisory.
- Native: rebuilt Release targets; characterization, physics, simulation, and
  load CTests all passed (4/4).
- Web: typecheck, two Node test suites, and production TypeScript build passed.
- Browser: all five Playwright tests passed under headless Chrome/SwiftShader,
  including two-player combat, three DPR/aspect captures, explicit WebGPU
  unavailable UI, stepped UX facts, and the existing render profile.
- Deployment static/Compose validation passed, including protocol v6, both map
  packages, private services, WSS/CSP/cache rules, non-root images, map root,
  and secret seams. The checked local `.env` is intentionally not production
  complete: it lacks `JOIN_TICKET_SECRET`, `CLIENT_ORIGIN`, `SERVER_BUILD_ID`,
  and `SERVER_WEBSOCKET_URL`, so the production-value validator correctly
  failed those seven required/HTTPS/WSS checks. It was not overwritten.
- Secret scan found no tracked private-key material or populated long-lived
  secrets. Only `.env.example` placeholders, a local README database example,
  and the secret-generation script matched; `.env`, `server/.env`, and
  `web/.env` are ignored.
