import type { AssetContainer } from '@babylonjs/core/assetContainer.js'
import { Color3 } from '@babylonjs/core/Maths/math.color.js'
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js'
import { CreateLineSystem } from '@babylonjs/core/Meshes/Builders/linesBuilder.js'
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder.js'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js'
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js'
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader.js'
import '@babylonjs/loaders/glTF/index.js'
import { loadCollisionMesh, type CollisionMeshData } from '../assets/CollisionMesh'
import { loadMapManifest, type ClientMapManifest } from '../assets/MapManifest'
import type { ClientModule, ClientModuleContext, FrameUpdate } from '../lifecycle'
import { ARENA, INPUT, PHYSICS, SCENE } from '../services'

function joinAsset(root: string, asset: string): string {
    return `${root.replace(/\/+$/, '')}/${asset}`
}

function matchingBounds(manifest: ClientMapManifest, collision: CollisionMeshData): boolean {
    return [...manifest.worldBounds.min, ...manifest.worldBounds.max].every((value, index) =>
        Math.abs(value - [...collision.bounds.min, ...collision.bounds.max][index]) < 1e-4)
}

export class OfflineArenaModule implements ClientModule {
    readonly name = 'offline-arena'
    private context?: ClientModuleContext
    private container?: AssetContainer
    private debugMeshes: AbstractMesh[] = []
    private debugVisible = false
    private manifest?: ClientMapManifest
    private collision?: CollisionMeshData

    constructor(private readonly mapRoot = '/maps/graybox-arena') {}

    async initialize(context: ClientModuleContext): Promise<void> {
        this.context = context
        context.services.provide(ARENA, this)
        const manifest = await loadMapManifest(joinAsset(this.mapRoot, 'manifest.json'))
        if (manifest.mapId !== 'graybox-arena') throw new Error(`Expected graybox-arena, received ${manifest.mapId}`)
        const collision = await loadCollisionMesh(joinAsset(this.mapRoot, manifest.collisionAsset))
        if (!matchingBounds(manifest, collision)) throw new Error('Manifest and collision world bounds do not match')

        const scene = context.services.get(SCENE)
        const container = await LoadAssetContainerAsync(joinAsset(this.mapRoot, manifest.renderAsset), scene)
        if (container.meshes.length === 0) {
            container.dispose()
            throw new Error('Map render asset contains no meshes')
        }
        container.addAllToScene()
        // The authored graybox has no texture assets, so compressed-texture variants would add no value.
        const frozenMaterials = new Set<object>()
        for (const mesh of container.meshes) {
            mesh.isPickable = false; mesh.alwaysSelectAsActiveMesh = false; mesh.freezeWorldMatrix()
            const mapMaterial = mesh.material
            if (mapMaterial && !frozenMaterials.has(mapMaterial)) { mapMaterial.freeze(); frozenMaterials.add(mapMaterial) }
        }
        this.container = container
        this.manifest = manifest
        this.collision = collision
        this.addLighting()
        this.createDebugOverlay(collision, manifest)

        const spawn = manifest.spawnPoints[0]
        context.services.get(INPUT).angles.set(spawn.yaw, 0)
        await context.services.get(PHYSICS).createWorld(collision, {
            x: spawn.position[0], y: spawn.position[1], z: spawn.position[2],
        })
    }

    update(_frame: FrameUpdate): void {
        if (this.context?.services.get(INPUT).consumeCollisionDebugToggle()) this.setDebugVisible(!this.debugVisible)
    }

    private addLighting(): void {
        if (!this.context) return
        const scene = this.context.services.get(SCENE)
        scene.clearColor.set(0.055, 0.075, 0.11, 1)
        const ambient = new HemisphericLight('arena-ambient', new Vector3(0, 1, 0), scene)
        ambient.intensity = 0.8
        ambient.groundColor = new Color3(0.15, 0.18, 0.23)
        const sun = new DirectionalLight('arena-sun', new Vector3(-0.4, -1, 0.3), scene)
        sun.position.set(15, 30, -10)
        sun.intensity = 1.1
    }

    private createDebugOverlay(collision: CollisionMeshData, manifest: ClientMapManifest): void {
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
        for (const spawn of manifest.spawnPoints) {
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

    dispose(): void {
        for (const mesh of this.debugMeshes) mesh.dispose()
        this.debugMeshes = []
        this.container?.dispose()
        this.container = undefined
        this.context?.services.remove(ARENA)
        this.context = undefined
    }
}
