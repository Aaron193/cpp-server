export class ObjectPool<T> {
    private readonly free: T[]
    private readonly active = new Set<T>()
    constructor(readonly capacity: number, factory: (index: number) => T, private readonly reset: (value: T) => void = () => {}) {
        if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError('Pool capacity must be positive')
        this.free = Array.from({ length: capacity }, (_, index) => factory(index))
    }
    acquire(): T | undefined {
        const value = this.free.pop()
        if (value !== undefined) this.active.add(value)
        return value
    }
    release(value: T): void {
        if (!this.active.delete(value)) return
        this.reset(value); this.free.push(value)
    }
    releaseAll(): void { for (const value of this.active) this.release(value) }
    forEach(visitor: (value: T) => void): void { for (const value of this.free) visitor(value); for (const value of this.active) visitor(value) }
    forEachActive(visitor: (value: T) => void): void { for (const value of this.active) visitor(value) }
    get activeCount(): number { return this.active.size }
    get availableCount(): number { return this.free.length }
}
