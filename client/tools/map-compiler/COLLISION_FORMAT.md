# Collision binary format (`M3CL`, version 1)

`collision.bin` is deterministic, little-endian, and contains static triangle
data only. Positions use the project's right-handed, Y-up meter convention.
Readers must reject unknown versions, nonzero flags, truncated data, index
counts not divisible by three, and indices outside `vertexCount`.

| Offset | Type | Meaning |
| ---: | --- | --- |
| 0 | `char[4]` | ASCII magic `M3CL` |
| 4 | `uint16` | Format version (`1`) |
| 6 | `uint16` | Flags (`0`) |
| 8 | `uint32` | Vertex count |
| 12 | `uint32` | Index count (three per triangle) |
| 16 | `float32[3]` | World-bounds minimum X/Y/Z |
| 28 | `float32[3]` | World-bounds maximum X/Y/Z |
| 40 | `float32[vertexCount][3]` | Vertex positions X/Y/Z |
| ... | `uint32[indexCount]` | Triangle indices |

Meshes are sorted by node name before concatenation. Vertices are not welded,
which keeps output reproducible and preserves source triangle boundaries.
