import { EntityKind, Weapon, type EntityRecord, type InputCommand } from '../src/protocol/generated'
import { describe, expect, it } from 'vitest'
import { PredictionHistory, RemoteEntityTimeline, RemoteTimelineSet, isSequenceNewer } from '../src/foundation/networking/Synchronization'

const command = (sequence: number): InputCommand => ({ sequence, clientTick: sequence, moveX: 0, moveY: -1, buttonFlags: 0, yaw: 0, pitch: 0, selectedWeapon: Weapon.Rifle })
const entity = (x: number, velocityX = 0): EntityRecord => ({ entityId: 8, kind: EntityKind.Player, position: { x, y: 0, z: 0 }, velocity: { x: velocityX, y: 0, z: 0 }, bodyYaw: 0, aimPitch: 0, grounded: true, stateFlags: 0, equippedWeapon: Weapon.Rifle, health: null, weaponState: null })

describe('prediction sequencing and bounded history', () => {
    it('orders uint32 sequences safely across wrap and retains only unacknowledged inputs', () => {
        expect(isSequenceNewer(0, 0xffffffff)).toBe(true)
        expect(isSequenceNewer(0xffffffff, 0)).toBe(false)
        const history = new PredictionHistory(4)
        for (const sequence of [0xfffffffe, 0xffffffff, 0, 1]) history.push({ command: command(sequence), position: { x: sequence, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, sentAtMs: sequence })
        expect(history.acknowledge(0xffffffff).pending.map((entry) => entry.command.sequence)).toEqual([0, 1])
    })
    it('bounds command/state history', () => {
        const history = new PredictionHistory(3)
        for (let sequence = 1; sequence <= 8; sequence++) history.push({ command: command(sequence), position: { x: sequence, y: 0, z: 0 }, velocity: { x: 1, y: 0, z: 0 }, sentAtMs: 0 })
        expect(history.values().map((entry) => entry.command.sequence)).toEqual([6, 7, 8])
    })
})

describe('remote interpolation lifecycle', () => {
    it('buffers interpolation, extrapolates for 250 ms, then freezes', () => {
        const timeline = new RemoteEntityTimeline(60)
        timeline.add(100, entity(0, 6)); timeline.add(106, entity(0.6, 6))
        expect(timeline.sample(103)?.entity.position.x).toBeCloseTo(.3)
        expect(timeline.sample(112)?.mode).toBe('extrapolated')
        const limit = timeline.sample(121)!
        expect(limit.mode).toBe('extrapolated')
        expect(limit.entity.position.x).toBeCloseTo(2.1)
        const frozen = timeline.sample(200)!
        expect(frozen.mode).toBe('frozen')
        expect(frozen.entity.position.x).toBeCloseTo(limit.entity.position.x)
    })
    it('reuses its presentation sample instead of allocating every render frame', () => {
        const timeline = new RemoteEntityTimeline(60)
        timeline.add(1, entity(0, 1)); timeline.add(2, entity(1, 1))
        const sample = timeline.sample(1)!
        expect(timeline.sample(2)).toBe(sample)
        expect(sample.entity.position.x).toBe(1)
    })
    it('cleans remove and disconnect/reconnect lifecycle state', () => {
        const set = new RemoteTimelineSet(60)
        set.add(1, entity(0)); expect(set.ids()).toEqual([8])
        set.remove(8); expect(set.ids()).toEqual([])
        set.add(2, entity(1)); set.clear(); expect(set.entries(2)).toEqual([])
    })
})
