# Offline map sources

The compiler reads glTF 2.0 JSON with embedded buffers. Map roles come from
named `Render`, `Collision`, `Spawns`, and `Markers` collections, expressed by
an ancestor node name or a node's exported `extras.collection` custom
property. `extras.mapRole` may explicitly select the same lowercase role.

Apply Blender object scale before export; non-unit scale and matrix transforms
are rejected. Render/collision objects use one indexed `TRIANGLES` primitive
with float `POSITION` data and unsigned indices. Embedded base64 buffers keep
source ingestion hermetic. Spawn nodes support a finite `yaw` custom property;
marker nodes require `markerType` of `landmark`, `pickup`, or `objective`.

For compact hand-authored grayboxes, a geometry custom property may contain
either `{ "shape": "box"|"ramp", "size": [x,y,z] }` or explicit
`positions` and `indices`. The compiler expands this before applying node TRS.
This extension is not needed for Blender mesh exports.

From `client/`:

```sh
npm run map:compile  # update the committed package
npm run map:check    # recompile in memory and fail on any drift
```
