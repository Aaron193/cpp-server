# Map package v2 and authoring audit

Map selection is data-driven. A game server loads `MAP_PACKAGE_DIR`, or
`MAP_PACKAGE_ROOT/<SERVER_MAP_ID>`, validates the full package before opening a
session, and registers the loaded map ID, format major, and content hash. The
browser resolves `/maps/<discovery.mapId>/manifest.json`; Welcome, discovery,
and the parsed manifest must match exactly. Changing a server environment
variable does not mutate an active session: restart to select another package.

The v2 manifest names render, collision, gameplay, optional navigation,
optional radar, and debug assets. Omission is represented by `null`. Strict
TypeScript and C++ readers reject unknown majors, unknown fields, traversal
paths, non-finite or out-of-range values, inverted/outside bounds, duplicate or
excessive counts, uncovered assets, bad individual hashes, and package hash
drift. Version 1 remains a read-only migration path; the compiler only writes
version 2.

Automated compiler gates cover collision/render finite and degenerate
triangles, index/bounds validity, 250k collision triangle budget, render versus
collision bounds tolerance, spawn count/bounds/yaw/ID/mode coverage and close
spawn warnings, navigation link existence/connectivity and cap, radar aspect
ratio/landmark projection, exact asset coverage, reproducibility, and a rich
source-node report. Browser and native Jolt smoke paths exercise both committed
maps, including ramps/bridge or stairs/tunnel routes, a jump/ledge transition,
and final world-bound containment.

The following remain DCC/manual release audits because mesh topology alone is
not enough to decide author intent:

- inspect thin or one-sided blockers and projectile-height perimeter fences;
- inspect spawn capsule overhead clearance, support, team safety, minimum
  distance and line of sight for each shipped mode;
- walk every doorway/tunnel edge, stacked floor, stair and ledge in both
  runtimes, including adversarial approach angles;
- compare render silhouettes against collision probes for invisible blockers
  and penetrable visible faces;
- overlay radar landmarks against the rendered map and review north alignment;
- throw/projectile-test all low boundaries and perform out-of-bounds ray sweeps;
- review authored UVs, tangents, texture color spaces, compression and material
  licensing before treating a reference map as production art.

`graybox-arena` is the migrated vertical traversal fixture. `copper-yard` is an
original, materially distinct long courtyard with a copper bridge, opposed
ramps, a north tunnel, a south tower, authored PBR colors, a connected nav
graph, playable/projectile zones, and generated radar landmarks.
