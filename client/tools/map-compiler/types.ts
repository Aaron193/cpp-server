export type Vec3 = readonly [number, number, number]
export interface WorldBounds { readonly min: Vec3; readonly max: Vec3 }
export interface MapSpawn { readonly id: string; readonly position: Vec3; readonly yaw: number; readonly modes: readonly string[]; readonly team: string | null; readonly weight: number; readonly clearanceRadius: number }
export interface MapMarker { readonly id: string; readonly type: 'landmark' | 'pickup' | 'objective' | 'callout'; readonly position: Vec3 }
export interface MapZone { readonly id: string; readonly type: 'playable' | 'kill' | 'objective' | 'audio' | 'reverb' | 'projectile-fence'; readonly min: Vec3; readonly max: Vec3 }
export interface NavigationNode { readonly id: string; readonly position: Vec3; readonly links: readonly string[] }

export interface MapManifest {
    readonly format: 'cpp-server-map'; readonly formatVersion: 2; readonly mapId: string; readonly contentHash: string
    readonly coordinateSystem: { readonly handedness: 'right'; readonly upAxis: 'Y'; readonly units: 'meters' }
    readonly worldBounds: WorldBounds
    readonly assets: { readonly render: 'scene.glb'; readonly collision: 'collision.bin'; readonly gameplay: 'gameplay.json'; readonly navigation: 'navigation.json' | null; readonly radar: 'radar.svg' | null; readonly debug: 'debug-report.json' }
    readonly assetHashes: Readonly<Record<string, string>>
    readonly environment: { readonly clearColor: readonly [number, number, number]; readonly exposure: number; readonly sunDirection: Vec3; readonly shadowDistance: number }
    readonly policy: { readonly stepSmoothingMax: number; readonly audioDistanceScale: number; readonly radarNorthYaw: number }
}

export interface TriangleMesh { readonly name: string; readonly positions: readonly Vec3[]; readonly indices: readonly number[]; readonly material?: { readonly name: string; readonly baseColor: readonly [number, number, number, number]; readonly metallic: number; readonly roughness: number } }
export interface CompiledMap { readonly manifest: MapManifest; readonly files: ReadonlyMap<string, Uint8Array> }

export class MapCompileError extends Error {
    constructor(message: string) {
        super(message); this.name = 'MapCompileError'
    }
}
