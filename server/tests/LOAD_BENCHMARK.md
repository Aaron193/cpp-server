# Headless server load benchmark

`server_load_benchmark` drives twelve in-process authoritative sessions for
1,800 fixed ticks (30 simulated seconds). Every player submits movement and
held-fire input at 60 Hz while the server performs normal Jolt stepping,
lag-comp history, combat, 20 Hz per-recipient snapshots, queueing, and egress.
Each recipient receives eleven moving peers, forcing at least 440 changed
position/velocity fields per second before relevance filtering. One player is
held at 200 KiB of synthetic transport backpressure for five simulated seconds;
three reliable events are injected and their exact order is gated while state
snapshots coalesce.

Build and run it from the repository root:

```sh
cmake -S server -B /tmp/cpp-server-load-release \
  -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=ON -DSERVER_ENABLE_JOLT=ON \
  -DCMAKE_PREFIX_PATH="/tmp/cpp-server-vcpkg-2026.07.29/installed/x64-linux;$PWD/server/build/vcpkg_installed/x64-linux"
cmake --build /tmp/cpp-server-load-release --target server_load_benchmark -j2
/tmp/cpp-server-load-release/server_load_benchmark
```

The JSON result reports tick/Jolt/snapshot latency, catch-up and dropped time,
input and egress bandwidth, queue and actual transport-buffer high-water marks,
coalescing, reliable order, delta changed-field pressure, and shot/hit totals.
All builds gate snapshot p95 at 1,024 bytes, egress at 16 KiB/player/s, queue
memory at 256 KiB, and the reliable pressure order. Release builds additionally
enforce tick p95 below 10 ms. Debug builds intentionally skip only that
wall-clock gate.

Current local Release result (2026-08-28): tick p95/p99/max
`0.0749/0.1102/0.1317 ms`, Jolt p95 `0.00046 ms`, snapshot encode p95
`0.00274 ms`, snapshot p95 `513 B`, egress `11,962 B/player/s`, queue high-water
`205,480 B`, transport buffered high-water `204,800 B`, 100 coalesced snapshots,
440 minimum changed fields/second, and exact reliable order
`pressure-one`, `pressure-two`, `pressure-three`. This is a local in-process CPU
result, not regional network or production hardware evidence.
