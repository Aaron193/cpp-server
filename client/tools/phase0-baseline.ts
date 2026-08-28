import { performance as nodePerformance } from 'node:perf_hooks'
import { readFile } from 'node:fs/promises'
import manifestJson from '../public/maps/graybox-arena/manifest.json' with { type: 'json' }
import { parseCollisionMesh } from '../src/foundation/assets/CollisionMesh'
import { parseMapManifest } from '../src/foundation/assets/MapManifest'
import { sha256Identifier } from '../src/foundation/networking/Handshake'
import { NetworkingModule } from '../src/foundation/networking/NetworkingModule'
import type { NetworkTransport, TransportCallbacks, TransportState } from '../src/foundation/networking/Transport'
import { ServiceRegistry } from '../src/foundation/lifecycle'
import { ARENA, ENTITY_VIEWS, INPUT, PHYSICS } from '../src/foundation/services'
import { EntityKind, MatchPhase, MessageType, PROTOCOL_VERSION, Weapon, encodeMessage } from '../src/protocol/generated'

class BaselineTransport implements NetworkTransport {
    state: TransportState = 'idle'
    callbacks?: TransportCallbacks
    sent: Uint8Array[] = []
    connect(_url: string, callbacks: TransportCallbacks): void { this.callbacks = callbacks; this.state = 'connecting' }
    send(data: Uint8Array): void { this.sent.push(data) }
    update(): void {}
    close(): void { this.state = 'closed' }
}

function distribution(values: readonly number[]): object {
    const ordered = [...values].sort((a, b) => a - b)
    const at = (fraction: number) => ordered[Math.min(ordered.length - 1, Math.max(0, Math.ceil(ordered.length * fraction) - 1))] ?? 0
    return { count: ordered.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: ordered.at(-1) ?? 0 }
}

const settleMessages = async (): Promise<void> => {
    for (let count = 0; count < 4; count++) await new Promise<void>((resolve) => setImmediate(resolve))
}

async function networkBaseline(): Promise<object> {
    const originalPerformance = globalThis.performance
    let clockMs = 0
    Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => clockMs } })
    try {
        const manifest = manifestJson as any
        const transport = new BaselineTransport(), services = new ServiceRegistry()
        const livePosition = { x: 0, y: 0, z: 0 }, liveVelocity = { x: 0, y: 0, z: 0 }
        const physics = {
            setExternalDrive() {}, applyAuthoritativeTuning: async () => {},
            stepCommand(command: { right: number }) { livePosition.x += command.right * 0.1 },
            setAuthoritativeState(position: typeof livePosition, velocity: typeof liveVelocity) { Object.assign(livePosition, position); Object.assign(liveVelocity, velocity) },
            get position() { return livePosition }, get velocity() { return liveVelocity },
        }
        services.provide(ARENA, { mapManifest: manifest } as any)
        services.provide(PHYSICS, physics as any)
        services.provide(INPUT, { snapshot: () => ({ forward: 0, right: 1, jump: false, fire: false, reload: false, selectedWeapon: 1 }), consumeChatMessages: () => [], angles: { yaw: 0, pitch: 0, set() {} } } as any)
        services.provide(ENTITY_VIEWS, { clearAndDispose() {}, applyRemotePlayer() {}, removeAndDispose() {} } as any)
        const module = new NetworkingModule({ transport, clientBuildId: 'phase0-baseline', server: { websocketUrl: 'wss://baseline.invalid/game', buildId: 'phase0-baseline', protocolVersion: PROTOCOL_VERSION, mapId: manifest.mapId, mode: 'ffa' } })
        module.initialize({ canvas: {} as HTMLCanvasElement, hudRoot: {} as HTMLElement, services })
        module.start(); transport.callbacks!.open()
        const configurationJson = JSON.stringify({ movement: { capsuleRadius: .42, capsuleHalfHeight: .48, eyeHeight: 1.62, groundSpeed: 7.5, groundAcceleration: 42, airAcceleration: 12, airControl: .45, jumpSpeed: 6.4, gravity: 20, terminalVelocity: 35, maxSlopeRadians: .78539816339, stepUpHeight: .42, stickToFloorDistance: .5 } })
        const configurationHash = await sha256Identifier(configurationJson)
        const map = { mapId: manifest.mapId, formatVersion: manifest.formatVersion, contentHash: manifest.contentHash }
        transport.callbacks!.message(encodeMessage({ type: MessageType.Welcome, payload: { protocolVersion: PROTOCOL_VERSION, serverBuildId: 'phase0-baseline', playerId: 7, playerHandle: { slot: 7, generation: 0 }, tickRate: 60, snapshotRate: 20, map, configurationHash } }))
        transport.callbacks!.message(encodeMessage({ type: MessageType.Configuration, payload: { protocolVersion: PROTOCOL_VERSION, serverBuildId: 'phase0-baseline', map, configurationHash, configurationJson } }))
        await settleMessages()
        const local = (x: number) => ({ entityId: 7, kind: EntityKind.Player, position: { x, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, bodyYaw: 0, aimPitch: 0, grounded: true, stateFlags: 0, equippedWeapon: Weapon.Rifle, health: 100, weaponState: { selected: Weapon.Rifle, magazineAmmo: 30, reserveAmmo: 120, stateFlags: 0 } })
        const snapshot = (serverTick: number, ack: number, x: number) => encodeMessage({ type: MessageType.Snapshot, payload: { serverTick, lastProcessedInputSequence: ack, match: { phase: MatchPhase.Active, roundNumber: 1, phaseEndsAtTick: 600 }, entities: [local(x)] } })
        clockMs = 100; transport.callbacks!.message(snapshot(100, 0, 0)); await settleMessages()
        clockMs = 110; module.update({ deltaSeconds: 1 / 60, elapsedSeconds: 0, frame: 0 })
        clockMs = 150; transport.callbacks!.message(snapshot(101, 1, .06)); await settleMessages()
        clockMs = 160; module.update({ deltaSeconds: 1 / 60, elapsedSeconds: 0, frame: 1 })
        clockMs = 220; transport.callbacks!.message(snapshot(102, 2, .13)); await settleMessages()
        const corrections: number[] = []
        module.forEachCorrection((value) => corrections.push(value))
        const metrics = { ...module.metrics }
        module.dispose()
        return {
            scenario: 'deterministic in-process acknowledgement/snapshot cadence; no socket or wall-clock noise',
            correctionMeters: distribution(corrections),
            rttMs: { ewma: metrics.rttMs, samples: [40, 60] },
            jitterMs: { ewma: metrics.jitterMs, note: 'Current implementation combines snapshot-arrival deviation and acknowledgement RTT deviation.' },
            snapshotBytes: metrics.snapshotBytes,
        }
    } finally {
        Object.defineProperty(globalThis, 'performance', { configurable: true, value: originalPerformance })
    }
}

