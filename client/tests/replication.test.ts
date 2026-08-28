import { describe, expect, it } from 'vitest'
import { MatchPhase, RemoveReason, Weapon, type SnapshotDelta, type UpdatedEntity } from '../src/protocol/generated'
import { SnapshotDeltaBaseline, entityHandleKey, validateUpdateMask } from '../src/foundation/networking/Replication'

const local = {
    handle: { slot: 1, generation: 3 },
    position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
    bodyYaw: 0, aimPitch: 0, grounded: true, stateFlags: 0, health: 100,
    weaponState: { selected: Weapon.Rifle, magazineAmmo: 30, reserveAmmo: 90, stateFlags: 0 },
} as const
const publicState = (slot: number, generation: number, x = 0) => ({
    handle: { slot, generation }, kind: 1,
    position: { x, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
    bodyYaw: 0, aimPitch: 0, grounded: true, stateFlags: 0,
    equippedWeapon: Weapon.Rifle,
}) as const
const delta = (value: Partial<SnapshotDelta> = {}): SnapshotDelta => ({
    snapshotSequence: 1, baselineSequence: 0, baselineRevision: 1,
    baselineReset: true, serverTick: 3, lastProcessedInputSequence: 0,
    matchRevision: 1, match: { phase: MatchPhase.Active, roundNumber: 1, phaseEndsAtTick: 100 },
    local, created: [], updated: [], removed: [], ...value,
})

describe('SnapshotDelta baseline and handles', () => {
    it('accepts every valid field-mask combination and rejects presence mismatches', () => {
        for (let mask = 1; mask <= 127; mask++) {
            const update: UpdatedEntity = {
                handle: { slot: 2, generation: 1 }, changeMask: mask,
                position: mask & 1 ? { x: 1, y: 2, z: 3 } : null,
                velocity: mask & 2 ? { x: 4, y: 5, z: 6 } : null,
                bodyYaw: mask & 4 ? 0.5 : null, aimPitch: mask & 8 ? -0.25 : null,
                grounded: mask & 16 ? false : null, stateFlags: mask & 32 ? 2 : null,
                equippedWeapon: mask & 64 ? Weapon.Shotgun : null,
            }
            expect(() => validateUpdateMask(update)).not.toThrow()
        }
        expect(() => validateUpdateMask({
            handle: { slot: 2, generation: 1 }, changeMask: 1,
            position: null, velocity: null, bodyYaw: null, aimPitch: null,
            grounded: null, stateFlags: null, equippedWeapon: null,
        })).toThrow(/presence/)
        const empty = { handle: { slot: 2, generation: 1 }, changeMask: 0, position: null, velocity: null, bodyYaw: null, aimPitch: null, grounded: null, stateFlags: null, equippedWeapon: null } as const
        expect(() => validateUpdateMask(empty)).toThrow(/empty/)
        expect(() => validateUpdateMask({ ...empty, changeMask: 128 })).toThrow(/unknown field-mask bits/)
    })

    it('requires the immediately previous applied ordered baseline and supports reset after reconnect', () => {
        const baseline = new SnapshotDeltaBaseline()
        baseline.apply(delta({ created: [{ state: publicState(2, 1) }] }))
        expect(() => baseline.apply(delta({ snapshotSequence: 3, baselineSequence: 2, baselineReset: false, match: null }))).toThrow(/baseline mismatch/)
        baseline.clear()
        expect(() => baseline.apply(delta({ snapshotSequence: 10, baselineRevision: 2,
            created: [{ state: publicState(2, 1, 5) }] }))).not.toThrow()
    })

    it('keeps slot reuse distinct by generation and removes only the named handle', () => {
        const baseline = new SnapshotDeltaBaseline()
        baseline.apply(delta({ created: [{ state: publicState(9, 1) }] }))
        const result = baseline.apply(delta({
            snapshotSequence: 2, baselineSequence: 1, baselineReset: false, match: null,
            created: [{ state: publicState(9, 2) }],
            removed: [{ handle: { slot: 9, generation: 1 }, reason: RemoveReason.Destroyed }],
        }))
        expect(result.removedKeys).toEqual([entityHandleKey({ slot: 9, generation: 1 })])
        expect(baseline.get({ slot: 9, generation: 1 })).toBeUndefined()
        expect(baseline.get({ slot: 9, generation: 2 })?.position.x).toBe(0)
    })

    it('public created records cannot carry owner-private health or ammo', () => {
        const state = publicState(3, 1) as unknown as Record<string, unknown>
        expect(state.health).toBeUndefined()
        expect(state.weaponState).toBeUndefined()
        expect(local.health).toBe(100)
    })
})
