import { describe, expect, it } from 'vitest'
import { PHASE7_COVERAGE, phase7Scenarios, runBoundedSoak, runPhase7Hardening } from '../src/foundation/hardening/Phase7Harness'

describe('Phase 7 production hardening matrix', () => {
    it('covers every required axis with a bounded pairwise scenario set', () => {
        const scenarios = phase7Scenarios()
        expect(scenarios.length).toBeLessThan(50)
        for (const fps of PHASE7_COVERAGE.fps) expect(scenarios.some((scenario) => scenario.fps === fps)).toBe(true)
        for (const rtt of PHASE7_COVERAGE.rttMs) expect(scenarios.some((scenario) => scenario.rttMs === rtt)).toBe(true)
        for (const jitter of PHASE7_COVERAGE.jitterMs) expect(scenarios.some((scenario) => scenario.jitterMs === jitter)).toBe(true)
        for (const stall of PHASE7_COVERAGE.stallMs) expect(scenarios.some((scenario) => scenario.stallMs === stall)).toBe(true)
        for (const action of PHASE7_COVERAGE.reconnectAt) expect(scenarios.some((scenario) => scenario.reconnectAt === action)).toBe(true)
        for (const recovery of PHASE7_COVERAGE.recovery) expect(scenarios.some((scenario) => scenario.recovery === recovery)).toBe(true)
    })

    it('gates the captured prediction, clock, interpolation, replication and queue distributions', () => {
        const report = runPhase7Hardening()
        expect(report.checks).toEqual(Object.fromEntries(Object.keys(report.checks).map((key) => [key, true])))
        expect(report.network.commands.accepted).toBeGreaterThan(0)
        expect(report.network.commands.held).toBeGreaterThan(0)
        expect(report.network.replication.changedFields.count).toBeGreaterThan(0)
        expect(report.network.backpressure.coalescedSnapshots).toBeGreaterThan(0)
        expect(report.passed).toBe(true)
    })

    it('accelerates thirty simulated minutes without growing any bounded family', () => {
        const soak = runBoundedSoak(30)
        expect(soak.highWater).toEqual(expect.objectContaining({ predictionHistory: expect.any(Number), killcamPoses: 7680, killcamEvents: 256 }))
        expect(soak.passed).toBe(true)
    })
})
