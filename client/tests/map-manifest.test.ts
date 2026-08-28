import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { loadMapGameplay, loadMapManifest, parseMapManifest } from '../src/foundation/assets/MapManifest'

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
        expect(manifest.assets.render).toBe('scene.glb')
        expect(manifest.assets.collision).toBe('collision.bin')
        expect(manifest.formatVersion).toBe(2)
        expect(fetcher).toHaveBeenCalledWith('/maps/graybox-arena/manifest.json')
    })

    it('rejects incompatible versions and malformed loading metadata', async () => {
        const value = await committedManifest() as any
        expect(() => parseMapManifest({ ...value, formatVersion: 1 })).toThrow(/Unsupported/)
        expect(() => parseMapManifest({ ...value, formatVersion: 3 })).toThrow(/Unsupported/)
        expect(() => parseMapManifest({ ...value, contentHash: 'not-a-hash' })).toThrow(/content hash/)
        expect(() => parseMapManifest({ ...value, surprise: true })).toThrow(/unsupported property/)
        expect(() => parseMapManifest({ ...value, environment: { ...value.environment, exposure: Number.NaN } })).toThrow(/finite range/)
    })

    it('strictly parses the separately lazy-loaded gameplay metadata', async () => {
        const manifest = parseMapManifest(await committedManifest())
        const gameplay = JSON.parse(await readFile(new URL('../public/maps/graybox-arena/gameplay.json', import.meta.url), 'utf8'))
        const fetcher = vi.fn(async () => new Response(JSON.stringify(gameplay), { status: 200 }))
        expect((await loadMapGameplay('/maps/graybox-arena/gameplay.json', manifest, fetcher)).spawnPoints).toHaveLength(16)
        expect(() => parseMapManifest({ ...(manifest as any), formatVersion: 999 })).toThrow(/Unsupported/)
    })
})
