import { performance } from 'node:perf_hooks'
import { ProfileStats } from '../src/foundation/performance/ProfileStats'

// Honest headless baseline: GPU fields stay null when Node has no browser graphics context.
const samples = new ProfileStats(600)
let allocationProxy = 0
for (let frame = 0; frame < 600; frame++) {
    const started = performance.now()
    for (let index = 0; index < 2_000; index++) allocationProxy = (allocationProxy + index + frame) >>> 0
    samples.add(performance.now() - started)
}
const timing = samples.snapshot()
const report = {
    environment: 'node-headless', resolution: '1920x1080',
    webgl2: null, webgpu: typeof (globalThis.navigator as (Navigator & { gpu?: unknown }) | undefined)?.gpu !== 'undefined' || null,
    frameTimeMedianMs: timing.p50, frameTimeP95Ms: timing.p95,
    drawCalls: null, activeMeshes: null, allocationProxyOperations: 600 * 2_000, checksum: allocationProxy,
    note: 'Null graphics fields mean no browser GPU context was available; no hardware capability is asserted.',
}
console.log(JSON.stringify(report, null, 2))
