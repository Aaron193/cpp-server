import { describe, expect, it, vi } from 'vitest'
import {
    assetId,
    AssetRegistry,
    type AssetSourceLoader,
    type LoadedAsset,
} from '../src/foundation/assets/AssetRegistry'

interface FakeInstance {
    readonly sequence: number
    readonly prefix: string
}

describe('AssetRegistry', () => {
    it('loads once by stable id and creates independent instances', async () => {
        let sequence = 0
        const loaded: LoadedAsset<FakeInstance> = {
            instantiate: ({ namePrefix }) => ({
                sequence: ++sequence,
                prefix: namePrefix,
            }),
            dispose: vi.fn(),
        }
        const loader: AssetSourceLoader<FakeInstance> = {
            load: vi.fn(async () => loaded),
        }
        const crateId = assetId('prop.crate')
        const registry = new AssetRegistry(
            [{ id: crateId, source: '/models/crate.glb' }],
            loader
        )

        const [first, second] = await Promise.all([
            registry.instantiate(crateId),
            registry.instantiate(crateId, { namePrefix: 'loot' }),
        ])

        expect(loader.load).toHaveBeenCalledOnce()
        expect(loader.load).toHaveBeenCalledWith('/models/crate.glb')
        expect(first).toEqual({ sequence: 1, prefix: 'prop.crate' })
        expect(second).toEqual({ sequence: 2, prefix: 'loot' })
    })

    it('does not expose filenames as ids and rejects unknown ids', async () => {
        expect(() => assetId('crate.glb')).toThrow(TypeError)
        expect(() => assetId('../crate')).toThrow(TypeError)

        const registry = new AssetRegistry([], {
            load: vi.fn(),
        })
        await expect(registry.instantiate(assetId('prop.crate'))).rejects.toThrow(
            'Unknown asset id: prop.crate'
        )
    })

    it('evicts a failed load so it can be retried', async () => {
        const loaded: LoadedAsset<FakeInstance> = {
            instantiate: ({ namePrefix }) => ({ sequence: 1, prefix: namePrefix }),
            dispose: vi.fn(),
        }
        const load = vi
            .fn<AssetSourceLoader<FakeInstance>['load']>()
            .mockRejectedValueOnce(new Error('temporary failure'))
            .mockResolvedValueOnce(loaded)
        const id = assetId('character.player')
        const registry = new AssetRegistry(
            [{ id, source: '/models/player.glb' }],
            { load }
        )

        await expect(registry.preload(id)).rejects.toThrow('temporary failure')
        await expect(registry.instantiate(id)).resolves.toEqual({
            sequence: 1,
            prefix: 'character.player',
        })
        expect(load).toHaveBeenCalledTimes(2)
    })
})
