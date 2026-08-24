import { ChatChannel, EntityKind, LIMITS, MessageType, PROTOCOL_VERSION, Weapon, decodeEnvelope, encodeMessage, type Configuration, type EntityRecord, type InputCommand, type Snapshot, type Welcome } from '../../protocol/generated'
import type { ClientModule, ClientModuleContext, FrameUpdate } from '../lifecycle'
import { ARENA, ENTITY_VIEWS, INPUT, NETWORKING, PHYSICS } from '../services'
import { FixedStepAccumulator } from '../physics/Movement'
import { validateConfiguration, validateWelcome, type ServerDiscoveryDescriptor } from './Handshake'
import { PredictionHistory, RemoteTimelineSet, isSequenceNewer } from './Synchronization'
import { BrowserWebSocketTransport, type NetworkTransport, type SyntheticImpairment } from './Transport'
import { CombatPresentationState, alignClientTick } from '../combat/CombatState'
import { RingBuffer } from '../performance/RingBuffer'

export type ConnectionStatus = 'offline' | 'connecting' | 'handshaking' | 'connected' | 'reconnecting' | 'rejected' | 'disconnected'
export interface NetworkingOptions { readonly server?: ServerDiscoveryDescriptor; readonly clientBuildId?: string; readonly accessToken?: string; readonly transport?: NetworkTransport; readonly autoReconnect?: boolean }
export interface NetworkMetrics { readonly rttMs: number; readonly jitterMs: number; readonly snapshotAgeMs: number; readonly correctionMagnitude: number; readonly pendingInputs: number; readonly remotePlayers: number; readonly snapshotBytes: number; readonly correctionRevision: number }

const JUMP_BUTTON = 1
const FIRE_BUTTON = 1 << 1
const RELOAD_BUTTON = 1 << 2
const INTERPOLATION_MS = 100
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error)

export class NetworkingModule implements ClientModule {
    readonly name = 'networking'
    private context?: ClientModuleContext
    private readonly transport: NetworkTransport
    private readonly accumulator = new FixedStepAccumulator(1 / 60)
    private readonly history = new PredictionHistory(256)
    private timelines?: RemoteTimelineSet
    private welcome?: Welcome
    private messageChain = Promise.resolve()
    private sequence = 0
    private clientTick = 0
    private latestServerTick?: number
    private lastSnapshotAtMs = 0
    private previousSnapshotAtMs = 0
    private rttMs = 0
    private jitterMs = 0
    private lastRttMs = 0
    private correctionMagnitude = 0
    private readonly corrections = new RingBuffer<number>(60)
    private correctionRevision = 0
    private snapshotBytes = 0
    private readonly metricsState = { rttMs: 0, jitterMs: 0, snapshotAgeMs: 0, correctionMagnitude: 0, pendingInputs: 0, remotePlayers: 0, snapshotBytes: 0, correctionRevision: 0 }
    private reconnectAtMs = 0
    private reconnectAttempts = 0
    private intentionalClose = false
    private sessionGeneration = 0
    private impairment: SyntheticImpairment = { latencyMs: 0, jitterMs: 0, stalled: false }
    readonly combat = new CombatPresentationState()
    private clientTickAligned = false
    private lastLocalFireAtMs = -Infinity
    status: ConnectionStatus
    detail = ''

    constructor(private readonly options: NetworkingOptions = {}) {
        this.transport = options.transport ?? new BrowserWebSocketTransport()
        this.status = options.server ? 'connecting' : 'offline'
    }

    initialize(context: ClientModuleContext): void {
        this.context = context
        context.services.provide(NETWORKING, this)
        if (this.options.server) context.services.get(PHYSICS).setExternalDrive(true)
    }
    start(): void { if (this.options.server) this.connect() }

