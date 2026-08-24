import { describe, expect, it } from 'vitest'
import { aimAtCapsule, alignHarnessTick, chooseAliveTarget, isHarnessTickNewer, nextHarnessTick, shouldRequireActivity, shouldRequireIndividualMovement, type HarnessPose } from '../bots_test/harness-helpers'

const pose = (entityId: number, x: number, z: number, dead = false): HarnessPose => ({ entityId, x, y: 0, z, dead })

describe('live harness deterministic helpers', () => {
    it('aligns the first command to server time and wraps monotonically', () => {
        expect(alignHarnessTick(5)).toBe(5)
        expect(nextHarnessTick(5)).toBe(6)
        expect(nextHarnessTick(0xffffffff)).toBe(0)
        expect(isHarnessTickNewer(0, 0xffffffff)).toBe(true)
        expect(isHarnessTickNewer(4, 5)).toBe(false)
        expect(shouldRequireActivity(0)).toBe(false)
        expect(shouldRequireActivity(1)).toBe(true)
        expect(shouldRequireIndividualMovement(1, false)).toBe(true)
        expect(shouldRequireIndividualMovement(1, true)).toBe(false)
        expect(shouldRequireIndividualMovement(0, false)).toBe(false)
    })
    it('selects an alive remote and computes protocol yaw/pitch toward its capsule', () => {
        const own = pose(1, 0, 0), north = pose(2, 0, -10), deadNear = pose(3, 0, -2, true)
        const target = chooseAliveTarget(new Map([[1, own], [2, north], [3, deadNear]]), own)
        expect(target?.entityId).toBe(2)
        const aim = aimAtCapsule(own, target!)
        expect(aim.yaw).toBeCloseTo(0)
        expect(aim.pitch).toBeLessThan(0)
        expect(aim.moveY).toBe(-1)
    })
    it('aims right using positive protocol yaw and stops inside engagement range', () => {
        const aim = aimAtCapsule(pose(1, 0, 0), pose(2, 2, 0))
        expect(aim.yaw).toBeCloseTo(Math.PI / 2)
        expect(aim.moveY).toBe(0)
    })
})
