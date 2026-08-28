# Offline map sources

The compiler reads glTF 2.0 JSON with embedded buffers. Map roles come from
named `Render`, `Collision`, `Spawns`, `Markers`, `Zones`, `Navigation`, and
`Radar` collections, expressed by
an ancestor node name or a node's exported `extras.collection` custom
property. `extras.mapRole` may explicitly select the same lowercase role.

Apply Blender object scale before export; non-unit scale and matrix transforms
are rejected. Render/collision objects use one indexed `TRIANGLES` primitive
with float `POSITION` data and unsigned indices. Embedded base64 buffers keep
source ingestion hermetic. Spawn nodes support a finite `yaw` custom property;
marker nodes require `markerType` of `landmark`, `pickup`, `objective`, or
`callout`. Spawn properties are `yaw`, `modes`, `team`, `weight`, and
`clearanceRadius`. Zones use `zoneType` plus an axis-aligned `size`.
Navigation empties use a bounded array of node-name `links`. A Radar empty
declares north-up projection generation. Map-root extras may define bounded
`environment` and `policy` objects.

Render nodes may carry a `material` object with `name`, RGBA `baseColor`,
`metallic`, and `roughness`. These values become distinct GLB PBR materials;
they are not replaced by a compiler-wide gray material. Production exporters
should retain indexed triangles, normals, UV0, tangents, material assignments,
and embedded textures. The compact inline-geometry path is the tiny reference
contract used by the two original checked-in maps.

For compact hand-authored grayboxes, a geometry custom property may contain
either `{ "shape": "box"|"ramp", "size": [x,y,z] }` or explicit
`positions` and `indices`. The compiler expands this before applying node TRS.
This extension is not needed for Blender mesh exports.

From `client/`:

```sh
npm run map:compile  # update every committed package
npm run map:check    # rebuild every map in memory and fail on any drift/extra file
```

Optional navigation and radar assets are represented by explicit `null` in
the v2 manifest. `gameplay.json` is always present. Every declared file has an
exact SHA-256 and participates, in filename order, in the package content hash.

The exporter preset is: glTF 2.0 JSON, right-handed Y-up metres, embedded
buffers/images, selected map collections, applied transforms, +Y up, no sparse
accessors, and triangulate on export. Run `map:check` before committing.