    update(frame: FrameUpdate): void {
        const now = performance.now()
        this.transport.update(now)
        if (this.status === 'reconnecting' && now >= this.reconnectAtMs) this.connect()
        if (!this.context || this.status !== 'connected' || !this.welcome) return
        if (!this.clientTickAligned) {
            for (const text of this.context.services.get(INPUT).consumeChatMessages()) this.sendChat(text)
            this.updateRemoteViews(now)
            return
        }
        const commands: InputCommand[] = []
        this.accumulator.consume(frame.deltaSeconds, (dt) => {
            if (!this.context) return
            const input = this.context.services.get(INPUT)
            const snapshot = input.snapshot()
            const length = Math.hypot(snapshot.forward, snapshot.right)
            const scale = length > 1 ? 1 / length : 1
            const command: InputCommand = {
                sequence: this.sequence = (this.sequence + 1) >>> 0,
                clientTick: this.clientTick = (this.clientTick + 1) >>> 0,
                moveX: snapshot.right * scale, moveY: -snapshot.forward * scale,
                buttonFlags: (snapshot.jump ? JUMP_BUTTON : 0) | (snapshot.fire ? FIRE_BUTTON : 0) | (snapshot.reload ? RELOAD_BUTTON : 0),
                yaw: input.angles.yaw, pitch: input.angles.pitch, selectedWeapon: snapshot.selectedWeapon === 2 ? Weapon.Shotgun : Weapon.Rifle,
            }
            const cosmeticInterval = command.selectedWeapon === Weapon.Shotgun ? 700 : 100
            if (snapshot.fire && now - this.lastLocalFireAtMs >= cosmeticInterval) {
                this.lastLocalFireAtMs = now
                this.combat.localFire(command.sequence, command.selectedWeapon)
            }
            const physics = this.context.services.get(PHYSICS)
            physics.stepCommand({ forward: -command.moveY, right: command.moveX, jump: Boolean(command.buttonFlags & JUMP_BUTTON), yaw: command.yaw }, dt)
            // History owns state snapshots; live physics getters intentionally reuse scratch objects.
            const position = physics.position, velocity = physics.velocity
            this.history.push({ command, position: { x: position.x, y: position.y, z: position.z }, velocity: { x: velocity.x, y: velocity.y, z: velocity.z }, sentAtMs: now })
            commands.push(command)
        })
        for (let offset = 0; offset < commands.length; offset += LIMITS.maxInputCommands) {
            this.transport.send(encodeMessage({ type: MessageType.InputBatch, payload: { commands: commands.slice(offset, offset + LIMITS.maxInputCommands) } }))
        }
        for (const text of this.context.services.get(INPUT).consumeChatMessages()) this.sendChat(text)
        this.updateRemoteViews(now)
    }

    reconnect(): void {
        if (!this.options.server) return
        this.intentionalClose = false
        this.transport.close(1000, 'manual reconnect')
        this.resetSession()
        this.status = 'reconnecting'
        this.reconnectAtMs = performance.now()
    }

    setSyntheticImpairment(impairment: SyntheticImpairment): void {
        this.impairment = impairment
        if (this.transport instanceof BrowserWebSocketTransport) this.transport.setImpairment(impairment)
    }
    get syntheticImpairment(): SyntheticImpairment { return this.impairment }
    get latestTick(): number | undefined { return this.latestServerTick }
    get tickRate(): number { return this.welcome?.tickRate ?? 60 }
    sendChat(text: string): boolean {
        if (this.status !== 'connected') { this.detail = 'Chat unavailable while disconnected'; return false }
        try {
            const clean = this.combat.validateChat(text)
            this.transport.send(encodeMessage({ type: MessageType.Chat, payload: { senderId: null, channel: ChatChannel.Global, text: clean } }))
            return true
        } catch (error) { this.detail = errorMessage(error); return false }
    }
    get metrics(): NetworkMetrics {
        const value = this.metricsState
        value.rttMs = this.rttMs; value.jitterMs = this.jitterMs
        value.snapshotAgeMs = this.lastSnapshotAtMs ? Math.max(0, performance.now() - this.lastSnapshotAtMs) : 0
        value.correctionMagnitude = this.correctionMagnitude; value.pendingInputs = this.history.size
        value.remotePlayers = this.timelines?.size ?? 0; value.snapshotBytes = this.snapshotBytes; value.correctionRevision = this.correctionRevision
        return value
    }
    forEachCorrection(visitor: (value: number, index: number) => void): void { this.corrections.forEach(visitor) }

    private connect(): void {
        if (!this.context || !this.options.server) return
        const manifest = this.context.services.get(ARENA).mapManifest
        if (!manifest) { this.fail('Loaded map manifest is unavailable'); return }
        this.status = this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting'
        this.detail = `Connecting to ${this.options.server.websocketUrl}`
        const generation = this.sessionGeneration
        try {
            // Discovery owns the complete endpoint. Never reconstruct it from host/port.
            this.transport.connect(this.options.server.websocketUrl, {
                open: () => {
                    this.status = 'handshaking'
                    this.detail = 'Verifying server compatibility…'
                    this.transport.send(encodeMessage({ type: MessageType.Hello, payload: { protocolVersion: PROTOCOL_VERSION, clientBuildId: this.options.clientBuildId ?? 'dev', supportedMapFormat: manifest.formatVersion, accessToken: this.options.accessToken ?? null } }))
                },
                message: (data) => { this.messageChain = this.messageChain.then(() => this.handlePacket(data, generation)).catch((error) => { if (generation === this.sessionGeneration) this.fail(errorMessage(error)) }) },
                error: (message) => { if (generation === this.sessionGeneration) this.detail = message },
                close: (code, closeReason) => { if (generation === this.sessionGeneration) this.handleClose(code, closeReason) },
            })
        } catch (error) { this.fail(errorMessage(error)) }
    }

