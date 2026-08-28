# Phase 0 baseline reports

The checked report is a characterization, not an acceptance threshold. Re-run
the same scenarios before setting numerical gates in later phases.

```sh
cd client
npm run baseline:phase0-client > /tmp/cpp-server-phase0-client.jsonl
cd ..
/path/to/server_load_benchmark > /tmp/cpp-server-phase0-server.jsonl
node scripts/run-phase0-baselines.mjs \
  --client-report /tmp/cpp-server-phase0-client.jsonl \
  --server-report /tmp/cpp-server-phase0-server.jsonl \
  --write /tmp/cpp-server-phase0-current.json
```

Phase 7 gates are derived from this report and recorded with the bounded
impairment/load/soak results in
[`../production-hardening-phase7.md`](../production-hardening-phase7.md).
Run `npm run hardening:phase7` from `client/` to reproduce the machine-readable
report; it deliberately labels deterministic simulation separately from live
browser, server, and hardware evidence.

The client report includes deterministic correction/acknowledgement metrics,
the current full-snapshot byte size, a headless frame-work proxy, and strict
map-package parser timings. In a development browser, `window.__arenaProfile()`
reports actual frame p50/p95, RTT, jitter, correction, snapshot bytes, and the
full staged map load through scene creation, GPU upload, and Jolt creation.

The server benchmark is the existing twelve-player, 1,800-tick Release
scenario. Timing values are machine-sensitive. Counts, sizes, trace inputs,
and hashes are deterministic; timing distributions are expected to vary.

The committed report records the exact environment and honest limitations.
No browser GPU timing is inferred from the Node run.
