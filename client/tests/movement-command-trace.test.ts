import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { movementTraceFixtureUrl, repositoryRoot, runBrowserMovementTrace } from '../tools/movement-trace-adapter'

describe('shared movement command trace', () => {
    it('runs every checkpoint through the browser/WASM adapter within map bounds', async () => {
        const fixture = JSON.parse(await readFile(movementTraceFixtureUrl, 'utf8'))
        const checkpoints = await runBrowserMovementTrace()
        expect(checkpoints.map((checkpoint) => checkpoint.tick)).toEqual(fixture.checkpointTicks)
        for (const [index, checkpoint] of checkpoints.entries()) {
            const reference = fixture.referenceCheckpoints[index]
            expect([...checkpoint.position, ...checkpoint.velocity].every(Number.isFinite)).toBe(true)
            expect(checkpoint.position[0]).toBeGreaterThanOrEqual(-30)
            expect(checkpoint.position[0]).toBeLessThanOrEqual(30)
            expect(checkpoint.position[2]).toBeGreaterThanOrEqual(-24)
            expect(checkpoint.position[2]).toBeLessThanOrEqual(24)
            for (let axis = 0; axis < 3; axis++) {
                expect(Math.abs(checkpoint.position[axis] - reference.position[axis])).toBeLessThanOrEqual(fixture.comparisonTolerance.positionMeters)
                expect(Math.abs(checkpoint.velocity[axis] - reference.velocity[axis])).toBeLessThanOrEqual(fixture.comparisonTolerance.velocityMetersPerSecond)
            }
            if (fixture.comparisonTolerance.groundedMustMatch) expect(checkpoint.grounded).toBe(reference.grounded)
        }
        expect(fixture.comparisonTolerance).toEqual({
            positionMeters: 0.35,
            velocityMetersPerSecond: 0.5,
            groundedMustMatch: true,
        })
    }, 20_000)

    it('runs the identical tuning and command matrix on copper-yard within the same parity envelope', async () => {
        const url = new URL('fixtures/movement/phase7-copper-command-trace.json', repositoryRoot)
        const fixture = JSON.parse(await readFile(url, 'utf8'))
        const checkpoints = await runBrowserMovementTrace(url)
        expect(checkpoints.some((checkpoint) => !checkpoint.grounded)).toBe(true)
        for (const [index, checkpoint] of checkpoints.entries()) {
            expect([...checkpoint.position, ...checkpoint.velocity].every(Number.isFinite)).toBe(true)
            expect(checkpoint.position[0]).toBeGreaterThanOrEqual(-21)
            expect(checkpoint.position[0]).toBeLessThanOrEqual(21)
            expect(checkpoint.position[2]).toBeGreaterThanOrEqual(-33)
            expect(checkpoint.position[2]).toBeLessThanOrEqual(33)
            for (let axis = 0; axis < 3; axis++) {
                expect(Math.abs(checkpoint.position[axis] - fixture.referenceCheckpoints[index].position[axis])).toBeLessThanOrEqual(.35)
                expect(Math.abs(checkpoint.velocity[axis] - fixture.referenceCheckpoints[index].velocity[axis])).toBeLessThanOrEqual(.5)
            }
            expect(checkpoint.grounded).toBe(fixture.referenceCheckpoints[index].grounded)
        }
        const phase0 = JSON.parse(await readFile(movementTraceFixtureUrl, 'utf8'))
        expect(fixture.tuning).toEqual(phase0.tuning)
        expect(fixture.segments.map(({ ticks, forward, right, jumpAt }: any) => ({ ticks, forward, right, jumpAt })))
            .toEqual(phase0.segments.map(({ ticks, forward, right, jumpAt }: any) => ({ ticks, forward, right, jumpAt })))
    }, 20_000)
})
