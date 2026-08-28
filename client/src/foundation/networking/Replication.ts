import {
    EntityKind,
    type EntityHandle,
    type EntityRecord,
    type PublicEntityState,
    type SnapshotDelta,
    type UpdatedEntity,
} from '../../protocol/generated'
import { isSequenceNewer } from './Synchronization'

export const UPDATE_POSITION = 1 << 0
export const UPDATE_VELOCITY = 1 << 1
export const UPDATE_BODY_YAW = 1 << 2
export const UPDATE_AIM_PITCH = 1 << 3
export const UPDATE_GROUNDED = 1 << 4
export const UPDATE_STATE_FLAGS = 1 << 5
export const UPDATE_EQUIPPED_WEAPON = 1 << 6
export const UPDATE_ALL = (1 << 7) - 1

/** Exact, collision-free JS integer key for a u32 slot plus u16 generation. */
export function entityHandleKey(handle: EntityHandle): number {
    return handle.slot * 0x10000 + handle.generation
}

export function publicStateToEntityRecord(state: PublicEntityState): EntityRecord {
    return {
        entityId: entityHandleKey(state.handle), kind: state.kind,
        position: { ...state.position }, velocity: { ...state.velocity },
        bodyYaw: state.bodyYaw, aimPitch: state.aimPitch,
        grounded: state.grounded, stateFlags: state.stateFlags,
        equippedWeapon: state.equippedWeapon,
    }
}

export function validateUpdateMask(update: UpdatedEntity): void {
    if ((update.changeMask & ~UPDATE_ALL) !== 0) throw new Error('SnapshotDelta update has unknown field-mask bits')
    const fields: ReadonlyArray<readonly [number, unknown]> = [
        [UPDATE_POSITION, update.position], [UPDATE_VELOCITY, update.velocity],
        [UPDATE_BODY_YAW, update.bodyYaw], [UPDATE_AIM_PITCH, update.aimPitch],
        [UPDATE_GROUNDED, update.grounded], [UPDATE_STATE_FLAGS, update.stateFlags],
        [UPDATE_EQUIPPED_WEAPON, update.equippedWeapon],
    ]
    for (const [bit, value] of fields) {
        if (((update.changeMask & bit) !== 0) !== (value !== null))
            throw new Error('SnapshotDelta update field presence does not match changeMask')
    }
    if (update.changeMask === 0) throw new Error('SnapshotDelta contains an empty update')
}

function applyUpdate(state: EntityRecord, update: UpdatedEntity): EntityRecord {
    validateUpdateMask(update)
    return {
        ...state,
        position: update.position ? { ...update.position } : state.position,
        velocity: update.velocity ? { ...update.velocity } : state.velocity,
        bodyYaw: update.bodyYaw ?? state.bodyYaw,
        aimPitch: update.aimPitch ?? state.aimPitch,
        grounded: update.grounded ?? state.grounded,
        stateFlags: update.stateFlags ?? state.stateFlags,
        equippedWeapon: update.equippedWeapon ?? state.equippedWeapon,
    }
}

export interface AppliedSnapshotDelta {
    readonly createdOrUpdated: ReadonlyArray<EntityRecord>
    readonly removedKeys: ReadonlyArray<number>
}

/**
 * Decoder state for the v6 rule: every non-reset delta names the immediately
 * previous applied ordered WebSocket delta. Any mismatch is fatal to this
 * baseline and must cause reconnect/reset rather than speculative application.
 */
export class SnapshotDeltaBaseline {
    private readonly entities = new Map<number, EntityRecord>()
    private lastSequence?: number
    private revision?: number

    apply(delta: SnapshotDelta): AppliedSnapshotDelta {
        if (delta.baselineReset) {
            if (delta.baselineSequence !== 0) throw new Error('SnapshotDelta reset must use baseline sequence zero')
            this.entities.clear()
        } else {
            if (this.lastSequence === undefined || delta.baselineSequence !== this.lastSequence ||
                this.revision !== delta.baselineRevision)
                throw new Error('SnapshotDelta baseline mismatch; reconnect required')
            if (!isSequenceNewer(delta.snapshotSequence, this.lastSequence))
                throw new Error('SnapshotDelta sequence is stale')
        }
        const touched: EntityRecord[] = []
        const removed: number[] = []
        for (const created of delta.created) {
            const key = entityHandleKey(created.state.handle)
            if (this.entities.has(key)) throw new Error('SnapshotDelta creates an existing handle')
            const state = publicStateToEntityRecord(created.state)
            this.entities.set(key, state); touched.push(state)
        }
        for (const update of delta.updated) {
            const key = entityHandleKey(update.handle)
            const state = this.entities.get(key)
            if (!state) throw new Error('SnapshotDelta updates an unknown handle')
            const next = applyUpdate(state, update)
            this.entities.set(key, next); touched.push(next)
        }
        for (const removal of delta.removed) {
            const key = entityHandleKey(removal.handle)
            if (!this.entities.delete(key)) throw new Error('SnapshotDelta removes an unknown handle')
            removed.push(key)
        }
        this.lastSequence = delta.snapshotSequence
        this.revision = delta.baselineRevision
        return { createdOrUpdated: touched, removedKeys: removed }
    }

    clear(): void { this.entities.clear(); this.lastSequence = undefined; this.revision = undefined }
    get size(): number { return this.entities.size }
    get(handle: EntityHandle): EntityRecord | undefined { return this.entities.get(entityHandleKey(handle)) }
}

export function isReplicatedPlayer(record: EntityRecord): boolean {
    return record.kind === EntityKind.Player
}
