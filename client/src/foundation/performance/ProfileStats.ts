import { RingBuffer } from './RingBuffer'

export interface PercentileSnapshot { readonly count: number; readonly p50: number; readonly p95: number }

/** Bounded samples with percentile work paid only by explicit snapshot callers. */
export class ProfileStats {
    private readonly samples: RingBuffer<number>
    constructor(capacity = 240) { this.samples = new RingBuffer(capacity) }
    add(value: number): void { if (Number.isFinite(value) && value >= 0) this.samples.push(value) }
    clear(): void { this.samples.clear() }
    snapshot(): PercentileSnapshot {
        const values = this.samples.toArray().sort((a, b) => a - b)
        return { count: values.length, p50: percentile(values, .5), p95: percentile(values, .95) }
    }
}

function percentile(values: readonly number[], fraction: number): number {
    if (!values.length) return 0
    return values[Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * fraction) - 1))]!
}
