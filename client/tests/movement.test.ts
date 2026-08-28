import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_MOVEMENT_TUNING, FixedStepAccumulator, stepMovementVelocity } from '../src/foundation/physics/Movement'

describe('fixed-step local movement motor', () => {
    it('accelerates to configured ground speed in right-handed -Z forward', () => {
        let velocity = { x: 0, y: 0, z: 0 }
        for (let tick = 0; tick < 60; tick++) velocity = stepMovementVelocity(velocity, { forward: 1, right: 0, jump: false, yaw: 0 }, true, 1 / 60)
        expect(velocity.x).toBeCloseTo(0)
        expect(velocity.z).toBeCloseTo(-DEFAULT_MOVEMENT_TUNING.groundSpeed)
    })

    it('jumps only while grounded and clamps falling speed', () => {
        const jumped = stepMovementVelocity({ x: 0, y: 0, z: 0 }, { forward: 0, right: 0, jump: true, yaw: 0 }, true, 1 / 60)
        expect(jumped.y).toBeCloseTo(DEFAULT_MOVEMENT_TUNING.jumpSpeed - DEFAULT_MOVEMENT_TUNING.gravity / 60)
        let falling = jumped
        for (let tick = 0; tick < 600; tick++) falling = stepMovementVelocity(falling, { forward: 0, right: 0, jump: false, yaw: 0 }, false, 1 / 60)
        expect(falling.y).toBe(-DEFAULT_MOVEMENT_TUNING.terminalVelocity)
    })

    it('matches the authoritative grounded and moving-platform vertical rules', () => {
        const dt = 1 / 60
        const grounded = stepMovementVelocity(
            { x: 0, y: -0.05, z: 0 },
            { forward: 0, right: 0, jump: false, yaw: 0 },
            true, dt, DEFAULT_MOVEMENT_TUNING, 1.5
        )
        expect(grounded.y).toBeCloseTo(1.5 - DEFAULT_MOVEMENT_TUNING.gravity * dt)

        const separating = stepMovementVelocity(
            { x: 0, y: 2, z: 0 },
            { forward: 0, right: 0, jump: true, yaw: 0 },
            true, dt, DEFAULT_MOVEMENT_TUNING, 0
        )
        expect(separating.y).toBeCloseTo(2 - DEFAULT_MOVEMENT_TUNING.gravity * dt)
    })

    it('runs deterministic 60 Hz steps with bounded catch-up', () => {
        const accumulator = new FixedStepAccumulator()
        const step = vi.fn()
        expect(accumulator.consume(1 / 30, step)).toBe(2)
        expect(accumulator.consume(10, step)).toBe(5)
        expect(step).toHaveBeenCalledTimes(7)
        expect(accumulator.lastDroppedSeconds).toBeCloseTo(10 - 5 / 60)
        expect(accumulator.totalDroppedSeconds).toBeCloseTo(10 - 5 / 60)
    })
})
