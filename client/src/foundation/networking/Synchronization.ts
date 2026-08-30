import type { EntityRecord, InputCommand, MovementState, Pong, Vec3 } from '../../protocol/generated'

const UINT32_HALF_RANGE = 0x80000000
const UINT32_RANGE = 0x100000000

/** RFC-1982-style ordering for counters that wrap at 2^32. */
export function isSequenceNewer(candidate: number, reference: number): boolean {
    const distance = (candidate - reference) >>> 0
    return distance !== 0 && distance < UINT32_HALF_RANGE
}

function signedUint32Delta(candidate: number, reference: number): number {
    const delta = (candidate - reference) >>> 0
    return delta < UINT32_HALF_RANGE ? delta : delta - UINT32_RANGE
}

export interface NetworkClockState {
    readonly rttMs: number
    readonly deviationMs: number
    readonly offsetMs: number
    readonly confidence: number
    readonly ageMs: number
    readonly sampleCount: number
}

export interface ClockSampleResult {
    readonly accepted: boolean
    readonly discontinuity: boolean
}

/**
 * Maps browser performance.now() to the server's wrapping steady-clock
 * millisecond domain. Neither clock is wall time. Ping IDs and both server
 * counters use RFC-1982-style modulo-2^32 ordering.
 */
export class NetworkClock {
    private readonly pending = new Map<number, number>()
    private nextPingId = 0
    private rtt = 0
    private deviation = 0
    private offset = 0
    private samples = 0
    private lastSampleAtMs = 0
    private lastServerMonotonicRaw?: number
    private serverMonotonicUnwrapped = 0
    private anchorServerTick = 0
    private anchorServerMonotonicMs = 0

    constructor(readonly tickRate: number, readonly maxPendingPings = 8) {
        if (!Number.isFinite(tickRate) || tickRate <= 0) throw new RangeError('Clock tick rate must be positive')
    }

    beginPing(sentAtMs: number): number {
        if (!Number.isFinite(sentAtMs)) throw new RangeError('Ping timestamp must be finite')
        const pingId = this.nextPingId = (this.nextPingId + 1) >>> 0
        this.pending.set(pingId, sentAtMs)
        while (this.pending.size > this.maxPendingPings) this.pending.delete(this.pending.keys().next().value!)
        return pingId
    }

    acceptPong(pong: Pong, receivedAtMs: number): ClockSampleResult {
        const sentAtMs = this.pending.get(pong.pingId)
        if (sentAtMs === undefined || !Number.isFinite(receivedAtMs) || receivedAtMs < sentAtMs) return { accepted: false, discontinuity: false }
        this.pending.delete(pong.pingId)
        const sampleRtt = receivedAtMs - sentAtMs
        const midpoint = sentAtMs + sampleRtt / 2
        let unwrapped = pong.serverMonotonicMs
        if (this.lastServerMonotonicRaw !== undefined) unwrapped = this.serverMonotonicUnwrapped + signedUint32Delta(pong.serverMonotonicMs, this.lastServerMonotonicRaw)
        const sampleOffset = unwrapped - midpoint

        if (this.samples > 0) {
            const offsetJump = Math.abs(sampleOffset - this.offset)
            const allowedJump = Math.max(1000, this.rtt + this.deviation * 8)
            const elapsedServerMs = unwrapped - this.anchorServerMonotonicMs
            const elapsedTicks = signedUint32Delta(pong.serverTick, this.anchorServerTick)
            const tickTimeErrorMs = Math.abs(elapsedTicks * 1000 / this.tickRate - elapsedServerMs)
            if (offsetJump > allowedJump || elapsedServerMs < -1 || tickTimeErrorMs > 1000) {
                this.reset()
                this.seed(pong, receivedAtMs, sampleRtt, midpoint, pong.serverMonotonicMs)
                return { accepted: true, discontinuity: true }
            }
        }

        if (this.samples === 0) this.seed(pong, receivedAtMs, sampleRtt, midpoint, unwrapped)
        else {
            const previousRtt = this.rtt
            this.rtt += (sampleRtt - this.rtt) * 0.125
            this.deviation += (Math.abs(sampleRtt - previousRtt) - this.deviation) * 0.25
            this.offset += (sampleOffset - this.offset) * 0.125
            this.samples++
            this.lastSampleAtMs = receivedAtMs
            this.lastServerMonotonicRaw = pong.serverMonotonicMs
            this.serverMonotonicUnwrapped = unwrapped
            this.anchorServerTick = pong.serverTick
            this.anchorServerMonotonicMs = unwrapped
        }
        return { accepted: true, discontinuity: false }
    }

