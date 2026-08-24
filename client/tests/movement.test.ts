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
        expect(jumped.y).toBe(DEFAULT_MOVEMENT_TUNING.jumpSpeed)
        let falling = jumped
        for (let tick = 0; tick < 600; tick++) falling = stepMovementVelocity(falling, { forward: 0, right: 0, jump: false, yaw: 0 }, false, 1 / 60)
        expect(falling.y).toBe(-DEFAULT_MOVEMENT_TUNING.terminalVelocity)
    })

    it('runs deterministic 60 Hz steps with bounded catch-up', () => {
        const accumulator = new FixedStepAccumulator()
        const step = vi.fn()
        expect(accumulator.consume(1 / 30, step)).toBe(2)
        expect(accumulator.consume(10, step)).toBe(15)
        expect(step).toHaveBeenCalledTimes(17)
    })
})
