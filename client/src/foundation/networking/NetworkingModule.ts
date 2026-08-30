import { ChatChannel, EntityKind, LIMITS, MessageType, MovementMode, PROTOCOL_VERSION, Stance, Weapon, decodeEnvelope, encodeMessage, type Configuration, type EntityRecord, type InputCommand, type MovementState, type Snapshot, type SnapshotDelta, type Welcome } from '../../protocol/generated'
import type { ClientModule, ClientModuleContext, FrameUpdate } from '../lifecycle'
import { ARENA, ENTITY_VIEWS, INPUT, NETWORKING, PHYSICS } from '../services'
import { FixedStepAccumulator, createMovementState } from '../physics/Movement'
import { validateConfiguration, validateWelcome, type ServerDiscoveryDescriptor } from './Handshake'
import { AdaptiveInterpolationDelay, NetworkClock, PredictionHistory, RemoteTimelineSet, isSequenceNewer, type RemoteSample } from './Synchronization'
import { BrowserWebSocketTransport, type NetworkTransport, type SyntheticImpairment } from './Transport'
import { CombatPresentationState, alignClientTick } from '../combat/CombatState'
import { RingBuffer } from '../performance/RingBuffer'
import { SnapshotDeltaBaseline, entityHandleKey, publicStateToEntityRecord } from './Replication'

export type ConnectionStatus = 'offline' | 'connecting' | 'handshaking' | 'connected' | 'reconnecting' | 'rejected' | 'disconnected'
export type HardSyncReason =
    | 'first-authoritative-snapshot' | 'reconnect-generation-change' | 'respawn' | 'teleport'
    | 'map-transition' | 'history-overflow' | 'impossible-acknowledgement'
    | 'excessive-clock-discontinuity' | 'jolt-world-rebuild'
export interface ReconciliationTuning {
    readonly horizontalHardSnapMeters: number
    readonly verticalHardSnapMeters: number
    readonly correctionHalfLifeSeconds: number
    readonly maxHorizontalVisualCorrectionMeters: number
    readonly maxVerticalVisualCorrectionMeters: number
}
export interface NetworkingOptions {
    readonly server?: ServerDiscoveryDescriptor; readonly clientBuildId?: string; readonly accessToken?: string
    readonly joinTicketProvider?: () => Promise<{ readonly websocketUrl: string; readonly ticket: string }>
    readonly transport?: NetworkTransport; readonly autoReconnect?: boolean
    readonly reconciliation?: Partial<ReconciliationTuning>
    readonly maxCatchUpSteps?: number
    readonly predictionHistoryCapacity?: number
}
export interface NetworkMetrics {
    readonly rttMs: number; readonly jitterMs: number; readonly snapshotAgeMs: number
    readonly clockOffsetMs: number; readonly clockConfidence: number; readonly clockAgeMs: number
    readonly correctionMagnitude: number; readonly pendingInputs: number; readonly remotePlayers: number
    readonly snapshotBytes: number; readonly correctionRevision: number
    readonly droppedSimulationTimeMs: number; readonly replaySteps: number; readonly replayTimeMs: number
    readonly hardSyncCount: number; readonly hardSyncReason: HardSyncReason | null
    readonly interpolationMode: 'none' | RemoteSample['mode']; readonly interpolationDelayMs: number
    readonly interpolationUnderflows: number; readonly interpolationOverflows: number
    readonly interpolatedSamples: number; readonly extrapolatedSamples: number; readonly frozenSamples: number
    readonly transportBufferedBytes: number
}

const JUMP_BUTTON = 1
const FIRE_BUTTON = 1 << 1
const RELOAD_BUTTON = 1 << 2
const SPRINT_BUTTON = 1 << 3
const CROUCH_BUTTON = 1 << 4
const PRONE_BUTTON = 1 << 5
const DASH_BUTTON = 1 << 6
const PING_INTERVAL_MS = 500
export const DEFAULT_RECONCILIATION_TUNING: ReconciliationTuning = Object.freeze({
    horizontalHardSnapMeters: 0.6,
    verticalHardSnapMeters: 0.6,
    correctionHalfLifeSeconds: 0.1,
    maxHorizontalVisualCorrectionMeters: 0.6,
    maxVerticalVisualCorrectionMeters: 0.6,
})
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error)

