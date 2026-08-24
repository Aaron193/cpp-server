export type Vec3 = readonly [number, number, number]

export interface WorldBounds {
    readonly min: Vec3
    readonly max: Vec3
}

export interface MapSpawn {
    readonly id: string
    readonly position: Vec3
    readonly yaw: number
}

export interface MapMarker {
    readonly id: string
    readonly type: 'landmark' | 'pickup' | 'objective'
    readonly position: Vec3
}

export interface MapManifest {
    readonly format: 'cpp-server-map'
    readonly formatVersion: 1
    readonly mapId: string
    readonly contentHash: string
    readonly coordinateSystem: {
        readonly handedness: 'right'
        readonly upAxis: 'Y'
        readonly units: 'meters'
    }
    readonly worldBounds: WorldBounds
    readonly renderAsset: 'scene.glb'
    readonly collisionAsset: 'collision.bin'
    readonly debugReport: 'debug-report.json'
    readonly spawnPoints: readonly MapSpawn[]
    readonly markers: readonly MapMarker[]
}

export interface TriangleMesh {
    readonly name: string
    readonly positions: readonly Vec3[]
    readonly indices: readonly number[]
}

export interface CompiledMap {
    readonly manifest: MapManifest
    readonly files: ReadonlyMap<string, Uint8Array>
}

export class MapCompileError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'MapCompileError'
    }
}
