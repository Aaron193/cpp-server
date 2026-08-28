import type { AssetContainer, InstantiatedEntries } from '@babylonjs/core/assetContainer.js'
import { Color3 } from '@babylonjs/core/Maths/math.color.js'
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js'
import { CreateLineSystem } from '@babylonjs/core/Meshes/Builders/linesBuilder.js'
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder.js'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js'
import { loadCollisionMesh, type CollisionMeshData } from '../assets/CollisionMesh'
import { loadMapGameplay, loadMapManifest, type ClientMapGameplay, type ClientMapManifest } from '../assets/MapManifest'
import type { ClientModule, ClientModuleContext, FrameUpdate } from '../lifecycle'
import { ARENA, ASSETS, ENVIRONMENT, INPUT, PHYSICS, RENDER_QUALITY, SCENE } from '../services'
import { WorldPresentation, type WorldPresentationSnapshot } from '../rendering/WorldPresentation'

function joinAsset(root: string, asset: string): string {
    return `${root.replace(/\/+$/, '')}/${asset}`
}

function matchingBounds(manifest: ClientMapManifest, collision: CollisionMeshData): boolean {
    return [...manifest.worldBounds.min, ...manifest.worldBounds.max].every((value, index) =>
        Math.abs(value - [...collision.bounds.min, ...collision.bounds.max][index]) < 1e-4)
}

export class MapModule implements ClientModule {
    readonly name = 'map'
    private context?: ClientModuleContext
    private container?: AssetContainer
    private instantiated?: InstantiatedEntries
    private worldPresentation?: WorldPresentation
    private debugMeshes: AbstractMesh[] = []
    private debugVisible = false
    private manifest?: ClientMapManifest
    private gameplay?: ClientMapGameplay
    private collision?: CollisionMeshData
    private readonly lazyAssets = new Map<string, Promise<Uint8Array | null>>()
    private readonly loadTiming = { manifestMs: 0, collisionMs: 0, renderMs: 0, physicsMs: 0, totalMs: 0 }

    constructor(private readonly mapRoot = '/maps/graybox-arena') {}

    async initialize(context: ClientModuleContext): Promise<void> {
        const loadStarted = performance.now()
        this.context = context
        context.services.provide(ARENA, this)
        const manifest = await loadMapManifest(joinAsset(this.mapRoot, 'manifest.json'))
        const gameplay = await loadMapGameplay(joinAsset(this.mapRoot, manifest.assets.gameplay ?? ''), manifest)
        const manifestLoaded = performance.now()
        const collision = await loadCollisionMesh(joinAsset(this.mapRoot, manifest.assets.collision))
        const collisionLoaded = performance.now()
        if (!matchingBounds(manifest, collision)) throw new Error('Manifest and collision world bounds do not match')

        const scene = context.services.get(SCENE)
        const container = await context.services.get(ASSETS).importContainer(joinAsset(this.mapRoot, manifest.assets.render))
        const renderLoaded = performance.now()
        if (container.meshes.length === 0) {
            container.dispose()
            throw new Error('Map render asset contains no meshes')
        }
        this.container = container
        const existingMeshes = new Set(scene.meshes)
        const instantiated = container.instantiateModelsToScene((name) => `map/${name}`, false)
        this.instantiated = instantiated
        const mapMeshes = scene.meshes.filter((mesh) => !existingMeshes.has(mesh))
        context.services.get(ENVIRONMENT).apply(manifest.environment, mapMeshes)
        const frozenMaterials = new Set<object>()
        for (const mesh of mapMeshes) {
            mesh.isPickable = false; mesh.alwaysSelectAsActiveMesh = false; mesh.freezeWorldMatrix()
            const mapMaterial = mesh.material
            if (mapMaterial && !frozenMaterials.has(mapMaterial)) { mapMaterial.freeze(); frozenMaterials.add(mapMaterial) }
        }
        this.manifest = manifest
        this.gameplay = gameplay
        this.collision = collision
        this.worldPresentation = new WorldPresentation(scene, gameplay, context.services.get(RENDER_QUALITY).profile, mapMeshes)
        this.createDebugOverlay(collision, gameplay)

        const spawn = gameplay.spawnPoints[0]
        context.services.get(INPUT).angles.set(spawn.yaw, 0)
        await context.services.get(PHYSICS).createWorld(collision, {
            x: spawn.position[0], y: spawn.position[1], z: spawn.position[2],
        })
        const physicsReady = performance.now()
        this.loadTiming.manifestMs = manifestLoaded - loadStarted
        this.loadTiming.collisionMs = collisionLoaded - manifestLoaded
        this.loadTiming.renderMs = renderLoaded - collisionLoaded
        this.loadTiming.physicsMs = physicsReady - renderLoaded
        this.loadTiming.totalMs = physicsReady - loadStarted
    }

