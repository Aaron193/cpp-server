import { describe, expect, it, vi } from 'vitest'
import manifestJson from '../public/maps/graybox-arena/manifest.json'
import { ServiceRegistry } from '../src/foundation/lifecycle'
import { NetworkingModule } from '../src/foundation/networking/NetworkingModule'
import { sha256Identifier } from '../src/foundation/networking/Handshake'
import type { NetworkTransport, TransportCallbacks, TransportState } from '../src/foundation/networking/Transport'
import { ARENA, ENTITY_VIEWS, INPUT, PHYSICS } from '../src/foundation/services'
import { EntityKind, MatchPhase, MessageType, PROTOCOL_VERSION, Weapon, encodeMessage } from '../src/protocol/generated'

class FakeTransport implements NetworkTransport {
    state: TransportState = 'idle'
    callbacks?: TransportCallbacks
    sent: Uint8Array[] = []
    connect(_url: string, callbacks: TransportCallbacks): void { this.callbacks = callbacks; this.state = 'connecting' }
    send(data: Uint8Array): void { this.sent.push(data) }
    update(): void {}
    close(): void { this.state = 'closed' }
}

const configurationJson = JSON.stringify({ movement: { capsuleRadius: .42, capsuleHalfHeight: .48, eyeHeight: 1.62, groundSpeed: 7.5, groundAcceleration: 42, airAcceleration: 12, airControl: .45, jumpSpeed: 6.4, gravity: 20, terminalVelocity: 35, maxSlopeRadians: .78, stepUpHeight: .42, stickToFloorDistance: .5 } })