    estimatedServerTick(nowMs: number): number | undefined {
        if (this.samples === 0 || !Number.isFinite(nowMs)) return undefined
        const serverNowMs = nowMs + this.offset
        const elapsedTicks = Math.floor((serverNowMs - this.anchorServerMonotonicMs) * this.tickRate / 1000)
        return (this.anchorServerTick + elapsedTicks) >>> 0
    }

    state(nowMs: number): NetworkClockState {
        const ageMs = this.samples === 0 ? Infinity : Math.max(0, nowMs - this.lastSampleAtMs)
        const sampleConfidence = Math.min(1, this.samples / 4)
        const ageConfidence = Number.isFinite(ageMs) ? Math.exp(-ageMs / 5000) : 0
        return { rttMs: this.rtt, deviationMs: this.deviation, offsetMs: this.offset, confidence: sampleConfidence * ageConfidence, ageMs, sampleCount: this.samples }
    }

    reset(): void {
        this.pending.clear(); this.rtt = 0; this.deviation = 0; this.offset = 0; this.samples = 0; this.lastSampleAtMs = 0
        this.lastServerMonotonicRaw = undefined; this.serverMonotonicUnwrapped = 0; this.anchorServerTick = 0; this.anchorServerMonotonicMs = 0
    }

    private seed(pong: Pong, receivedAtMs: number, sampleRtt: number, midpoint: number, unwrapped: number): void {
        this.rtt = sampleRtt; this.deviation = sampleRtt / 2; this.offset = unwrapped - midpoint; this.samples = 1; this.lastSampleAtMs = receivedAtMs
        this.lastServerMonotonicRaw = pong.serverMonotonicMs; this.serverMonotonicUnwrapped = unwrapped
        this.anchorServerTick = pong.serverTick; this.anchorServerMonotonicMs = unwrapped
    }
}

export class AdaptiveInterpolationDelay {
    readonly baseDelayMs: number
    private delay: number
    private previousArrivalMs?: number

    constructor(readonly snapshotRate: number, readonly floorMs = 50, readonly maximumMs = 250) {
        if (!Number.isFinite(snapshotRate) || snapshotRate <= 0) throw new RangeError('Snapshot rate must be positive')
        const interval = 1000 / snapshotRate
        this.baseDelayMs = Math.min(maximumMs, Math.max(floorMs, interval * 2))
        this.delay = this.baseDelayMs
    }

    observeArrival(nowMs: number, clockDeviationMs = 0): number {
        if (this.previousArrivalMs !== undefined) {
            const gap = Math.max(0, nowMs - this.previousArrivalMs)
            const interval = 1000 / this.snapshotRate
            if (gap > interval * 1.5) this.delay = Math.max(this.delay, Math.min(this.maximumMs, gap * 1.1))
            else {
                const calmTarget = Math.min(this.maximumMs, Math.max(this.baseDelayMs, this.baseDelayMs + clockDeviationMs * 2))
                this.delay += (calmTarget - this.delay) * 0.08
            }
        }
        this.previousArrivalMs = nowMs
        return this.delay
    }

    reset(): void { this.delay = this.baseDelayMs; this.previousArrivalMs = undefined }
    get delayMs(): number { return this.delay }
}

export interface PredictedInput {
    readonly command: InputCommand
    readonly position: Vec3
    readonly velocity: Vec3
    readonly movementState?: MovementState
    readonly sentAtMs: number
}

export type PredictionAcknowledgementStatus = 'acknowledged' | 'stale' | 'history-overflow' | 'impossible'
export interface PredictionAcknowledgement {
    readonly status: PredictionAcknowledgementStatus
    readonly pending: readonly PredictedInput[]
    readonly acknowledged?: PredictedInput
}

export class PredictionHistory {
    private entries: PredictedInput[] = []
    private newestSequence?: number
    private lastAcknowledgedSequence?: number
    private overflowedThroughSequence?: number

    constructor(readonly capacity = 256) {
        if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError('History capacity must be positive')
    }

    push(entry: PredictedInput): { readonly overflowed: boolean; readonly dropped: number } {
        this.entries.push(entry)
        this.newestSequence = entry.command.sequence
        const dropped = Math.max(0, this.entries.length - this.capacity)
        if (dropped > 0) {
            const removed = this.entries.splice(0, dropped)
            this.overflowedThroughSequence = removed[removed.length - 1]!.command.sequence
        }
        return { overflowed: dropped > 0, dropped }
    }