async function headlessPerformanceBaseline(): Promise<object> {
    const frameSamples: number[] = []
    let checksum = 0
    for (let frame = 0; frame < 600; frame++) {
        const started = nodePerformance.now()
        for (let index = 0; index < 2_000; index++) checksum = (checksum + index + frame) >>> 0
        frameSamples.push(nodePerformance.now() - started)
    }
    const manifestBytes = await readFile(new URL('../public/maps/graybox-arena/manifest.json', import.meta.url))
    const collisionBytes = await readFile(new URL('../public/maps/graybox-arena/collision.bin', import.meta.url))
    const renderBytes = await readFile(new URL('../public/maps/graybox-arena/scene.glb', import.meta.url))
    const manifestSamples: number[] = [], collisionSamples: number[] = []
    for (let iteration = 0; iteration < 100; iteration++) {
        let started = nodePerformance.now(); parseMapManifest(JSON.parse(manifestBytes.toString('utf8'))); manifestSamples.push(nodePerformance.now() - started)
        started = nodePerformance.now(); parseCollisionMesh(collisionBytes); collisionSamples.push(nodePerformance.now() - started)
    }
    return {
        clientFrameTimeMs: { ...distribution(frameSamples), workload: 'node-headless 2,000-operation allocation-free proxy', checksum },
        mapLoad: {
            packageBytes: manifestBytes.byteLength + collisionBytes.byteLength + renderBytes.byteLength,
            manifestParseMs: distribution(manifestSamples), collisionParseMs: distribution(collisionSamples),
            browserSceneAndGpuUploadMs: null,
            note: 'Headless report measures strict manifest/collision parse only; runtime __arenaProfile reports full staged browser mapLoadTotalMs.',
        },
    }
}

console.log(JSON.stringify({
    format: 'cpp-server-phase0-client-baseline', formatVersion: 1,
    environment: { runtime: process.version, platform: process.platform, architecture: process.arch },
    network: await networkBaseline(),
    ...await headlessPerformanceBaseline(),
}))