    private async handlePacket(data: Uint8Array, generation: number): Promise<void> {
        if (generation !== this.sessionGeneration) return
        let offset = 0
        while (offset < data.length) {
            if (generation !== this.sessionGeneration) return
            const envelopeOffset = offset
            const envelope = decodeEnvelope(data, offset)
            offset = envelope.nextOffset
            if (!envelope.known) continue
            const message = envelope.message
            if (message.type === MessageType.Reject) {
                this.status = 'rejected'
                this.detail = `Rejected: ${message.payload.detail} (reason ${message.payload.reason})`
                this.intentionalClose = true
                this.transport.close(1008, 'server rejected connection')
                return
            }
            if (!this.welcome) {
                if (message.type !== MessageType.Welcome) throw new Error('Expected Welcome before game messages')
                const manifest = this.context?.services.get(ARENA).mapManifest
                if (!manifest || !this.options.server) throw new Error('Handshake context disappeared')
                validateWelcome(message.payload, { clientBuildId: this.options.clientBuildId ?? 'dev', discovery: this.options.server, manifest })
                this.welcome = message.payload
                this.combat.setPlayerId(message.payload.playerId)
                this.timelines = new RemoteTimelineSet(message.payload.tickRate)
                this.detail = 'Welcome received; verifying configuration…'
                continue
            }
            if (this.status !== 'connected') {
                if (message.type !== MessageType.Configuration) throw new Error('Expected Configuration immediately after Welcome')
                await this.acceptConfiguration(message.payload, generation)
                continue
            }
            switch (message.type) {
                case MessageType.Snapshot: this.snapshotBytes = envelope.nextOffset - envelopeOffset; this.acceptSnapshot(message.payload); break
                case MessageType.Spawn: this.acceptEntity(message.payload.serverTick, message.payload.entity); break
                case MessageType.Remove: this.removeRemote(message.payload.entityId); break
                case MessageType.ShotConfirmed: this.combat.shot(message.payload); break
                case MessageType.Impact: this.combat.impact(message.payload); break
                case MessageType.Damage: this.combat.damage(message.payload); break
                case MessageType.Death: this.combat.death(message.payload); break
                case MessageType.Respawn:
                    this.combat.respawn(message.payload)
                    if (message.payload.playerId === this.welcome.playerId) this.context?.services.get(PHYSICS).setAuthoritativeState(message.payload.position, { x: 0, y: 0, z: 0 })
                    break
                case MessageType.ScoreChange: this.combat.score(message.payload); break
                case MessageType.RoundTransition: this.combat.round(message.payload); break
                case MessageType.Chat: this.combat.chat(message.payload); break
            }
        }
    }

    private async acceptConfiguration(configuration: Configuration, generation: number): Promise<void> {
        if (!this.welcome || !this.context) return
        const tuning = await validateConfiguration(configuration, this.welcome)
        if (generation !== this.sessionGeneration) return
        await this.context.services.get(PHYSICS).applyAuthoritativeTuning(tuning)
        if (generation !== this.sessionGeneration) return
        this.status = 'connected'
        this.detail = `Connected · player ${this.welcome.playerId}`
        this.reconnectAttempts = 0
        this.accumulator.reset()
    }

    private acceptSnapshot(snapshot: Snapshot): void {
        if (!this.context || !this.welcome) return
        if (this.latestServerTick !== undefined && !isSequenceNewer(snapshot.serverTick, this.latestServerTick)) return
        const now = performance.now()
        if (this.previousSnapshotAtMs) {
            const actual = now - this.previousSnapshotAtMs, expected = 1000 / this.welcome.snapshotRate
            this.jitterMs += (Math.abs(actual - expected) - this.jitterMs) * 0.1
        }
        this.previousSnapshotAtMs = now
        this.lastSnapshotAtMs = now
        this.latestServerTick = snapshot.serverTick
        if (!this.clientTickAligned) {
            this.clientTick = alignClientTick(this.clientTick, snapshot.serverTick)
            this.clientTickAligned = true
        }
        this.combat.acceptSnapshot(snapshot)
        const local = snapshot.entities.find((entity) => entity.entityId === this.welcome?.playerId)
        if (local) this.reconcile(local, snapshot.lastProcessedInputSequence, now)
        for (const entity of snapshot.entities) if (entity.entityId !== this.welcome.playerId) this.acceptEntity(snapshot.serverTick, entity)
    }

