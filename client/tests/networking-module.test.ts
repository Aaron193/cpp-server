import { describe, expect, it, vi } from 'vitest'
import manifestJson from '../public/maps/graybox-arena/manifest.json'
import { NetworkingModule } from '../src/foundation/networking/NetworkingModule'
import { sha256Identifier } from '../src/foundation/networking/Handshake'
import type { NetworkTransport, TransportCallbacks, TransportState } from '../src/foundation/networking/Transport'
import { ServiceRegistry } from '../src/foundation/lifecycle'
import { ARENA, ENTITY_VIEWS, INPUT, PHYSICS } from '../src/foundation/services'
import { ChatChannel, EntityKind, MatchPhase, MessageType, PROTOCOL_VERSION, RoundTransitionKind, Weapon, decodeEnvelope, encodeMessage } from '../src/protocol/generated'

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
        const transport = new FakeTransport(), services = new ServiceRegistry()
        const manifest = manifestJson as any
        const physics = { setExternalDrive: vi.fn(), applyAuthoritativeTuning: vi.fn(async () => {}), stepCommand: vi.fn(), setAuthoritativeState: vi.fn(), position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } }
        const views = { clearAndDispose: vi.fn(), applyRemotePlayer: vi.fn(), removeAndDispose: vi.fn() }
        services.provide(ARENA, { mapManifest: manifest } as any)
        services.provide(PHYSICS, physics as any)
        services.provide(INPUT, { snapshot: () => ({ forward: 0, right: 0, jump: false, fire: true, reload: true, selectedWeapon: 2, scoreboard: false }), consumeChatMessages: () => [], angles: { yaw: 0, pitch: 0 } } as any)
        services.provide(ENTITY_VIEWS, views as any)
        const fullUrl = 'wss://edge.example/game/socket?ticket=do-not-rewrite'
        const module = new NetworkingModule({ transport, clientBuildId: 'dev', server: { websocketUrl: fullUrl, buildId: 'dev', protocolVersion: PROTOCOL_VERSION, mapId: manifest.mapId, mode: 'ffa' } })
        module.initialize({ canvas: {} as HTMLCanvasElement, hudRoot: {} as HTMLElement, services })
        module.start(); expect(transport.urls).toEqual([fullUrl])
        transport.callbacks!.open()
        const hello = decodeEnvelope(transport.sent[0]!)
        expect(hello.known && hello.message.type).toBe(MessageType.Hello)

        const configurationJson = JSON.stringify({ movement: { capsuleRadius: .42, capsuleHalfHeight: .48, eyeHeight: 1.62, groundSpeed: 7.5, groundAcceleration: 42, airAcceleration: 12, airControl: .45, jumpSpeed: 6.4, gravity: 20, terminalVelocity: 35, maxSlopeRadians: .78, stepUpHeight: .42, stickToFloorDistance: .5 } })
        const configurationHash = await sha256Identifier(configurationJson)
        const map = { mapId: manifest.mapId, formatVersion: manifest.formatVersion, contentHash: manifest.contentHash }
        transport.callbacks!.message(encodeMessage({ type: MessageType.Welcome, payload: { protocolVersion: PROTOCOL_VERSION, serverBuildId: 'dev', playerId: 7, tickRate: 60, snapshotRate: 20, map, configurationHash } }))
        transport.callbacks!.message(encodeMessage({ type: MessageType.Configuration, payload: { protocolVersion: PROTOCOL_VERSION, serverBuildId: 'dev', map, configurationHash, configurationJson } }))
        await vi.waitFor(() => expect(module.status).toBe('connected'))
        expect(physics.applyAuthoritativeTuning).toHaveBeenCalledOnce()
        module.update({ deltaSeconds: 1 / 60, elapsedSeconds: 0, frame: 0 })
        expect(transport.sent.some((bytes) => { const value = decodeEnvelope(bytes); return value.known && value.message.type === MessageType.InputBatch })).toBe(false)

        const remote = { entityId: 9, kind: EntityKind.Player, position: { x: 1, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, bodyYaw: 0, aimPitch: 0, grounded: true, stateFlags: 0, equippedWeapon: Weapon.Rifle, health: null, weaponState: null }
        const local = { ...remote, entityId: 7, health: 90, equippedWeapon: Weapon.Shotgun, weaponState: { selected: Weapon.Shotgun, magazineAmmo: 5, reserveAmmo: 20, stateFlags: 0 } }
        transport.callbacks!.message(encodeMessage({ type: MessageType.Snapshot, payload: { serverTick: 100, lastProcessedInputSequence: 0, match: { phase: MatchPhase.Active, roundNumber: 1, phaseEndsAtTick: 600 }, entities: [local, remote] } }))
        await vi.waitFor(() => expect(module.metrics.remotePlayers).toBe(1))
        expect(module.combat.localPlayer).toMatchObject({ health: 90, magazineAmmo: 5, weapon: Weapon.Shotgun })
        transport.callbacks!.message(encodeMessage({ type: MessageType.Damage, payload: { serverTick: 101, sourceId: 7, targetId: 9, amount: 10, remainingHealth: 90 } }))
        transport.callbacks!.message(encodeMessage({ type: MessageType.ScoreChange, payload: { serverTick: 101, playerId: 7, score: 10, delta: 10, kills: 1, deaths: 0 } }))
        transport.callbacks!.message(encodeMessage({ type: MessageType.RoundTransition, payload: { serverTick: 102, transition: RoundTransitionKind.Intermission, match: { phase: MatchPhase.Intermission, roundNumber: 1, phaseEndsAtTick: 200 } } }))
        transport.callbacks!.message(encodeMessage({ type: MessageType.Chat, payload: { senderId: 7, channel: ChatChannel.Global, text: 'gg' } }))
        await vi.waitFor(() => expect(module.combat.scores[0]?.kills).toBe(1))
        expect(module.combat.chatMessages[0]?.text).toBe('gg'); expect(module.combat.match.phase).toBe(MatchPhase.Intermission)
        module.update({ deltaSeconds: 1 / 60, elapsedSeconds: 1, frame: 1 })
        const batch = transport.sent.map((bytes) => decodeEnvelope(bytes)).reverse().find((value) => value.known && value.message.type === MessageType.InputBatch)
        expect(batch?.known && batch.message.type === MessageType.InputBatch && batch.message.payload.commands[0]).toMatchObject({ clientTick: 101, buttonFlags: 6, selectedWeapon: Weapon.Shotgun })
        module.reconnect()
        expect(module.status).toBe('reconnecting')
        expect(module.metrics.remotePlayers).toBe(0)
        expect(views.clearAndDispose).toHaveBeenCalled()
        module.update({ deltaSeconds: 0, elapsedSeconds: 0, frame: 0 })
        expect(transport.urls).toEqual([fullUrl, fullUrl])
        transport.callbacks!.open()
        transport.callbacks!.message(encodeMessage({ type: MessageType.Welcome, payload: { protocolVersion: PROTOCOL_VERSION, serverBuildId: 'dev', playerId: 8, tickRate: 60, snapshotRate: 20, map, configurationHash } }))
        transport.callbacks!.message(encodeMessage({ type: MessageType.Configuration, payload: { protocolVersion: PROTOCOL_VERSION, serverBuildId: 'dev', map, configurationHash, configurationJson } }))
        await vi.waitFor(() => expect(module.status).toBe('connected'))
        const restartedLocal = { ...local, entityId: 8 }
        transport.callbacks!.message(encodeMessage({ type: MessageType.Snapshot, payload: { serverTick: 5, lastProcessedInputSequence: 0, match: { phase: MatchPhase.Active, roundNumber: 1, phaseEndsAtTick: 600 }, entities: [restartedLocal] } }))
        await vi.waitFor(() => expect(module.combat.localPlayer.playerId).toBe(8))
        module.update({ deltaSeconds: 1 / 60, elapsedSeconds: 2, frame: 2 })
        const restartedBatch = transport.sent.map((bytes) => decodeEnvelope(bytes)).reverse().find((value) => value.known && value.message.type === MessageType.InputBatch)
        expect(restartedBatch?.known && restartedBatch.message.type === MessageType.InputBatch && restartedBatch.message.payload.commands[0]).toMatchObject({ sequence: 1, clientTick: 6 })
        module.dispose()
    })
})
