import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { loadMapManifest, parseMapManifest } from '../src/foundation/assets/MapManifest'

async function committedManifest(): Promise<unknown> {
    const path = new URL('../public/maps/graybox-arena/manifest.json', import.meta.url)
    return JSON.parse(await readFile(path, 'utf8')) as unknown
}

describe('client map loading metadata', () => {
    it('loads the committed arena package using client-only render metadata', async () => {
        const value = await committedManifest()
        const fetcher = vi.fn(async () => new Response(JSON.stringify(value), { status: 200 }))
        const manifest = await loadMapManifest('/maps/graybox-arena/manifest.json', fetcher)
        expect(manifest.mapId).toBe('graybox-arena')
        expect(manifest.renderAsset).toBe('scene.glb')
        expect(manifest.collisionAsset).toBe('collision.bin')
        expect(manifest.spawnPoints).toHaveLength(16)
        expect(fetcher).toHaveBeenCalledWith('/maps/graybox-arena/manifest.json')
    })

    it('rejects incompatible versions and malformed loading metadata', async () => {
        const value = await committedManifest() as any
        expect(() => parseMapManifest({ ...value, formatVersion: 2 })).toThrow(/Unsupported/)
        expect(() => parseMapManifest({ ...value, contentHash: 'not-a-hash' })).toThrow(/content hash/)
        expect(() => parseMapManifest({ ...value, spawnPoints: value.spawnPoints.slice(0, 2) })).toThrow(/spawn metadata/)
    })
})
