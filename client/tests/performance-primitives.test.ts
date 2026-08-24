import { describe, expect, it } from 'vitest'
import { RingBuffer } from '../src/foundation/performance/RingBuffer'
import { ProfileStats } from '../src/foundation/performance/ProfileStats'
import { setTextIfChanged } from '../src/foundation/hud/DomDiff'
import { ObjectPool } from '../src/foundation/combat/ObjectPool'

describe('performance primitives', () => {
    it('keeps FIFO order while overwriting at a fixed capacity', () => {
        const ring = new RingBuffer<number>(3); ring.push(1); ring.push(2); ring.push(3); ring.push(4)
        const visited: number[] = []; ring.forEach((value) => visited.push(value))
        expect(visited).toEqual([2, 3, 4]); expect(ring.size).toBe(3)
        ring.clear(); expect(ring.size).toBe(0)
    })
    it('reports deterministic nearest-rank percentiles over bounded samples', () => {
        const stats = new ProfileStats(4); for (const value of [50, 10, 40, 20, 30]) stats.add(value)
        expect(stats.snapshot()).toEqual({ count: 4, p50: 20, p95: 40 })
    })
    it('skips redundant DOM text writes', () => {
        let writes = 0, value = 'same'
        const node = { get textContent() { return value }, set textContent(next: string | null) { writes++; value = next ?? '' } } as unknown as Node
        expect(setTextIfChanged(node, 'same')).toBe(false); expect(setTextIfChanged(node, 'next')).toBe(true); expect(writes).toBe(1)
    })
    it('iterates and releases active pooled objects without snapshots', () => {
        const pool = new ObjectPool(2, (id) => ({ id }))
        const first = pool.acquire()!, second = pool.acquire()!
        pool.forEachActive((value) => pool.release(value))
        expect(pool.activeCount).toBe(0); expect(pool.availableCount).toBe(2); expect([first.id, second.id].sort()).toEqual([0, 1])
    })
})
