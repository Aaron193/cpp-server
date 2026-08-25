import type { TransformNode } from '@babylonjs/core/Meshes/transformNode.js'
import type { Mesh } from '@babylonjs/core/Meshes/mesh.js'
import { Color3 } from '@babylonjs/core/Maths/math.color.js'
import { CreateCapsule } from '@babylonjs/core/Meshes/Builders/capsuleBuilder.js'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js'
import type { EntityRecord } from '../../protocol/generated'
import type { ClientModule, ClientModuleContext } from '../lifecycle'
import { ENTITY_VIEWS, SCENE } from '../services'

export type GameplayEntityId = number

/**
 * Server yaw is measured from -Z with positive angles turning toward +X.
 * A right-handed Babylon node's local -Z forward turns toward -X for a
 * positive Y rotation, so presentation must invert the angle.
 */
export function serverYawToBabylonVisualYaw(bodyYaw: number): number {
    return -bodyYaw
}

/** Babylon nodes are presentation-only views keyed by authoritative entity ids. */
export class EntityViewsModule implements ClientModule {
    readonly name = 'entity-views'
    private readonly views = new Map<GameplayEntityId, TransformNode>()
    private readonly weapons = new Map<GameplayEntityId, TransformNode>()
    private readonly playerLods = new Map<GameplayEntityId, Mesh>()
    private context?: ClientModuleContext
    private playerTemplate?: Mesh
    private playerLodTemplate?: Mesh
    private weaponTemplate?: Mesh
    private sharedMaterial?: StandardMaterial
    private weaponMaterial?: StandardMaterial

    initialize(context: ClientModuleContext): void {
        this.context = context
        context.services.provide(ENTITY_VIEWS, this)
        const scene = context.services.get(SCENE)
        this.sharedMaterial = new StandardMaterial('remote-player-material/shared', scene)
        this.sharedMaterial.diffuseColor = new Color3(0.18, 0.55, 0.95); this.sharedMaterial.freeze()
        this.weaponMaterial = new StandardMaterial('remote-weapon-material/shared', scene)
        this.weaponMaterial.diffuseColor = new Color3(0.12, 0.14, 0.17); this.weaponMaterial.specularColor = new Color3(.4, .4, .4); this.weaponMaterial.freeze()
        this.playerTemplate = CreateCapsule('remote-player/template', { radius: 0.42, height: 1.8, tessellation: 12 }, scene)
        this.playerLodTemplate = CreateCapsule('remote-player/lod-template', { radius: 0.42, height: 1.8, tessellation: 6 }, scene)
        this.weaponTemplate = CreateBox('remote-weapon/template', { width: .12, height: .12, depth: .7 }, scene)
        for (const mesh of [this.playerTemplate, this.playerLodTemplate]) { mesh.material = this.sharedMaterial; mesh.isPickable = false; mesh.alwaysSelectAsActiveMesh = false; mesh.setEnabled(false) }
        this.weaponTemplate.material = this.weaponMaterial; this.weaponTemplate.isPickable = false; this.weaponTemplate.alwaysSelectAsActiveMesh = false; this.weaponTemplate.setEnabled(false)
    }

    attach(entityId: GameplayEntityId, view: TransformNode): void {
        if (this.views.has(entityId)) {
            throw new Error(`Entity view already attached: ${entityId}`)
        }
        this.views.set(entityId, view)
    }

    detach(entityId: GameplayEntityId): TransformNode | undefined {
        const view = this.views.get(entityId)
        this.views.delete(entityId)
        return view
    }

    get(entityId: GameplayEntityId): TransformNode | undefined {
        return this.views.get(entityId)
    }

    applyRemotePlayer(entity: EntityRecord): void {
        if (!this.context) return
        let view = this.views.get(entity.entityId)
        if (!view) {
            const mesh = this.playerTemplate?.clone(`remote-player/${entity.entityId}`)
            const lod = this.playerLodTemplate?.clone(`remote-player/lod/${entity.entityId}`)
            const weapon = this.weaponTemplate?.clone(`remote-weapon/${entity.entityId}`)
            if (!mesh || !lod || !weapon) { mesh?.dispose(); lod?.dispose(); weapon?.dispose(); return }
            mesh.setEnabled(true); lod.setEnabled(true); weapon.setEnabled(true)
            mesh.addLODLevel(30, lod)
            weapon.parent = mesh; weapon.position.set(.34, .25, -.46)
            this.playerLods.set(entity.entityId, lod)
            this.weapons.set(entity.entityId, weapon)
            this.attach(entity.entityId, mesh)
            view = mesh
        }
        view.position.set(entity.position.x, entity.position.y + 0.9, entity.position.z)
        view.rotation.y = serverYawToBabylonVisualYaw(entity.bodyYaw)
        view.setEnabled((entity.stateFlags & 1) === 0)
        const weapon = this.weapons.get(entity.entityId)
        if (weapon) {
            weapon.setEnabled(entity.equippedWeapon !== 0)
            weapon.scaling.z = entity.equippedWeapon === 2 ? 1.25 : 1
            weapon.rotation.x = -entity.aimPitch
        }
    }

    removeAndDispose(entityId: GameplayEntityId): void {
        const view = this.detach(entityId)
        this.weapons.delete(entityId)
        this.playerLods.get(entityId)?.dispose()
        this.playerLods.delete(entityId)
        view?.dispose()
    }
    clearAndDispose(): void {
        for (const view of this.views.values()) {
            view.dispose()
        }
        this.views.clear()
        this.weapons.clear()
        for (const lod of this.playerLods.values()) lod.dispose()
        this.playerLods.clear()
    }

    dispose(): void {
        this.clearAndDispose()
        this.playerTemplate?.dispose(); this.playerLodTemplate?.dispose(); this.weaponTemplate?.dispose(); this.sharedMaterial?.dispose(); this.weaponMaterial?.dispose()
        this.playerTemplate = undefined; this.playerLodTemplate = undefined; this.weaponTemplate = undefined; this.sharedMaterial = undefined; this.weaponMaterial = undefined
        this.context?.services.remove(ENTITY_VIEWS)
        this.context = undefined
    }
}
