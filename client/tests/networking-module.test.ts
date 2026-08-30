import { describe, expect, it, vi } from 'vitest'
import manifestJson from '../public/maps/graybox-arena/manifest.json'
import { NetworkingModule } from '../src/foundation/networking/NetworkingModule'
import { sha256Identifier } from '../src/foundation/networking/Handshake'
import type { NetworkTransport, TransportCallbacks, TransportState } from '../src/foundation/networking/Transport'
import { ServiceRegistry } from '../src/foundation/lifecycle'
import { ARENA, ENTITY_VIEWS, INPUT, PHYSICS } from '../src/foundation/services'
import { DEFAULT_MOVEMENT_TUNING } from '../src/foundation/physics/Movement'
import { ChatChannel, EntityKind, MatchPhase, MessageType, MovementMode, PROTOCOL_VERSION, RoundTransitionKind, Stance, Weapon, decodeEnvelope, encodeMessage } from '../src/protocol/generated'

const movementState = { stance: Stance.Standing, mode: MovementMode.Normal, modeTimeRemaining: 0, dashCooldownRemaining: 0, slideCooldownRemaining: 0, weaponLockRemaining: 0, stanceExpansionPending: false, dashDirection: { x: 0, y: 0, z: -1 }, mantleStart: { x: 0, y: 0, z: 0 }, mantleTarget: { x: 0, y: 0, z: 0 } } as const

class FakeTransport implements NetworkTransport {
    state: TransportState = 'idle'
    callbacks?: TransportCallbacks
    urls: string[] = []
    sent: Uint8Array[] = []
    connect(url: string, callbacks: TransportCallbacks): void { this.urls.push(url); this.callbacks = callbacks; this.state = 'connecting' }
    send(data: Uint8Array): void { this.sent.push(data) }
    update(): void {}
    close(): void { this.state = 'closed' }
}

