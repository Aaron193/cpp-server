import { describe, expect, it, vi } from 'vitest'
import { ObjectPool } from '../src/foundation/combat/ObjectPool'

describe('combat effect pool', () => {
    it('has fixed capacity and resets reused effects', () => {
        const reset = vi.fn(), pool = new ObjectPool(2, (id) => ({ id }), reset)
        const first = pool.acquire()!, second = pool.acquire()!
        expect(pool.acquire()).toBeUndefined(); expect(pool.activeCount).toBe(2)
        pool.release(first); expect(reset).toHaveBeenCalledWith(first); expect(pool.acquire()).toBe(first)
        pool.releaseAll(); expect(pool.activeCount).toBe(0); expect(pool.availableCount).toBe(2)
        expect(second.id).not.toBe(first.id)
    })
})