    acknowledge(sequence: number): PredictionAcknowledgement {
        sequence >>>= 0
        if (this.newestSequence === undefined) {
            return { status: this.lastAcknowledgedSequence === undefined || sequence === this.lastAcknowledgedSequence ? 'stale' : 'impossible', pending: [] }
        }
        if (isSequenceNewer(sequence, this.newestSequence)) {
            return { status: 'impossible', pending: [...this.entries] }
        }
        if (this.lastAcknowledgedSequence !== undefined && !isSequenceNewer(sequence, this.lastAcknowledgedSequence)) {
            return { status: 'stale', pending: [...this.entries] }
        }
        if (this.overflowedThroughSequence !== undefined && !isSequenceNewer(sequence, this.overflowedThroughSequence)) {
            return { status: 'history-overflow', pending: [...this.entries] }
        }
        const oldestSequence = this.entries[0]?.command.sequence
        if (oldestSequence !== undefined && sequence !== oldestSequence && isSequenceNewer(oldestSequence, sequence)) {
            return { status: 'stale', pending: [...this.entries] }
        }
        let acknowledged: PredictedInput | undefined
        const pending: PredictedInput[] = []
        for (const entry of this.entries) {
            if (entry.command.sequence === sequence || !isSequenceNewer(entry.command.sequence, sequence)) acknowledged = entry
            else pending.push(entry)
        }
        if (!acknowledged) return { status: 'impossible', pending: [...this.entries] }
        this.entries = pending
        this.lastAcknowledgedSequence = sequence
        if (this.overflowedThroughSequence !== undefined && isSequenceNewer(sequence, this.overflowedThroughSequence)) this.overflowedThroughSequence = undefined
        return { status: 'acknowledged', pending: [...pending], acknowledged }
    }

    clear(): void {
        this.entries = []
        this.newestSequence = undefined
        this.lastAcknowledgedSequence = undefined
        this.overflowedThroughSequence = undefined
    }
    get size(): number { return this.entries.length }
    values(): readonly PredictedInput[] { return [...this.entries] }
}

export interface RemoteSample {
    readonly entity: EntityRecord
    readonly mode: 'interpolated' | 'extrapolated' | 'frozen'
    readonly bufferState: 'ready' | 'underflow' | 'overflow'
}

function lerp(a: number, b: number, alpha: number): number { return a + (b - a) * alpha }
function lerpAngle(a: number, b: number, alpha: number): number {
    const delta = Math.atan2(Math.sin(b - a), Math.cos(b - a))
    return a + delta * alpha
}

type MutableEntityRecord = { -readonly [Key in keyof EntityRecord]: EntityRecord[Key] } & { position: { x: number; y: number; z: number }; velocity: { x: number; y: number; z: number } }
type MutableRemoteSample = { entity: EntityRecord; mode: RemoteSample['mode']; bufferState: RemoteSample['bufferState'] }

export class RemoteEntityTimeline {
    private records: Array<{ tick: number; entity: EntityRecord }> = []
    private sampled?: MutableEntityRecord
    private result?: MutableRemoteSample

    constructor(readonly tickRate = 60, readonly maxSamples = 32, readonly maxExtrapolationMs = 250) {}

    add(serverTick: number, entity: EntityRecord): void {
        const existing = this.records.findIndex((record) => record.tick === serverTick)
        if (existing >= 0) this.records[existing] = { tick: serverTick, entity }
        else this.records.push({ tick: serverTick, entity })
        this.records.sort((a, b) => isSequenceNewer(a.tick, b.tick) ? 1 : isSequenceNewer(b.tick, a.tick) ? -1 : 0)
        if (this.records.length > this.maxSamples) this.records.splice(0, this.records.length - this.maxSamples)
    }