    update(_frame: FrameUpdate): void {
        if (this.context?.services.get(INPUT).consumeCollisionDebugToggle()) this.setDebugVisible(!this.debugVisible)
    }

    private createDebugOverlay(collision: CollisionMeshData, gameplay: ClientMapGameplay): void {
        if (!this.context) return
        const scene = this.context.services.get(SCENE)
        const lines: Vector3[][] = []
        for (let index = 0; index < collision.indices.length; index += 3) {
            const triangle = [0, 1, 2].map((corner) => {
                const vertex = collision.indices[index + corner] * 3
                return new Vector3(collision.vertices[vertex], collision.vertices[vertex + 1], collision.vertices[vertex + 2])
            })
            lines.push([triangle[0], triangle[1], triangle[2], triangle[0]])
        }
        const wireframe = CreateLineSystem('collision-debug', { lines }, scene)
        wireframe.color = new Color3(1, 0.2, 0.1)
        wireframe.alpha = 0.75
        wireframe.isPickable = false
        this.debugMeshes.push(wireframe)

        const spawnMaterial = new StandardMaterial('spawn-debug-material', scene)
        spawnMaterial.emissiveColor = new Color3(0.1, 1, 0.35)
        spawnMaterial.disableLighting = true
        for (const spawn of gameplay.spawnPoints) {
            const marker = CreateSphere(`spawn-debug/${spawn.id}`, { diameter: 0.35, segments: 8 }, scene)
            marker.position.set(...spawn.position)
            marker.material = spawnMaterial
            marker.isPickable = false
            this.debugMeshes.push(marker)
        }
        this.setDebugVisible(false)
    }

    setDebugVisible(visible: boolean): void {
        this.debugVisible = visible
        for (const mesh of this.debugMeshes) mesh.setEnabled(visible)
    }

    get status(): string {
        if (!this.manifest || !this.collision) return 'Loading arena…'
        return `${this.manifest.mapId} · ${this.collision.indices.length / 3} collision triangles`
    }
    get isDebugVisible(): boolean { return this.debugVisible }
    get mapManifest(): ClientMapManifest | undefined { return this.manifest }
    get mapGameplay(): ClientMapGameplay | undefined { return this.gameplay }
    /** Radar and navigation stay unfetched until a future HUD/bot consumer asks. */
    loadRadar(): Promise<Uint8Array | null> { return this.loadOptionalAsset('radar') }
    loadNavigation(): Promise<Uint8Array | null> { return this.loadOptionalAsset('navigation') }
    private loadOptionalAsset(kind: 'radar' | 'navigation'): Promise<Uint8Array | null> {
        const existing = this.lazyAssets.get(kind); if (existing) return existing
        const pending = (async () => {
            const manifest = this.manifest, name = manifest?.assets[kind]
            if (!manifest || !name) return null
            const response = await fetch(joinAsset(this.mapRoot, name)); if (!response.ok) throw new Error(`Unable to load map ${kind} (${response.status})`)
            const bytes = new Uint8Array(await response.arrayBuffer()), digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
            const actual = `sha256:${[...digest].map((value) => value.toString(16).padStart(2, '0')).join('')}`
            if (actual !== manifest.assetHashes[name]) throw new Error(`Map ${kind} asset hash mismatch`)
            return bytes
        })()
        this.lazyAssets.set(kind, pending); return pending
    }
    /** Development baseline timings for the current staged map load. */
    get loadMetrics(): Readonly<typeof this.loadTiming> { return this.loadTiming }
    get presentationMetrics(): WorldPresentationSnapshot {
        return this.worldPresentation?.snapshot ?? { containerInstances: 0, staticMeshes: 0, decorativeSources: 0, decorativeInstances: 0, lodLevels: 0, decorationBudget: 0 }
    }

    dispose(): void {
        for (const mesh of this.debugMeshes) mesh.dispose()
        this.debugMeshes = []
        this.worldPresentation?.dispose()
        this.worldPresentation = undefined
        this.instantiated?.dispose()
        this.instantiated = undefined
        this.container?.dispose()
        this.container = undefined
        this.gameplay = undefined
        this.lazyAssets.clear()
        this.context?.services.remove(ARENA)
        this.context = undefined
    }
}

/** @deprecated Import MapModule from ./MapModule. */
export const OfflineArenaModule = MapModule
