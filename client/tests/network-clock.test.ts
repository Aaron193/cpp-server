import { describe, expect, it } from 'vitest'
import { AdaptiveInterpolationDelay, NetworkClock, RemoteEntityTimeline, RemoteTimelineSet } from '../src/foundation/networking/Synchronization'
import { EntityKind, MovementMode, Stance, Weapon, type EntityRecord } from '../src/protocol/generated'

const entity = (x: number, yaw = 0, velocityX = 0): EntityRecord => ({
    entityId: 8, kind: EntityKind.Player, position: { x, y: 0, z: 0 }, velocity: { x: velocityX, y: 0, z: 0 },
    bodyYaw: yaw, aimPitch: 0, grounded: true, stateFlags: 0, stance: Stance.Standing, movementMode: MovementMode.Normal, equippedWeapon: Weapon.Rifle,
})

describe('NetworkClock', () => {
    it('smooths RTT/deviation and maps client monotonic time to a server tick anchor', () => {
        const clock = new NetworkClock(60)
        const first = clock.beginPing(0)
        expect(clock.acceptPong({ pingId: first, serverTick: 600, serverMonotonicMs: 10_000 }, 100)).toEqual({ accepted: true, discontinuity: false })
        expect(clock.state(100)).toMatchObject({ rttMs: 100, deviationMs: 50, offsetMs: 9950, sampleCount: 1 })
        const second = clock.beginPing(500)
        clock.acceptPong({ pingId: second, serverTick: 630, serverMonotonicMs: 10_500 }, 580)
        const state = clock.state(580)
        expect(state.rttMs).toBeCloseTo(97.5)
        expect(state.deviationMs).toBeCloseTo(42.5)
        expect(state.confidence).toBeGreaterThan(0)
        expect(clock.estimatedServerTick(1080)).toBe(661)
        expect(clock.state(6080).confidence).toBeLessThan(state.confidence)
    })

    it('unwraps server milliseconds and tick anchors across uint32 wrap', () => {
        const clock = new NetworkClock(60)
        const first = clock.beginPing(0)
        clock.acceptPong({ pingId: first, serverTick: 0xffff_fffe, serverMonotonicMs: 0xffff_fff0 }, 20)
        const second = clock.beginPing(20)
        const result = clock.acceptPong({ pingId: second, serverTick: 0, serverMonotonicMs: 0x10 }, 52)
        expect(result).toEqual({ accepted: true, discontinuity: false })
        expect(clock.estimatedServerTick(68)).toBe(1)
    })

    it('rejects unknown pongs and resets confidence on a discontinuity', () => {
        const clock = new NetworkClock(60)
        expect(clock.acceptPong({ pingId: 99, serverTick: 1, serverMonotonicMs: 1 }, 1).accepted).toBe(false)
        const first = clock.beginPing(0)
        clock.acceptPong({ pingId: first, serverTick: 60, serverMonotonicMs: 1000 }, 100)
        const second = clock.beginPing(200)
        expect(clock.acceptPong({ pingId: second, serverTick: 61, serverMonotonicMs: 5000 }, 300).discontinuity).toBe(true)
        expect(clock.state(300).sampleCount).toBe(1)
        clock.reset()
        expect(clock.state(300).confidence).toBe(0)
        expect(clock.estimatedServerTick(300)).toBeUndefined()
    })
})

describe('adaptive remote interpolation', () => {
    it('widens after an arrival gap, narrows on a calm link, and remains bounded', () => {
        const delay = new AdaptiveInterpolationDelay(20)
        expect(delay.delayMs).toBe(100)
        delay.observeArrival(0); delay.observeArrival(250)
        expect(delay.delayMs).toBe(250)
        for (let index = 1; index <= 80; index++) delay.observeArrival(250 + index * 50)
        expect(delay.delayMs).toBeGreaterThanOrEqual(100)
        expect(delay.delayMs).toBeLessThan(101)
    })

    it('interpolates adjacent samples over the shortest angle arc, then extrapolates and freezes with telemetry', () => {
        const timeline = new RemoteEntityTimeline(60, 32, 200)
        timeline.add(100, entity(0, Math.PI - 0.1, 5)); timeline.add(106, entity(0.5, -Math.PI + 0.1, 5))
        const middle = timeline.sample(103)!
        expect(middle.mode).toBe('interpolated')
        expect(Math.abs(Math.abs(middle.entity.bodyYaw) - Math.PI)).toBeLessThan(0.01)
        expect(timeline.sample(112)?.mode).toBe('extrapolated')
        expect(timeline.sample(200)?.mode).toBe('frozen')

        const set = new RemoteTimelineSet(60)
        set.add(100, entity(0)); set.add(106, entity(1))
        set.forEachSample(90, () => {})
        set.forEachSample(103, () => {})
        set.forEachSample(110, () => {})
        set.forEachSample(200, () => {})
        expect(set.telemetry).toMatchObject({ interpolatedSamples: 1, extrapolatedSamples: 1, frozenSamples: 2, underflows: 2, overflows: 1 })
    })
})