async function createHarness(options: ConstructorParameters<typeof NetworkingModule>[0] = {}) {
    const transport = new FakeTransport(), services = new ServiceRegistry()
    const position = { x: 0, y: 0, z: 0 }, velocity = { x: 0, y: 0, z: 0 }
    const physics = {
        setExternalDrive: vi.fn(), applyAuthoritativeTuning: vi.fn(async () => {}),
        stepCommand: vi.fn((command: { right: number }) => { position.x += command.right * .1 }),
        setAuthoritativeState: vi.fn((nextPosition: typeof position, nextVelocity: typeof velocity) => { Object.assign(position, nextPosition); Object.assign(velocity, nextVelocity) }),
        get position() { return position }, get velocity() { return velocity },
    }
    const views = { clearAndDispose: vi.fn(), applyRemotePlayer: vi.fn(), removeAndDispose: vi.fn() }
    const manifest = manifestJson as any
    services.provide(ARENA, { mapManifest: manifest } as any)
    services.provide(PHYSICS, physics as any)
    services.provide(INPUT, { snapshot: () => ({ forward: 0, right: 1, jump: false, fire: false, reload: false, selectedWeapon: 1, scoreboard: false }), consumeChatMessages: () => [], angles: { yaw: 0, pitch: 0, set: vi.fn() } } as any)
    services.provide(ENTITY_VIEWS, views as any)
    const module = new NetworkingModule({ ...options, transport, clientBuildId: 'dev', server: { websocketUrl: 'wss://example.invalid/game', buildId: 'dev', protocolVersion: PROTOCOL_VERSION, mapId: manifest.mapId, mode: 'ffa' } })
    module.initialize({ canvas: {} as HTMLCanvasElement, hudRoot: {} as HTMLElement, services })
    module.start(); transport.callbacks!.open()
    const configurationHash = await sha256Identifier(configurationJson)
    const map = { mapId: manifest.mapId, formatVersion: manifest.formatVersion, contentHash: manifest.contentHash }
    transport.callbacks!.message(encodeMessage({ type: MessageType.Welcome, payload: { protocolVersion: PROTOCOL_VERSION, serverBuildId: 'dev', playerId: 7, playerHandle: { slot: 7, generation: 0 }, tickRate: 60, snapshotRate: 20, map, configurationHash } }))
    transport.callbacks!.message(encodeMessage({ type: MessageType.Configuration, payload: { protocolVersion: PROTOCOL_VERSION, serverBuildId: 'dev', map, configurationHash, configurationJson } }))
    await vi.waitFor(() => expect(module.status).toBe('connected'))
    const local = (x: number, y = 0) => ({ entityId: 7, kind: EntityKind.Player, position: { x, y, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, bodyYaw: 0, aimPitch: 0, grounded: true, stateFlags: 0, equippedWeapon: Weapon.Rifle, health: 100, weaponState: { selected: Weapon.Rifle, magazineAmmo: 30, reserveAmmo: 120, stateFlags: 0 } })
    const snapshot = (tick: number, acknowledgement: number, x: number, y = 0) => transport.callbacks!.message(encodeMessage({ type: MessageType.Snapshot, payload: { serverTick: tick, lastProcessedInputSequence: acknowledgement, match: { phase: MatchPhase.Active, roundNumber: 1, phaseEndsAtTick: 600 }, entities: [local(x, y)] } }))
    snapshot(100, 0, 0)
    await vi.waitFor(() => expect(module.latestTick).toBe(100))
    return { module, transport, physics, position, snapshot }
}

describe('prediction reconciliation stability', () => {
    it('preserves the shown position across repeated ordinary corrections and decays only the render residual', async () => {
        const { module, position, snapshot } = await createHarness()
        expect(module.metrics.hardSyncReason).toBe('first-authoritative-snapshot')
        module.update({ deltaSeconds: 1 / 60, elapsedSeconds: 0, frame: 1 })
        const shownBeforeFirst = position.x + module.visualCorrection.x
        snapshot(101, 1, .05)
        await vi.waitFor(() => expect(module.metrics.correctionRevision).toBeGreaterThan(1))
        expect(position.x + module.visualCorrection.x).toBeCloseTo(shownBeforeFirst)
        expect(module.visualCorrection.x).toBeCloseTo(.05)

        module.update({ deltaSeconds: 1 / 60, elapsedSeconds: 0, frame: 2 })
        const shownBeforeSecond = position.x + module.visualCorrection.x
        snapshot(102, 2, .1)
        await vi.waitFor(() => expect(module.latestTick).toBe(102))
        expect(position.x + module.visualCorrection.x).toBeCloseTo(shownBeforeSecond)
        expect(module.visualCorrection.x).toBeGreaterThan(.05)
        expect(module.metrics.hardSyncReason).toBe('first-authoritative-snapshot')
        const residualBeforeHalfLife = module.visualCorrection.x
        for (let frame = 3; frame <= 8; frame++) module.update({ deltaSeconds: 1 / 60, elapsedSeconds: 0, frame })
        expect(module.visualCorrection.x).toBeCloseTo(residualBeforeHalfLife / 2)
        module.dispose()
    })

    it('snaps and clears visual/history state for teleports and respawns with explicit reasons', async () => {
        const { module, transport, position, snapshot } = await createHarness()
        module.update({ deltaSeconds: 1 / 60, elapsedSeconds: 0, frame: 1 })
        snapshot(101, 1, .05)
        await vi.waitFor(() => expect(module.visualCorrection.x).toBeGreaterThan(0))
        snapshot(102, 1, 5)
        await vi.waitFor(() => expect(module.metrics.hardSyncReason).toBe('teleport'))
        expect(module.visualCorrection).toEqual({ x: 0, y: 0, z: 0 })
        expect(position.x).toBe(5)

        transport.callbacks!.message(encodeMessage({ type: MessageType.Respawn, payload: { serverTick: 103, playerId: 7, position: { x: -2, y: 1, z: 3 }, bodyYaw: 1 } }))
        await vi.waitFor(() => expect(module.metrics.hardSyncReason).toBe('respawn'))
        expect(position).toEqual({ x: -2, y: 1, z: 3 })
        expect(module.visualCorrection).toEqual({ x: 0, y: 0, z: 0 })
        module.dispose()
    })

    it('uses independently tunable horizontal and vertical hard-snap thresholds', async () => {
        const { module, snapshot } = await createHarness({ reconciliation: { horizontalHardSnapMeters: 10, verticalHardSnapMeters: .05 } })
        module.update({ deltaSeconds: 1 / 60, elapsedSeconds: 0, frame: 1 })
        snapshot(101, 1, .05, .1)
        await vi.waitFor(() => expect(module.metrics.hardSyncReason).toBe('teleport'))
        expect(module.visualCorrection).toEqual({ x: 0, y: 0, z: 0 })
        module.dispose()
    })

    it('bounds replay telemetry and hard-syncs impossible acknowledgements', async () => {
        const replay = await createHarness()
        for (let frame = 1; frame <= 3; frame++) replay.module.update({ deltaSeconds: 1 / 60, elapsedSeconds: 0, frame })
        replay.snapshot(101, 1, .05)
        await vi.waitFor(() => expect(replay.module.metrics.replaySteps).toBe(2))
        expect(replay.module.metrics.replayTimeMs).toBeGreaterThanOrEqual(0)
        replay.module.dispose()

        const impossible = await createHarness()
        impossible.module.update({ deltaSeconds: 1 / 60, elapsedSeconds: 0, frame: 1 })
        impossible.snapshot(101, 99, 0)
        await vi.waitFor(() => expect(impossible.module.metrics.hardSyncReason).toBe('impossible-acknowledgement'))
        expect(impossible.module.metrics.pendingInputs).toBe(0)
        impossible.module.dispose()
    })

    it('hard-syncs bounded history overflow and drops stalled-frame simulation time', async () => {
        const overflow = await createHarness({ predictionHistoryCapacity: 2 })
        for (let frame = 1; frame <= 3; frame++) overflow.module.update({ deltaSeconds: 1 / 60, elapsedSeconds: 0, frame })
        overflow.snapshot(101, 1, 0)
        await vi.waitFor(() => expect(overflow.module.metrics.hardSyncReason).toBe('history-overflow'))
        expect(overflow.module.metrics.pendingInputs).toBe(0)
        overflow.module.dispose()

        const stalled = await createHarness()
        stalled.module.update({ deltaSeconds: 1, elapsedSeconds: 1, frame: 1 })
        expect(stalled.physics.stepCommand).toHaveBeenCalledTimes(5)
        expect(stalled.module.metrics.droppedSimulationTimeMs).toBeCloseTo(1000 - 5 / 60 * 1000)
        stalled.snapshot(101, 5, 0)
        await vi.waitFor(() => expect(stalled.module.metrics.hardSyncReason).toBe('excessive-clock-discontinuity'))
        stalled.module.dispose()
    })

    it('fences the old reconnect generation and reports the generation hard sync', async () => {
        const { module, transport, snapshot } = await createHarness()
        const oldCallbacks = transport.callbacks!
        module.reconnect()
        expect(module.metrics.hardSyncReason).toBe('reconnect-generation-change')
        snapshot(101, 0, 50)
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(module.latestTick).toBeUndefined()
        oldCallbacks.message(new Uint8Array())
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(module.latestTick).toBeUndefined()
        module.dispose()
    })
})
