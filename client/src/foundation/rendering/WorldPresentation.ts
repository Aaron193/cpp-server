import { Color3 } from '@babylonjs/core/Maths/math.color.js'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js'
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder.js'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js'
import type { Scene } from '@babylonjs/core/scene.js'
import type { ClientMapGameplay } from '../assets/MapManifest'
import type { RenderTierProfile } from './RenderQualityModule'

export interface WorldPresentationSnapshot {
    readonly containerInstances: number
    readonly staticMeshes: number
    readonly decorativeSources: number
    readonly decorativeInstances: number
    readonly lodLevels: number
    readonly decorationBudget: number
}

export function decorationMarkers(gameplay: ClientMapGameplay, budget: number): ClientMapGameplay['markers'] {
    return gameplay.markers.filter((marker) => marker.type === 'landmark').slice(0, Math.max(0, budget))
}

/** Small original marker-beacon family; it is decorative and never enters collision truth. */
export class WorldPresentation {
    private readonly owned: AbstractMesh[] = []
    private material?: PBRMaterial
    private readonly state: WorldPresentationSnapshot

    constructor(
        scene: Scene,
        gameplay: ClientMapGameplay,
        profile: RenderTierProfile,
        mapMeshes: readonly AbstractMesh[]
    ) {
        const containerInstances = mapMeshes.filter((mesh) => mesh.getClassName() === 'InstancedMesh').length
        const positions = decorationMarkers(gameplay, profile.decorationBudget)
        let decorativeSources = 0, decorativeInstances = 0, lodLevels = 0
        if (positions.length > 0) {
            this.material = new PBRMaterial('map-decoration/beacon-material', scene)
            this.material.albedoColor = new Color3(0.72, 0.42, 0.12)
            this.material.metallic = 0.72
            this.material.roughness = 0.34
            this.material.freeze()
            const source = CreateCylinder('map-decoration/beacon-source', { height: 1.2, diameterTop: 0.12, diameterBottom: 0.32, tessellation: 12 }, scene)
            source.material = this.material
            source.position.set(positions[0].position[0], positions[0].position[1] + 0.6, positions[0].position[2])
            source.isPickable = false
            source.alwaysSelectAsActiveMesh = false
            this.owned.push(source)
            decorativeSources = 1

            if (profile.tier !== 'software') {
                const lod = CreateCylinder('map-decoration/beacon-lod', { height: 1.2, diameterTop: 0.12, diameterBottom: 0.32, tessellation: 5 }, scene)
                lod.material = this.material
                lod.isPickable = false
                lod.setEnabled(false)
                source.addLODLevel(profile.tier === 'low' ? 22 : 36, lod)
                this.owned.push(lod)
                lodLevels = 1
            }
            for (const marker of positions.slice(1)) {
                const instance = source.createInstance(`map-decoration/beacon/${marker.id}`)
                instance.position.set(marker.position[0], marker.position[1] + 0.6, marker.position[2])
                instance.isPickable = false
                instance.alwaysSelectAsActiveMesh = false
                this.owned.push(instance)
                decorativeInstances++
            }
        }
        this.state = {
            containerInstances, staticMeshes: mapMeshes.length, decorativeSources,
            decorativeInstances, lodLevels, decorationBudget: profile.decorationBudget,
        }
    }

    get snapshot(): WorldPresentationSnapshot { return this.state }

    dispose(): void {
        for (const mesh of this.owned) mesh.dispose()
        this.owned.length = 0
        this.material?.dispose(); this.material = undefined
    }
}