    private reconcile(authoritative: EntityRecord, acknowledgedSequence: number, now: number): void {
        if (!this.context) return
        const physics = this.context.services.get(PHYSICS), before = physics.position
        const beforeX = before.x, beforeY = before.y, beforeZ = before.z
        const { pending, acknowledged } = this.history.acknowledge(acknowledgedSequence)
        if (acknowledged) {
            const sampleRtt = Math.max(0, now - acknowledged.sentAtMs)
            this.rttMs = this.rttMs === 0 ? sampleRtt : this.rttMs + (sampleRtt - this.rttMs) * 0.15
            if (this.lastRttMs) this.jitterMs += (Math.abs(sampleRtt - this.lastRttMs) - this.jitterMs) * 0.1
            this.lastRttMs = sampleRtt
        }
        physics.setAuthoritativeState(authoritative.position, authoritative.velocity)
        for (const entry of pending) {
            const command = entry.command
            physics.stepCommand({ forward: -command.moveY, right: command.moveX, jump: Boolean(command.buttonFlags & JUMP_BUTTON), yaw: command.yaw })
        }
        const after = physics.position
        this.correctionMagnitude = Math.hypot(after.x - beforeX, after.y - beforeY, after.z - beforeZ)
        this.corrections.push(this.correctionMagnitude)
        this.correctionRevision++
    }

    private acceptEntity(serverTick: number, entity: EntityRecord): void {
        if (!this.welcome || entity.entityId === this.welcome.playerId || entity.kind !== EntityKind.Player) return
        this.timelines?.add(serverTick, entity)
    }
    private updateRemoteViews(now: number): void {
        if (!this.context || !this.welcome || this.latestServerTick === undefined || !this.timelines) return
        const elapsedTicks = Math.floor((now - this.lastSnapshotAtMs) * this.welcome.tickRate / 1000)
        const interpolationTicks = Math.round(INTERPOLATION_MS * this.welcome.tickRate / 1000)
        const targetTick = ((this.latestServerTick + elapsedTicks) - interpolationTicks) >>> 0
        const views = this.context.services.get(ENTITY_VIEWS)
        this.timelines.forEachSample(targetTick, (_entityId, sample) => views.applyRemotePlayer(sample.entity))
    }
    private removeRemote(entityId: number): void { this.timelines?.remove(entityId); this.context?.services.get(ENTITY_VIEWS).removeAndDispose(entityId) }

    private handleClose(code: number, closeReason: string): void {
        const wasRejected = this.status === 'rejected'
        this.resetSession()
        if (this.intentionalClose || wasRejected) return
        this.status = this.options.autoReconnect === false ? 'disconnected' : 'reconnecting'
        this.detail = `Disconnected (${code}${closeReason ? `: ${closeReason}` : ''})`
        if (this.status === 'reconnecting') { this.reconnectAttempts++; this.reconnectAtMs = performance.now() + Math.min(5000, 500 * 2 ** Math.min(4, this.reconnectAttempts - 1)) }
    }
    private fail(message: string): void { this.status = 'rejected'; this.detail = message; this.intentionalClose = true; this.transport.close(1008, 'client validation failed'); this.resetSession() }
    private resetSession(): void {
        this.sessionGeneration++
        this.welcome = undefined; this.latestServerTick = undefined; this.lastSnapshotAtMs = 0; this.previousSnapshotAtMs = 0
        this.history.clear(); this.timelines?.clear(); this.timelines = undefined; this.combat.clear(); this.corrections.clear(); this.correctionRevision++; this.snapshotBytes = 0
        this.sequence = 0; this.clientTick = 0; this.clientTickAligned = false; this.lastLocalFireAtMs = -Infinity
        this.context?.services.get(ENTITY_VIEWS).clearAndDispose(); this.accumulator.reset()
    }
    stop(): void { this.intentionalClose = true; this.transport.close(1000, 'client stopped'); this.resetSession() }
    dispose(): void { this.stop(); this.context?.services.get(PHYSICS).setExternalDrive(false); this.context?.services.remove(NETWORKING); this.context = undefined }
}
