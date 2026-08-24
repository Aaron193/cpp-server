# Headless server load benchmark

`server_load_benchmark` drives twelve in-process authoritative sessions for
1,800 fixed ticks (30 simulated seconds). Every player submits movement and
held-fire input at 60 Hz while the server performs normal Jolt stepping,
lag-comp history, combat, 20 Hz per-recipient snapshots, queueing, and egress.

Build and run it from the repository root:

```sh
cmake -S server -B /tmp/cpp-server-load-release \
  -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=ON -DSERVER_ENABLE_JOLT=ON \
  -DCMAKE_PREFIX_PATH="/tmp/cpp-server-vcpkg-2026.07.29/installed/x64-linux;$PWD/server/build/vcpkg_installed/x64-linux"
cmake --build /tmp/cpp-server-load-release --target server_load_benchmark -j2
/tmp/cpp-server-load-release/server_load_benchmark
```

The single JSON result reports tick/Jolt/snapshot latency, catch-up and dropped
time, input and egress bandwidth, queue high-water marks, an allocation-pressure
proxy (peak queued encoded bytes), and shot/hit totals. Release builds enforce
tick p95 below 10 ms. Debug builds still validate deterministic counts and
queue/catch-up bounds but intentionally skip the wall-clock threshold.