    sample(targetTick: number): RemoteSample | undefined {
        if (this.records.length === 0) return undefined
        const first = this.records[0]!
        if (this.records.length === 1 || !isSequenceNewer(targetTick, first.tick)) {
            const state = targetTick === first.tick ? 'ready' : 'overflow'
            return this.output(first.entity, first.entity.position.x, first.entity.position.y, first.entity.position.z, first.entity.bodyYaw, first.entity.aimPitch, state === 'ready' ? 'interpolated' : 'frozen', state)
        }
        for (let index = 1; index < this.records.length; index++) {
            const next = this.records[index]!, previous = this.records[index - 1]!
            if (!isSequenceNewer(targetTick, next.tick)) {
                const span = (next.tick - previous.tick) >>> 0
                const elapsed = (targetTick - previous.tick) >>> 0
                const alpha = span === 0 ? 1 : Math.min(1, elapsed / span)
                return this.output(next.entity, lerp(previous.entity.position.x, next.entity.position.x, alpha), lerp(previous.entity.position.y, next.entity.position.y, alpha), lerp(previous.entity.position.z, next.entity.position.z, alpha), lerpAngle(previous.entity.bodyYaw, next.entity.bodyYaw, alpha), lerp(previous.entity.aimPitch, next.entity.aimPitch, alpha), 'interpolated', 'ready')
            }
        }
        const latest = this.records[this.records.length - 1]!
        const requestedTicks = (targetTick - latest.tick) >>> 0
        const maximumTicks = this.maxExtrapolationMs * this.tickRate / 1000
        const extrapolatedTicks = Math.min(requestedTicks, maximumTicks)
        const seconds = extrapolatedTicks / this.tickRate
        return this.output(latest.entity, latest.entity.position.x + latest.entity.velocity.x * seconds, latest.entity.position.y + latest.entity.velocity.y * seconds, latest.entity.position.z + latest.entity.velocity.z * seconds, latest.entity.bodyYaw, latest.entity.aimPitch, requestedTicks > maximumTicks ? 'frozen' : 'extrapolated', 'underflow')
    }

    private output(source: EntityRecord, x: number, y: number, z: number, bodyYaw: number, aimPitch: number, mode: RemoteSample['mode'], bufferState: RemoteSample['bufferState']): RemoteSample {
        this.sampled ??= { ...source, position: { ...source.position }, velocity: { ...source.velocity } }
        const entity = this.sampled
        entity.entityId = source.entityId; entity.kind = source.kind; entity.position.x = x; entity.position.y = y; entity.position.z = z
        entity.velocity.x = source.velocity.x; entity.velocity.y = source.velocity.y; entity.velocity.z = source.velocity.z
        entity.bodyYaw = bodyYaw; entity.aimPitch = aimPitch; entity.grounded = source.grounded; entity.stateFlags = source.stateFlags
        entity.stance = source.stance; entity.movementMode = source.movementMode; entity.equippedWeapon = source.equippedWeapon
        this.result ??= { entity, mode, bufferState }; this.result.mode = mode; this.result.bufferState = bufferState
        return this.result
    }

    clear(): void { this.records = []; this.sampled = undefined; this.result = undefined }
    get size(): number { return this.records.length }
}

export class RemoteTimelineSet {
    private readonly timelines = new Map<number, RemoteEntityTimeline>()
    private interpolatedSamples = 0
    private extrapolatedSamples = 0
    private frozenSamples = 0
    private underflows = 0
    private overflows = 0
    constructor(private readonly tickRate: number, private readonly maxSamples = 32) {}

    add(serverTick: number, entity: EntityRecord): void {
        let timeline = this.timelines.get(entity.entityId)
        if (!timeline) {
            timeline = new RemoteEntityTimeline(this.tickRate, this.maxSamples)
            this.timelines.set(entity.entityId, timeline)
        }
        timeline.add(serverTick, entity)
    }
    remove(entityId: number): void { this.timelines.delete(entityId) }
    clear(): void { this.timelines.clear(); this.interpolatedSamples = 0; this.extrapolatedSamples = 0; this.frozenSamples = 0; this.underflows = 0; this.overflows = 0 }
    entries(targetTick: number): ReadonlyArray<readonly [number, RemoteSample]> {
        const result: Array<readonly [number, RemoteSample]> = []
        for (const [id, timeline] of this.timelines) {
            const sample = timeline.sample(targetTick)
            if (sample) result.push([id, sample])
        }
        return result
    }
    forEachSample(targetTick: number, visitor: (entityId: number, sample: RemoteSample) => void): void {
        for (const [id, timeline] of this.timelines) {
            const sample = timeline.sample(targetTick)
            if (sample) {
                if (sample.mode === 'interpolated') this.interpolatedSamples++
                else if (sample.mode === 'extrapolated') this.extrapolatedSamples++
                else this.frozenSamples++
                if (sample.bufferState === 'underflow') this.underflows++
                else if (sample.bufferState === 'overflow') this.overflows++
                visitor(id, sample)
            }
        }
    }
    get telemetry(): Readonly<{ interpolatedSamples: number; extrapolatedSamples: number; frozenSamples: number; underflows: number; overflows: number }> {
        return { interpolatedSamples: this.interpolatedSamples, extrapolatedSamples: this.extrapolatedSamples, frozenSamples: this.frozenSamples, underflows: this.underflows, overflows: this.overflows }
    }
    ids(): readonly number[] { return [...this.timelines.keys()] }
    get size(): number { return this.timelines.size }
}
