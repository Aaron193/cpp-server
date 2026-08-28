export interface EffectSlot { startedAtMs: number; priority: number }
export interface EffectPoolTelemetry { readonly active: number; readonly capacity: number; readonly replacements: number; readonly rejected: number }

/** Fixed storage with oldest/lowest-priority replacement and no steady-state creation. */
export class BoundedEffectFamily<T extends EffectSlot> {
    private readonly active = new Set<T>()
    private readonly free: T[]
    private replacementCount = 0
    private rejectionCount = 0
    constructor(readonly capacity: number, factory: (index: number) => T, private readonly reset: (slot: T) => void) {
        if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError('Effect capacity must be positive')
        this.free = Array.from({ length: capacity }, (_, index) => factory(index))
    }
    acquire(nowMs: number, priority = 0): T {
        let slot = this.free.pop()
        if (!slot) {
            slot = this.replacementCandidate(priority)
            if (!slot) { this.rejectionCount++; slot = this.oldest()! }
            this.active.delete(slot); this.reset(slot); this.replacementCount++
        }
        slot.startedAtMs = nowMs; slot.priority = priority; this.active.add(slot); return slot
    }
    release(slot: T): void { if (!this.active.delete(slot)) return; this.reset(slot); this.free.push(slot) }
    releaseWhere(predicate: (slot: T) => boolean): number { let count = 0; for (const slot of [...this.active]) if (predicate(slot)) { this.release(slot); count++ } return count }
    forEach(visitor: (slot: T) => void): void { for (const slot of this.free) visitor(slot); for (const slot of this.active) visitor(slot) }
    forEachActive(visitor: (slot: T) => void): void { for (const slot of this.active) visitor(slot) }
    get telemetry(): EffectPoolTelemetry { return { active: this.active.size, capacity: this.capacity, replacements: this.replacementCount, rejected: this.rejectionCount } }
    private replacementCandidate(priority: number): T | undefined { let candidate: T | undefined; for (const slot of this.active) if (slot.priority <= priority && (!candidate || slot.priority < candidate.priority || slot.priority === candidate.priority && slot.startedAtMs < candidate.startedAtMs)) candidate = slot; return candidate }
    private oldest(): T | undefined { let value: T | undefined; for (const slot of this.active) if (!value || slot.startedAtMs < value.startedAtMs) value = slot; return value }
}

export class DecalBudget {
    private readonly cells = new Map<string, number[]>()
    private total = 0
    constructor(readonly perCellMaterial: number, readonly capacity: number, readonly cellMeters = 8) {}
    add(position: { readonly x: number; readonly z: number }, material: string, nowMs: number): boolean {
        const key = `${Math.floor(position.x / this.cellMeters)},${Math.floor(position.z / this.cellMeters)}/${material}`
        let rows = this.cells.get(key); if (!rows) { rows = []; this.cells.set(key, rows) }
        while (rows.length >= this.perCellMaterial) { rows.shift(); this.total-- }
        if (this.total >= this.capacity) { let oldestKey: string | undefined, oldest = Infinity; for (const [cell, values] of this.cells) if ((values[0] ?? Infinity) < oldest) { oldest = values[0]!; oldestKey = cell } if (oldestKey) { const values = this.cells.get(oldestKey)!; values.shift(); this.total--; if (!values.length) this.cells.delete(oldestKey) } }
        rows.push(nowMs); this.total++; return true
    }
    clear(): void { this.cells.clear(); this.total = 0 }
    get active(): number { return this.total }
}
