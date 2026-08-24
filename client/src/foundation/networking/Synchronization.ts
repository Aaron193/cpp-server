import type { EntityRecord, InputCommand, Vec3 } from '../../protocol/generated'

const UINT32_HALF_RANGE = 0x80000000

/** RFC-1982-style ordering for counters that wrap at 2^32. */
export function isSequenceNewer(candidate: number, reference: number): boolean {
    const distance = (candidate - reference) >>> 0
    return distance !== 0 && distance < UINT32_HALF_RANGE
}

export interface PredictedInput {
    readonly command: InputCommand
    readonly position: Vec3
    readonly velocity: Vec3
    readonly sentAtMs: number
}

export class PredictionHistory {
    private entries: PredictedInput[] = []

    constructor(readonly capacity = 256) {
        if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError('History capacity must be positive')
    }

    push(entry: PredictedInput): void {
        this.entries.push(entry)
        if (this.entries.length > this.capacity) this.entries.splice(0, this.entries.length - this.capacity)
    }

    acknowledge(sequence: number): { readonly pending: readonly PredictedInput[]; readonly acknowledged?: PredictedInput } {
        let acknowledged: PredictedInput | undefined
        const pending: PredictedInput[] = []
        for (const entry of this.entries) {
            if (entry.command.sequence === sequence || !isSequenceNewer(entry.command.sequence, sequence)) acknowledged = entry
            else pending.push(entry)
        }
        this.entries = pending
        return { pending: [...pending], acknowledged }
    }

    clear(): void { this.entries = [] }
    get size(): number { return this.entries.length }
    values(): readonly PredictedInput[] { return [...this.entries] }
}

export interface RemoteSample {
    readonly entity: EntityRecord
    readonly mode: 'interpolated' | 'extrapolated' | 'frozen'
}

function lerp(a: number, b: number, alpha: number): number { return a + (b - a) * alpha }
function lerpAngle(a: number, b: number, alpha: number): number {
    const delta = Math.atan2(Math.sin(b - a), Math.cos(b - a))
    return a + delta * alpha
}

type MutableEntityRecord = { -readonly [Key in keyof EntityRecord]: EntityRecord[Key] } & { position: { x: number; y: number; z: number }; velocity: { x: number; y: number; z: number } }
type MutableRemoteSample = { entity: EntityRecord; mode: RemoteSample['mode'] }

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
            return this.output(first.entity, first.entity.position.x, first.entity.position.y, first.entity.position.z, first.entity.bodyYaw, first.entity.aimPitch, 'interpolated')
        }
        for (let index = 1; index < this.records.length; index++) {
            const next = this.records[index]!, previous = this.records[index - 1]!
            if (!isSequenceNewer(targetTick, next.tick)) {
                const span = (next.tick - previous.tick) >>> 0
                const elapsed = (targetTick - previous.tick) >>> 0
                const alpha = span === 0 ? 1 : Math.min(1, elapsed / span)
                return this.output(next.entity, lerp(previous.entity.position.x, next.entity.position.x, alpha), lerp(previous.entity.position.y, next.entity.position.y, alpha), lerp(previous.entity.position.z, next.entity.position.z, alpha), lerpAngle(previous.entity.bodyYaw, next.entity.bodyYaw, alpha), lerp(previous.entity.aimPitch, next.entity.aimPitch, alpha), 'interpolated')
            }
        }
        const latest = this.records[this.records.length - 1]!
        const requestedTicks = (targetTick - latest.tick) >>> 0
        const maximumTicks = this.maxExtrapolationMs * this.tickRate / 1000
        const extrapolatedTicks = Math.min(requestedTicks, maximumTicks)
        const seconds = extrapolatedTicks / this.tickRate
        return this.output(latest.entity, latest.entity.position.x + latest.entity.velocity.x * seconds, latest.entity.position.y + latest.entity.velocity.y * seconds, latest.entity.position.z + latest.entity.velocity.z * seconds, latest.entity.bodyYaw, latest.entity.aimPitch, requestedTicks > maximumTicks ? 'frozen' : 'extrapolated')
    }

    private output(source: EntityRecord, x: number, y: number, z: number, bodyYaw: number, aimPitch: number, mode: RemoteSample['mode']): RemoteSample {
        this.sampled ??= { ...source, position: { ...source.position }, velocity: { ...source.velocity } }
        const entity = this.sampled
        entity.entityId = source.entityId; entity.kind = source.kind; entity.position.x = x; entity.position.y = y; entity.position.z = z
        entity.velocity.x = source.velocity.x; entity.velocity.y = source.velocity.y; entity.velocity.z = source.velocity.z
        entity.bodyYaw = bodyYaw; entity.aimPitch = aimPitch; entity.grounded = source.grounded; entity.stateFlags = source.stateFlags
        entity.equippedWeapon = source.equippedWeapon; entity.health = source.health; entity.weaponState = source.weaponState
        this.result ??= { entity, mode }; this.result.mode = mode
        return this.result
    }

    clear(): void { this.records = []; this.sampled = undefined; this.result = undefined }
    get size(): number { return this.records.length }
}

export class RemoteTimelineSet {
    private readonly timelines = new Map<number, RemoteEntityTimeline>()
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
    clear(): void { this.timelines.clear() }
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
            if (sample) visitor(id, sample)
        }
    }
    ids(): readonly number[] { return [...this.timelines.keys()] }
    get size(): number { return this.timelines.size }
}
