/** Fixed-capacity FIFO storage. Iteration never allocates. */
export class RingBuffer<T> {
    private readonly storage: Array<T | undefined>
    private head = 0
    private length = 0

    constructor(readonly capacity: number) {
        if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError('Ring capacity must be positive')
        this.storage = new Array<T | undefined>(capacity)
    }

    push(value: T): void {
        const index = (this.head + this.length) % this.capacity
        this.storage[index] = value
        if (this.length < this.capacity) this.length++
        else this.head = (this.head + 1) % this.capacity
    }

    forEach(visitor: (value: T, index: number) => void): void {
        for (let index = 0; index < this.length; index++) visitor(this.storage[(this.head + index) % this.capacity]!, index)
    }

    clear(): void {
        for (let index = 0; index < this.length; index++) this.storage[(this.head + index) % this.capacity] = undefined
        this.head = 0
        this.length = 0
    }

    toArray(): T[] {
        const result = new Array<T>(this.length)
        this.forEach((value, index) => { result[index] = value })
        return result
    }

    get size(): number { return this.length }
}
