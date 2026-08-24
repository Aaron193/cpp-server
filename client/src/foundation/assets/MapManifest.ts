export type MapVec3 = readonly [number, number, number]

export interface ClientMapManifest {
    readonly format: 'cpp-server-map'
    readonly formatVersion: 1
    readonly mapId: string
    readonly contentHash: string
    readonly coordinateSystem: {
        readonly handedness: 'right'
        readonly upAxis: 'Y'
        readonly units: 'meters'
    }
    readonly worldBounds: { readonly min: MapVec3; readonly max: MapVec3 }
    readonly renderAsset: string
    readonly collisionAsset: string
    readonly spawnPoints: readonly { readonly id: string; readonly position: MapVec3; readonly yaw: number }[]
}

function vec3(value: unknown): value is MapVec3 {
    return Array.isArray(value) && value.length === 3 && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
}

export function parseMapManifest(value: unknown): ClientMapManifest {
    if (value === null || typeof value !== 'object') throw new TypeError('Map manifest must be an object')
    const manifest = value as Record<string, any>
    if (manifest.format !== 'cpp-server-map' || manifest.formatVersion !== 1) throw new TypeError('Unsupported map manifest format')
    if (typeof manifest.mapId !== 'string' || !/^[a-z][a-z0-9-]*$/.test(manifest.mapId)) throw new TypeError('Invalid map id')
    if (typeof manifest.contentHash !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(manifest.contentHash)) throw new TypeError('Invalid map content hash')
    if (manifest.coordinateSystem?.handedness !== 'right' || manifest.coordinateSystem?.upAxis !== 'Y' || manifest.coordinateSystem?.units !== 'meters') throw new TypeError('Unsupported map coordinate system')
    if (!vec3(manifest.worldBounds?.min) || !vec3(manifest.worldBounds?.max)) throw new TypeError('Invalid map world bounds')
    if (typeof manifest.renderAsset !== 'string' || !/^[a-zA-Z0-9._-]+\.glb$/.test(manifest.renderAsset)) throw new TypeError('Invalid map render asset')
    if (typeof manifest.collisionAsset !== 'string' || !/^[a-zA-Z0-9._-]+\.bin$/.test(manifest.collisionAsset)) throw new TypeError('Invalid map collision asset')
    if (!Array.isArray(manifest.spawnPoints) || manifest.spawnPoints.length < 12 || manifest.spawnPoints.some((spawn: any) => typeof spawn?.id !== 'string' || !vec3(spawn.position) || typeof spawn.yaw !== 'number' || !Number.isFinite(spawn.yaw))) throw new TypeError('Invalid map spawn metadata')
    return manifest as unknown as ClientMapManifest
}

export async function loadMapManifest(url: string, fetcher: typeof fetch = fetch): Promise<ClientMapManifest> {
    const response = await fetcher(url)
    if (!response.ok) throw new Error(`Unable to load map manifest (${response.status})`)
    return parseMapManifest(await response.json())
}