describe('NetworkingModule integration lifecycle', () => {
    it('handshakes, applies configuration, and cleans state before reconnect', async () => {
        let now = 1000
        const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now)
        const transport = new FakeTransport(), services = new ServiceRegistry()
        const manifest = manifestJson as any
        const physics = { setExternalDrive: vi.fn(), applyAuthoritativeTuning: vi.fn(async () => {}), stepCommand: vi.fn(), setAuthoritativeState: vi.fn(), position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } }
        const views = { clearAndDispose: vi.fn(), applyRemotePlayer: vi.fn(), removeAndDispose: vi.fn() }
        services.provide(ARENA, { mapManifest: manifest } as any)
        services.provide(PHYSICS, physics as any)
        const angles = { yaw: 0, pitch: 0, set: vi.fn() }
        services.provide(INPUT, { snapshot: () => ({ forward: 0, right: 0, jump: false, fire: true, reload: true, selectedWeapon: 2, scoreboard: false }), consumeChatMessages: () => [], angles } as any)
        services.provide(ENTITY_VIEWS, views as any)
        const fullUrl = 'wss://edge.example/game/socket?ticket=do-not-rewrite'
        const refreshedUrl = 'wss://edge.example/game/socket?fresh=1'
        const joinTicketProvider = vi.fn(async () => ({ websocketUrl: refreshedUrl, ticket: 'fresh-ticket' }))
        const module = new NetworkingModule({ transport, clientBuildId: 'dev', accessToken: 'initial-ticket', joinTicketProvider, server: { websocketUrl: fullUrl, buildId: 'dev', protocolVersion: PROTOCOL_VERSION, mapId: manifest.mapId, mode: 'ffa' } })
        module.initialize({ canvas: {} as HTMLCanvasElement, hudRoot: {} as HTMLElement, services })
        module.start(); expect(transport.urls).toEqual([fullUrl])
        transport.callbacks!.open()
        const hello = decodeEnvelope(transport.sent[0]!)
        expect(hello.known && hello.message.type).toBe(MessageType.Hello)

        const configurationJson = JSON.stringify({ movement: DEFAULT_MOVEMENT_TUNING })
        const configurationHash = await sha256Identifier(configurationJson)
        const map = { mapId: manifest.mapId, formatVersion: manifest.formatVersion, contentHash: manifest.contentHash }
        transport.callbacks!.message(encodeMessage({ type: MessageType.Welcome, payload: { protocolVersion: PROTOCOL_VERSION, serverBuildId: 'dev', playerId: 7, playerHandle: { slot: 7, generation: 0 }, tickRate: 60, snapshotRate: 20, map, configurationHash } }))
        transport.callbacks!.message(encodeMessage({ type: MessageType.Configuration, payload: { protocolVersion: PROTOCOL_VERSION, serverBuildId: 'dev', map, configurationHash, configurationJson } }))
        await vi.waitFor(() => expect(module.status).toBe('connected'))
        expect(physics.applyAuthoritativeTuning).toHaveBeenCalledOnce()
        module.update({ deltaSeconds: 1 / 60, elapsedSeconds: 0, frame: 0 })
        expect(transport.sent.some((bytes) => { const value = decodeEnvelope(bytes); return value.known && value.message.type === MessageType.InputBatch })).toBe(false)
        expect(transport.sent.filter((bytes) => { const value = decodeEnvelope(bytes); return value.known && value.message.type === MessageType.Ping })).toHaveLength(1)
        now = 1499; module.update({ deltaSeconds: 0, elapsedSeconds: 0, frame: 0 })
        expect(transport.sent.filter((bytes) => { const value = decodeEnvelope(bytes); return value.known && value.message.type === MessageType.Ping })).toHaveLength(1)
        now = 1500; module.update({ deltaSeconds: 0, elapsedSeconds: 0, frame: 0 })
        const pings = transport.sent.map((bytes) => decodeEnvelope(bytes)).filter((value) => value.known && value.message.type === MessageType.Ping)
        expect(pings).toHaveLength(2)
        const latestPing = pings[1]
        if (!latestPing?.known || latestPing.message.type !== MessageType.Ping) throw new Error('missing clock ping')
        now = 1550
        transport.callbacks!.message(encodeMessage({ type: MessageType.Pong, payload: { pingId: latestPing.message.payload.pingId, serverTick: 100, serverMonotonicMs: 5000 } }))
        await vi.waitFor(() => expect(module.metrics.clockConfidence).toBeGreaterThan(0))
        expect(module.serverTickNow).toBe(101)
        expect(module.matchCountdownSeconds(160)).toBe(1)

        const remote = { entityId: 9, kind: EntityKind.Player, position: { x: 1, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, bodyYaw: 0, aimPitch: 0, grounded: true, stateFlags: 0, stance: Stance.Standing, movementMode: MovementMode.Normal, equippedWeapon: Weapon.Rifle, health: null, weaponState: null }
        const local = { ...remote, entityId: 7, health: 90, equippedWeapon: Weapon.Shotgun, weaponState: { selected: Weapon.Shotgun, magazineAmmo: 0, reserveAmmo: 20, stateFlags: 0 } }
        transport.callbacks!.message(encodeMessage({ type: MessageType.SnapshotDelta, payload: {
            snapshotSequence: 1, baselineSequence: 0, baselineRevision: 1, baselineReset: true,
            serverTick: 100, lastProcessedInputSequence: 0, matchRevision: 1,
            match: { phase: MatchPhase.Active, roundNumber: 1, phaseEndsAtTick: 600 },
            local: { handle: { slot: 7, generation: 0 }, position: local.position, velocity: local.velocity,
                bodyYaw: local.bodyYaw, aimPitch: local.aimPitch, grounded: local.grounded,
                stateFlags: local.stateFlags, health: 90, movementState,
                weaponState: { selected: Weapon.Shotgun, magazineAmmo: 0, reserveAmmo: 20, stateFlags: 0 } },
            created: [{ state: { handle: { slot: 9, generation: 0 }, kind: remote.kind,
                position: remote.position, velocity: remote.velocity, bodyYaw: remote.bodyYaw,
                aimPitch: remote.aimPitch, grounded: remote.grounded, stateFlags: remote.stateFlags, stance: remote.stance, movementMode: remote.movementMode,
                equippedWeapon: remote.equippedWeapon } }], updated: [], removed: [],
        } }))
        await vi.waitFor(() => expect(module.metrics.remotePlayers).toBe(1))
        expect(angles.set).toHaveBeenCalledWith(local.bodyYaw, local.aimPitch)
        expect(module.combat.localPlayer).toMatchObject({ health: 90, magazineAmmo: 0, weapon: Weapon.Shotgun })
        transport.callbacks!.message(encodeMessage({ type: MessageType.Damage, payload: { serverTick: 101, sourceId: 7, targetId: 9, amount: 10, remainingHealth: 90 } }))
        transport.callbacks!.message(encodeMessage({ type: MessageType.ScoreChange, payload: { serverTick: 101, playerId: 7, score: 10, delta: 10, kills: 1, deaths: 0 } }))
        transport.callbacks!.message(encodeMessage({ type: MessageType.RoundTransition, payload: { serverTick: 102, transition: RoundTransitionKind.Intermission, match: { phase: MatchPhase.Intermission, roundNumber: 1, phaseEndsAtTick: 200 } } }))
        transport.callbacks!.message(encodeMessage({ type: MessageType.Chat, payload: { senderId: 7, channel: ChatChannel.Global, text: 'gg' } }))
        await vi.waitFor(() => expect(module.combat.scores[0]?.kills).toBe(1))
        expect(module.combat.chatMessages[0]?.text).toBe('gg'); expect(module.combat.match.phase).toBe(MatchPhase.Intermission)
        module.update({ deltaSeconds: 1 / 60, elapsedSeconds: 1, frame: 1 })
        const batch = transport.sent.map((bytes) => decodeEnvelope(bytes)).reverse().find((value) => value.known && value.message.type === MessageType.InputBatch)
        expect(batch?.known && batch.message.type === MessageType.InputBatch && batch.message.payload.commands[0]).toMatchObject({ clientTick: 101, buttonFlags: 4, fireActionId: 0, selectedWeapon: Weapon.Shotgun })
        expect(module.combat.eventsAfter(0).some((event) => event.kind === 'local-fire')).toBe(false)
        module.reconnect()
        expect(module.status).toBe('reconnecting')
        expect(module.metrics.remotePlayers).toBe(0)
        expect(module.metrics.clockConfidence).toBe(0)
        expect(views.clearAndDispose).toHaveBeenCalled()
        module.update({ deltaSeconds: 0, elapsedSeconds: 0, frame: 0 })
        await vi.waitFor(() => expect(transport.urls).toEqual([fullUrl, refreshedUrl]))
        expect(joinTicketProvider).toHaveBeenCalledOnce()
        transport.callbacks!.open()
        const refreshedHello = decodeEnvelope(transport.sent.at(-1)!)
        expect(refreshedHello.known && refreshedHello.message.type === MessageType.Hello && refreshedHello.message.payload.accessToken).toBe('fresh-ticket')
        transport.callbacks!.message(encodeMessage({ type: MessageType.Welcome, payload: { protocolVersion: PROTOCOL_VERSION, serverBuildId: 'dev', playerId: 8, playerHandle: { slot: 8, generation: 0 }, tickRate: 60, snapshotRate: 20, map, configurationHash } }))
        transport.callbacks!.message(encodeMessage({ type: MessageType.Configuration, payload: { protocolVersion: PROTOCOL_VERSION, serverBuildId: 'dev', map, configurationHash, configurationJson } }))
        await vi.waitFor(() => expect(module.status).toBe('connected'))
        transport.callbacks!.message(encodeMessage({ type: MessageType.SnapshotDelta, payload: {
            snapshotSequence: 1, baselineSequence: 0, baselineRevision: 1, baselineReset: true,
            serverTick: 5, lastProcessedInputSequence: 0, matchRevision: 1,
            match: { phase: MatchPhase.Active, roundNumber: 1, phaseEndsAtTick: 600 },
            local: { handle: { slot: 8, generation: 0 }, position: local.position, velocity: local.velocity,
                bodyYaw: local.bodyYaw, aimPitch: local.aimPitch, grounded: local.grounded,
                stateFlags: local.stateFlags, health: 100, movementState,
                weaponState: { selected: Weapon.Rifle, magazineAmmo: 30, reserveAmmo: 90, stateFlags: 0 } },
            created: [], updated: [], removed: [],
        } }))
        await vi.waitFor(() => expect(module.combat.localPlayer.playerId).toBe(8))
        module.update({ deltaSeconds: 1 / 60, elapsedSeconds: 2, frame: 2 })
        const restartedBatch = transport.sent.map((bytes) => decodeEnvelope(bytes)).reverse().find((value) => value.known && value.message.type === MessageType.InputBatch)
        expect(restartedBatch?.known && restartedBatch.message.type === MessageType.InputBatch && restartedBatch.message.payload.commands[0]).toMatchObject({ sequence: 1, clientTick: 6 })
        module.dispose()
        nowSpy.mockRestore()
    })
})