export class NetworkingModule implements ClientModule {
    readonly name = 'networking'
    private context?: ClientModuleContext
    private readonly transport: NetworkTransport
    private readonly accumulator: FixedStepAccumulator
    private readonly history: PredictionHistory
    private readonly reconciliationTuning: ReconciliationTuning
    private timelines?: RemoteTimelineSet
    private clock?: NetworkClock
    private interpolationDelay?: AdaptiveInterpolationDelay
    private welcome?: Welcome
    private messageChain = Promise.resolve()
    private sequence = 0
    private actionId = 0x9e3779b9
    private clientTick = 0
    private latestServerTick?: number
    private lastSnapshotAtMs = 0
    private previousSnapshotAtMs = 0
    private rttMs = 0
    private jitterMs = 0
    private lastRttMs = 0
    private nextPingAtMs = 0
    private correctionMagnitude = 0
    private readonly corrections = new RingBuffer<number>(60)
    private readonly replication = new SnapshotDeltaBaseline()
    private correctionRevision = 0
    private snapshotBytes = 0
    private droppedSimulationTimeMs = 0
    private replaySteps = 0
    private replayTimeMs = 0
    private hardSyncCount = 0
    private hardSyncReason: HardSyncReason | null = null
    private pendingHardSyncReason?: HardSyncReason
    private interpolationMode: NetworkMetrics['interpolationMode'] = 'none'
    private readonly visualResidual = { x: 0, y: 0, z: 0 }
    private readonly metricsState: { -readonly [Key in keyof NetworkMetrics]: NetworkMetrics[Key] } = {
        rttMs: 0, jitterMs: 0, snapshotAgeMs: 0, clockOffsetMs: 0, clockConfidence: 0, clockAgeMs: 0, correctionMagnitude: 0, pendingInputs: 0,
        remotePlayers: 0, snapshotBytes: 0, correctionRevision: 0, droppedSimulationTimeMs: 0,
        replaySteps: 0, replayTimeMs: 0, hardSyncCount: 0, hardSyncReason: null,
        interpolationMode: 'none', interpolationDelayMs: 0, interpolationUnderflows: 0, interpolationOverflows: 0,
        interpolatedSamples: 0, extrapolatedSamples: 0, frozenSamples: 0,
        transportBufferedBytes: 0,
    }
    private reconnectAtMs = 0
    private reconnectAttempts = 0
    private refreshTicketInFlight = false
    private websocketUrl: string
    private accessToken?: string
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
        this.accumulator = new FixedStepAccumulator(1 / 60, 0.25, options.maxCatchUpSteps ?? 5)
        this.history = new PredictionHistory(options.predictionHistoryCapacity ?? 256)
        this.reconciliationTuning = Object.freeze({ ...DEFAULT_RECONCILIATION_TUNING, ...options.reconciliation })
        this.websocketUrl = options.server?.websocketUrl ?? ''
        this.accessToken = options.accessToken
        this.validateReconciliationTuning()
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
        this.combat.expireActions(now)
        this.decayVisualResidual(frame.deltaSeconds)
        this.transport.update(now)
        if (this.status === 'reconnecting' && now >= this.reconnectAtMs) this.connect()
        if (!this.context || this.status !== 'connected' || !this.welcome) return
        this.sendPingIfDue(now)
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
            const sequence = this.sequence = (this.sequence + 1) >>> 0
            const selectedWeapon = snapshot.selectedWeapon === 2 ? Weapon.Shotgun : Weapon.Rifle
            const cosmeticInterval = selectedWeapon === Weapon.Shotgun ? 700 : 100
            let fireActionId = 0, reloadActionId = 0
            const physics = this.context.services.get(PHYSICS)
            if (snapshot.fire && physics.canFire && this.combat.canLocalFire(selectedWeapon) && now - this.lastLocalFireAtMs >= cosmeticInterval) {
                this.lastLocalFireAtMs = now; fireActionId = this.nextActionId(); this.combat.localFire(fireActionId, sequence, selectedWeapon, now)
            }
            if (snapshot.reload) { reloadActionId = this.nextActionId(); this.combat.localReload(reloadActionId, sequence, selectedWeapon, now) }
            const command: InputCommand = {
                sequence,
                clientTick: this.clientTick = (this.clientTick + 1) >>> 0,
                moveX: snapshot.right * scale, moveY: -snapshot.forward * scale,
                buttonFlags: (snapshot.jump ? JUMP_BUTTON : 0) | (fireActionId ? FIRE_BUTTON : 0) | (reloadActionId ? RELOAD_BUTTON : 0) | (snapshot.sprint ? SPRINT_BUTTON : 0) | (snapshot.crouch ? CROUCH_BUTTON : 0) | (snapshot.prone ? PRONE_BUTTON : 0) | (snapshot.dash ? DASH_BUTTON : 0),
                fireActionId, reloadActionId,
                yaw: input.angles.yaw, pitch: input.angles.pitch, selectedWeapon,
            }
            physics.stepCommand(this.movementCommand(command), dt)
            // History owns state snapshots; live physics getters intentionally reuse scratch objects.
            const position = physics.position, velocity = physics.velocity
            const pushed = this.history.push({ command, position: { x: position.x, y: position.y, z: position.z }, velocity: { x: velocity.x, y: velocity.y, z: velocity.z }, movementState: physics.movementState, sentAtMs: now })
            if (pushed.overflowed) this.requestHardSync('history-overflow')
            commands.push(command)
        })
        if (this.accumulator.lastDroppedSeconds > 0) {
            this.droppedSimulationTimeMs += this.accumulator.lastDroppedSeconds * 1000
            this.requestHardSync('excessive-clock-discontinuity')
        }
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
        this.resetSession('reconnect-generation-change')
        this.reconnectAttempts = Math.max(1, this.reconnectAttempts)
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
    get serverTickNow(): number | undefined {
        const now = performance.now()
        const clockTick = this.clock?.estimatedServerTick(now)
        if (clockTick !== undefined) return clockTick
        if (this.latestServerTick === undefined) return undefined
        return (this.latestServerTick + Math.floor((now - this.lastSnapshotAtMs) * this.tickRate / 1000)) >>> 0
    }
    matchCountdownSeconds(phaseEndsAtTick: number): number {
        const nowTick = this.serverTickNow
        if (nowTick === undefined) return 0
        const remainingTicks = (phaseEndsAtTick - nowTick) >>> 0
        return remainingTicks < 0x80000000 ? Math.ceil(remainingTicks / this.tickRate) : 0
    }
    get visualCorrection(): Readonly<{ x: number; y: number; z: number }> { return this.visualResidual }
    requestHardSync(reason: HardSyncReason): void {
        this.pendingHardSyncReason ??= reason
        this.history.clear()
        this.clearVisualResidual()
    }
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
        const clock = this.clock?.state(performance.now())
        value.rttMs = clock?.sampleCount ? clock.rttMs : this.rttMs; value.jitterMs = clock?.sampleCount ? clock.deviationMs : this.jitterMs
        value.clockOffsetMs = clock?.sampleCount ? clock.offsetMs : 0; value.clockConfidence = clock?.confidence ?? 0; value.clockAgeMs = clock?.sampleCount ? clock.ageMs : 0
        value.snapshotAgeMs = this.lastSnapshotAtMs ? Math.max(0, performance.now() - this.lastSnapshotAtMs) : 0
        value.correctionMagnitude = this.correctionMagnitude; value.pendingInputs = this.history.size
        value.remotePlayers = this.timelines?.size ?? 0; value.snapshotBytes = this.snapshotBytes; value.correctionRevision = this.correctionRevision
        const offlineDroppedTimeMs = this.status === 'offline' ? (this.context?.services.get(PHYSICS).droppedSimulationTimeMs ?? 0) : 0
        value.droppedSimulationTimeMs = this.droppedSimulationTimeMs + offlineDroppedTimeMs; value.replaySteps = this.replaySteps; value.replayTimeMs = this.replayTimeMs
        value.hardSyncCount = this.hardSyncCount; value.hardSyncReason = this.hardSyncReason
        const remoteTelemetry = this.timelines?.telemetry
        value.interpolationMode = this.interpolationMode; value.interpolationDelayMs = this.interpolationDelay?.delayMs ?? 0
        value.interpolationUnderflows = remoteTelemetry?.underflows ?? 0; value.interpolationOverflows = remoteTelemetry?.overflows ?? 0
        value.interpolatedSamples = remoteTelemetry?.interpolatedSamples ?? 0; value.extrapolatedSamples = remoteTelemetry?.extrapolatedSamples ?? 0; value.frozenSamples = remoteTelemetry?.frozenSamples ?? 0
        value.transportBufferedBytes = this.transport.bufferedBytes ?? 0
        return value
    }
    forEachCorrection(visitor: (value: number, index: number) => void): void { this.corrections.forEach(visitor) }

    private connect(): void {
        if (!this.context || !this.options.server) return
        if (this.reconnectAttempts > 0 && this.options.joinTicketProvider) {
            if (this.refreshTicketInFlight) return
            this.refreshTicketInFlight = true
            this.reconnectAtMs = Number.POSITIVE_INFINITY
            const generation = this.sessionGeneration
            void this.options.joinTicketProvider().then((join) => {
                this.refreshTicketInFlight = false
                if (generation !== this.sessionGeneration) return
                if (!/^wss?:\/\//.test(join.websocketUrl) || !join.ticket)
                    throw new Error('Join-ticket provider returned invalid connection data')
                this.websocketUrl = join.websocketUrl
                this.accessToken = join.ticket
                this.connectTransport()
            }).catch((error) => {
                this.refreshTicketInFlight = false
                if (generation === this.sessionGeneration) this.fail(errorMessage(error))
            })
            return
        }
        this.connectTransport()
    }

    private connectTransport(): void {
        if (!this.context || !this.options.server) return
        const manifest = this.context.services.get(ARENA).mapManifest
        if (!manifest) { this.fail('Loaded map manifest is unavailable'); return }
        this.status = this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting'
        this.detail = `Connecting to ${this.websocketUrl}`
        const generation = this.sessionGeneration
        try {
            // Discovery owns the complete endpoint. Never reconstruct it from host/port.
            this.transport.connect(this.websocketUrl, {
                open: () => {
                    this.status = 'handshaking'
                    this.detail = 'Verifying server compatibility…'
                    this.transport.send(encodeMessage({ type: MessageType.Hello, payload: { protocolVersion: PROTOCOL_VERSION, clientBuildId: this.options.clientBuildId ?? 'dev', supportedMapFormat: manifest.formatVersion, accessToken: this.accessToken ?? null } }))
                },
                message: (data) => { this.messageChain = this.messageChain.then(() => this.handlePacket(data, generation)).catch((error) => { if (generation === this.sessionGeneration) this.handleDecoderFailure(errorMessage(error)) }) },
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
                this.clock = new NetworkClock(message.payload.tickRate)
                this.interpolationDelay = new AdaptiveInterpolationDelay(message.payload.snapshotRate)
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
                case MessageType.SnapshotDelta: this.snapshotBytes = envelope.nextOffset - envelopeOffset; this.acceptSnapshotDelta(message.payload); break
                case MessageType.Pong: this.acceptPong(message.payload, performance.now()); break
                case MessageType.Spawn: this.acceptEntity(message.payload.serverTick, publicStateToEntityRecord(message.payload.entity)); break
                case MessageType.Remove: this.removeRemote(entityHandleKey(message.payload.handle)); break
                case MessageType.ShotConfirmed: this.combat.shot(message.payload); break
                case MessageType.ActionResult: this.combat.actionResult(message.payload); break
                case MessageType.Impact: this.combat.impact(message.payload); break
                case MessageType.Damage: this.combat.damage(message.payload); break
                case MessageType.Death: this.combat.death(message.payload); break
                case MessageType.Respawn:
                    this.combat.respawn(message.payload)
                    if (message.payload.playerId === this.welcome.playerId) {
                        this.hardSyncState(message.payload.position, { x: 0, y: 0, z: 0 }, 'respawn')
                        this.context?.services.get(INPUT).angles.set(message.payload.bodyYaw, 0)
                    }
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
        this.nextPingAtMs = 0
    }

    private acceptSnapshot(snapshot: Snapshot): void {
        if (!this.context || !this.welcome) return
        if (this.latestServerTick !== undefined && !isSequenceNewer(snapshot.serverTick, this.latestServerTick)) return
        const now = performance.now()
        this.interpolationDelay?.observeArrival(now, this.clock?.state(now).deviationMs ?? 0)
        if (this.previousSnapshotAtMs) {
            const actual = now - this.previousSnapshotAtMs, expected = 1000 / this.welcome.snapshotRate
            this.jitterMs += (Math.abs(actual - expected) - this.jitterMs) * 0.1
        }
        this.previousSnapshotAtMs = now
        this.lastSnapshotAtMs = now
        this.latestServerTick = snapshot.serverTick
        const initialSnapshot = !this.clientTickAligned
        if (initialSnapshot) {
            this.clientTick = alignClientTick(this.clientTick, snapshot.serverTick)
            this.clientTickAligned = true
            this.requestHardSync('first-authoritative-snapshot')
        }
        this.combat.acceptSnapshot(snapshot)
        const local = snapshot.entities.find((entity) => entity.entityId === this.welcome?.playerId)
        if (local) {
            if (initialSnapshot) this.context.services.get(INPUT).angles.set(local.bodyYaw, local.aimPitch)
            this.reconcile(local, snapshot.lastProcessedInputSequence, now)
        }
        for (const entity of snapshot.entities) if (entity.entityId !== this.welcome.playerId) this.acceptEntity(snapshot.serverTick, entity)
    }

    private acceptSnapshotDelta(snapshot: SnapshotDelta): void {
        if (!this.context || !this.welcome) return
        if (entityHandleKey(snapshot.local.handle) !== entityHandleKey(this.welcome.playerHandle))
            throw new Error('SnapshotDelta local owner handle mismatch')
        if (this.latestServerTick !== undefined && !isSequenceNewer(snapshot.serverTick, this.latestServerTick)) return
        const applied = this.replication.apply(snapshot)
        const now = performance.now()
        this.observeSnapshotArrival(snapshot.serverTick, now)
        const initialSnapshot = !this.clientTickAligned
        if (initialSnapshot) {
            this.clientTick = alignClientTick(this.clientTick, snapshot.serverTick)
            this.clientTickAligned = true
            this.requestHardSync('first-authoritative-snapshot')
            this.context.services.get(INPUT).angles.set(snapshot.local.bodyYaw, snapshot.local.aimPitch)
        }
        this.combat.acceptAuthoritative(snapshot.local, snapshot.match)
        const authoritative: EntityRecord = {
            entityId: entityHandleKey(snapshot.local.handle), kind: EntityKind.Player,
            position: snapshot.local.position, velocity: snapshot.local.velocity,
            bodyYaw: snapshot.local.bodyYaw, aimPitch: snapshot.local.aimPitch,
            grounded: snapshot.local.grounded, stateFlags: snapshot.local.stateFlags,
            stance: snapshot.local.movementState.stance, movementMode: snapshot.local.movementState.mode,
            equippedWeapon: snapshot.local.weaponState.selected,
        }
        this.reconcile(authoritative, snapshot.lastProcessedInputSequence, now, snapshot.local.movementState)
        for (const entity of applied.createdOrUpdated) this.acceptEntity(snapshot.serverTick, entity)
        for (const key of applied.removedKeys) this.removeRemote(key)
    }

    private observeSnapshotArrival(serverTick: number, now: number): void {
        this.interpolationDelay?.observeArrival(now, this.clock?.state(now).deviationMs ?? 0)
        if (this.previousSnapshotAtMs && this.welcome) {
            const actual = now - this.previousSnapshotAtMs, expected = 1000 / this.welcome.snapshotRate
            this.jitterMs += (Math.abs(actual - expected) - this.jitterMs) * 0.1
        }
        this.previousSnapshotAtMs = now
        this.lastSnapshotAtMs = now
        this.latestServerTick = serverTick
    }

    private reconcile(authoritative: EntityRecord, acknowledgedSequence: number, now: number, movementState?: MovementState): void {
        if (!this.context) return
        const physics = this.context.services.get(PHYSICS), before = physics.position
        const beforeX = before.x, beforeY = before.y, beforeZ = before.z
        const shownBeforeX = beforeX + this.visualResidual.x
        const shownBeforeY = beforeY + this.visualResidual.y
        const shownBeforeZ = beforeZ + this.visualResidual.z
        if (this.pendingHardSyncReason) {
            const reason = this.pendingHardSyncReason
            this.hardSyncState(authoritative.position, authoritative.velocity, reason, movementState)
            this.recordCorrection(beforeX, beforeY, beforeZ, authoritative.position.x, authoritative.position.y, authoritative.position.z)
            return
        }
        const acknowledgement = this.history.acknowledge(acknowledgedSequence)
        if (acknowledgement.status === 'history-overflow' || acknowledgement.status === 'impossible') {
            const reason: HardSyncReason = acknowledgement.status === 'history-overflow' ? 'history-overflow' : 'impossible-acknowledgement'
            this.hardSyncState(authoritative.position, authoritative.velocity, reason, movementState)
            this.recordCorrection(beforeX, beforeY, beforeZ, authoritative.position.x, authoritative.position.y, authoritative.position.z)
            return
        }
        if (acknowledgement.acknowledged && (this.clock?.state(now).sampleCount ?? 0) === 0) {
            const acknowledged = acknowledgement.acknowledged
            const sampleRtt = Math.max(0, now - acknowledged.sentAtMs)
            this.rttMs = this.rttMs === 0 ? sampleRtt : this.rttMs + (sampleRtt - this.rttMs) * 0.15
            if (this.lastRttMs) this.jitterMs += (Math.abs(sampleRtt - this.lastRttMs) - this.jitterMs) * 0.1
            this.lastRttMs = sampleRtt
        }
        physics.setAuthoritativeState(authoritative.position, authoritative.velocity, movementState)
        const replayStarted = performance.now()
        for (const entry of acknowledgement.pending) {
            const command = entry.command
            physics.stepCommand(this.movementCommand(command))
        }
        this.replaySteps = acknowledgement.pending.length
        this.replayTimeMs = Math.max(0, performance.now() - replayStarted)
        const after = physics.position
        const correctionX = after.x - beforeX, correctionY = after.y - beforeY, correctionZ = after.z - beforeZ
        this.recordCorrection(beforeX, beforeY, beforeZ, after.x, after.y, after.z)
        const horizontalCorrection = Math.hypot(correctionX, correctionZ)
        if (horizontalCorrection > this.reconciliationTuning.horizontalHardSnapMeters || Math.abs(correctionY) > this.reconciliationTuning.verticalHardSnapMeters) {
            this.history.clear()
            this.clearVisualResidual()
            this.recordHardSync('teleport')
            return
        }
        const residualX = shownBeforeX - after.x, residualZ = shownBeforeZ - after.z
        const residualHorizontal = Math.hypot(residualX, residualZ)
        const horizontalScale = residualHorizontal > this.reconciliationTuning.maxHorizontalVisualCorrectionMeters
            ? this.reconciliationTuning.maxHorizontalVisualCorrectionMeters / residualHorizontal : 1
        this.visualResidual.x = residualX * horizontalScale
        this.visualResidual.z = residualZ * horizontalScale
        this.visualResidual.y = Math.max(-this.reconciliationTuning.maxVerticalVisualCorrectionMeters,
            Math.min(this.reconciliationTuning.maxVerticalVisualCorrectionMeters, shownBeforeY - after.y))
    }

    private recordCorrection(beforeX: number, beforeY: number, beforeZ: number, afterX: number, afterY: number, afterZ: number): void {
        this.correctionMagnitude = Math.hypot(afterX - beforeX, afterY - beforeY, afterZ - beforeZ)
        this.corrections.push(this.correctionMagnitude)
        this.correctionRevision++
    }

    private movementCommand(command: InputCommand) {
        return { forward: -command.moveY, right: command.moveX, jump: Boolean(command.buttonFlags & JUMP_BUTTON), yaw: command.yaw, sprint: Boolean(command.buttonFlags & SPRINT_BUTTON), crouch: Boolean(command.buttonFlags & CROUCH_BUTTON), prone: Boolean(command.buttonFlags & PRONE_BUTTON), dash: Boolean(command.buttonFlags & DASH_BUTTON) }
    }

    private hardSyncState(position: { x: number; y: number; z: number }, velocity: { x: number; y: number; z: number }, reason: HardSyncReason, movementState: MovementState = createMovementState()): void {
        this.context?.services.get(PHYSICS).setAuthoritativeState(position, velocity, movementState)
        this.history.clear()
        this.accumulator.reset()
        this.clearVisualResidual()
        this.pendingHardSyncReason = undefined
        this.replaySteps = 0
        this.replayTimeMs = 0
        this.recordHardSync(reason)
    }

    private recordHardSync(reason: HardSyncReason): void { this.hardSyncReason = reason; this.hardSyncCount++ }
    private clearVisualResidual(): void { this.visualResidual.x = 0; this.visualResidual.y = 0; this.visualResidual.z = 0 }
    private decayVisualResidual(deltaSeconds: number): void {
        if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return
        const decay = Math.pow(0.5, deltaSeconds / this.reconciliationTuning.correctionHalfLifeSeconds)
        this.visualResidual.x *= decay; this.visualResidual.y *= decay; this.visualResidual.z *= decay
        if (Math.hypot(this.visualResidual.x, this.visualResidual.y, this.visualResidual.z) < 1e-5) this.clearVisualResidual()
    }

    private validateReconciliationTuning(): void {
        for (const [name, value] of Object.entries(this.reconciliationTuning)) {
            if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be positive`)
        }
    }

    private acceptEntity(serverTick: number, entity: EntityRecord): void {
        if (!this.welcome || entity.entityId === entityHandleKey(this.welcome.playerHandle) || entity.kind !== EntityKind.Player) return
        this.timelines?.add(serverTick, entity)
    }
    private updateRemoteViews(now: number): void {
        if (!this.context || !this.welcome || this.latestServerTick === undefined || !this.timelines) return
        const estimatedTick = this.clock?.estimatedServerTick(now) ??
            ((this.latestServerTick + Math.floor((now - this.lastSnapshotAtMs) * this.welcome.tickRate / 1000)) >>> 0)
        const interpolationTicks = Math.round((this.interpolationDelay?.delayMs ?? 100) * this.welcome.tickRate / 1000)
        const targetTick = (estimatedTick - interpolationTicks) >>> 0
        const views = this.context.services.get(ENTITY_VIEWS)
        let mode: NetworkMetrics['interpolationMode'] = 'none'
        this.timelines.forEachSample(targetTick, (_entityId, sample) => {
            if (sample.mode === 'frozen' || mode === 'none') mode = sample.mode
            else if (sample.mode === 'extrapolated' && mode === 'interpolated') mode = 'extrapolated'
            views.applyRemotePlayer(sample.entity)
        })
        this.interpolationMode = mode
    }
    private sendPingIfDue(now: number): void {
        if (!this.clock || now < this.nextPingAtMs) return
        const pingId = this.clock.beginPing(now)
        this.transport.send(encodeMessage({ type: MessageType.Ping, payload: { pingId } }))
        this.nextPingAtMs = now + PING_INTERVAL_MS
    }
    private acceptPong(pong: import('../../protocol/generated').Pong, now: number): void {
        const result = this.clock?.acceptPong(pong, now)
        if (result?.discontinuity) {
            this.timelines?.clear()
            this.interpolationDelay?.reset()
            this.interpolationMode = 'none'
            this.requestHardSync('excessive-clock-discontinuity')
        }
    }
    private removeRemote(entityId: number): void { this.timelines?.remove(entityId); this.context?.services.get(ENTITY_VIEWS).removeAndDispose(entityId) }

    private handleClose(code: number, closeReason: string): void {
        const wasRejected = this.status === 'rejected'
        this.resetSession('reconnect-generation-change')
        if (this.intentionalClose || wasRejected) return
        this.status = this.options.autoReconnect === false ? 'disconnected' : 'reconnecting'
        this.detail = `Disconnected (${code}${closeReason ? `: ${closeReason}` : ''})`
        if (this.status === 'reconnecting') { this.reconnectAttempts++; this.reconnectAtMs = performance.now() + Math.min(5000, 500 * 2 ** Math.min(4, this.reconnectAttempts - 1)) }
    }
    private handleDecoderFailure(message: string): void {
        this.detail = `Replication decoder reset: ${message}`
        this.intentionalClose = false
        this.transport.close(1002, 'decoder baseline reset')
        this.resetSession('reconnect-generation-change')
        this.status = this.options.autoReconnect === false ? 'disconnected' : 'reconnecting'
        this.reconnectAttempts++
        this.reconnectAtMs = performance.now() + Math.min(5000, 500 * 2 ** Math.min(4, this.reconnectAttempts - 1))
    }
    private fail(message: string): void { this.status = 'rejected'; this.detail = message; this.intentionalClose = true; this.transport.close(1008, 'client validation failed'); this.resetSession() }
    private resetSession(reason?: HardSyncReason): void {
        this.sessionGeneration++
        this.welcome = undefined; this.latestServerTick = undefined; this.lastSnapshotAtMs = 0; this.previousSnapshotAtMs = 0
        this.clock?.reset(); this.clock = undefined; this.interpolationDelay?.reset(); this.interpolationDelay = undefined; this.nextPingAtMs = 0; this.interpolationMode = 'none'
        this.history.clear(); this.timelines?.clear(); this.timelines = undefined; this.replication.clear(); this.combat.clear(); this.corrections.clear(); this.correctionRevision++; this.snapshotBytes = 0
        this.sequence = 0; this.actionId = 0x9e3779b9; this.clientTick = 0; this.clientTickAligned = false; this.lastLocalFireAtMs = -Infinity
        this.pendingHardSyncReason = undefined; this.clearVisualResidual(); this.replaySteps = 0; this.replayTimeMs = 0
        if (reason) this.recordHardSync(reason)
        this.context?.services.get(ENTITY_VIEWS).clearAndDispose(); this.accumulator.reset()
    }
    stop(): void { this.intentionalClose = true; this.transport.close(1000, 'client stopped'); this.resetSession() }
    dispose(): void { this.stop(); this.context?.services.get(PHYSICS).setExternalDrive(false); this.context?.services.remove(NETWORKING); this.context = undefined }
    private nextActionId(): number { this.actionId = (this.actionId + 1) >>> 0; if (this.actionId === 0) this.actionId = 1; return this.actionId }
}
