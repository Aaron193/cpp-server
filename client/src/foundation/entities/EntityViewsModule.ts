import { Color3 } from '@babylonjs/core/Maths/math.color.js'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js'
import { CreateCapsule } from '@babylonjs/core/Meshes/Builders/capsuleBuilder.js'
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder.js'
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder.js'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js'
import type { Scene } from '@babylonjs/core/scene.js'
import type { EntityRecord, Vec3 } from '../../protocol/generated'
import type { ClientModule, ClientModuleContext, FrameUpdate } from '../lifecycle'
import { ENTITY_VIEWS, SCENE } from '../services'
import { ACTOR_SOCKET_LOCAL, evaluateActorPose, type ActorOneShot } from './ActorPresentation'

export type GameplayEntityId = number
export function serverYawToBabylonVisualYaw(bodyYaw: number): number { return -bodyYaw }
// Both the protocol and Babylon's right-handed -Z-forward actor rig use positive pitch for looking up.
export function serverPitchToBabylonVisualPitch(aimPitch: number): number { return aimPitch }

interface ActorRig {
    readonly root: TransformNode
    readonly calibration: TransformNode
    readonly torso: TransformNode
    readonly head: TransformNode
    readonly leftArm: TransformNode
    readonly rightArm: TransformNode
    readonly leftLeg: TransformNode
    readonly rightLeg: TransformNode
    readonly weapon: TransformNode
    readonly sockets: Readonly<Record<keyof typeof ACTOR_SOCKET_LOCAL, TransformNode>>
    record: EntityRecord
    readonly oneShots: Partial<Record<ActorOneShot, number>>
    wallTuckWeight: number
}

function limb(name: string, parent: TransformNode, diameter: number, height: number, material: StandardMaterial): TransformNode {
    const joint = new TransformNode(`${name}/joint`, parent.getScene()); joint.parent = parent
    const mesh = CreateCapsule(`${name}/mesh`, { radius: diameter / 2, height, tessellation: 8 }, parent.getScene())
    mesh.parent = joint; mesh.position.y = -height / 2; mesh.material = material; mesh.isPickable = false
    return joint
}
function socket(name: string, parent: TransformNode, position: Vec3): TransformNode { const value = new TransformNode(name, parent.getScene()); value.parent = parent; value.position.copyFromFloats(position.x, position.y, position.z); return value }

/** Original code-authored articulated operator. All animation lives under calibration. */
function createActor(entity: EntityRecord, material: StandardMaterial, armor: StandardMaterial, weaponMaterial: StandardMaterial, scene: Scene): ActorRig {
    const prefix = `remote-actor/${entity.entityId}`
    const root = new TransformNode(`${prefix}/root`, scene)
    const calibration = new TransformNode(`${prefix}/calibration`, scene); calibration.parent = root
    const pelvis = CreateBox(`${prefix}/pelvis`, { width: .52, height: .28, depth: .3 }, scene); pelvis.parent = calibration; pelvis.position.y = .86; pelvis.material = armor; pelvis.isPickable = false
    const torso = new TransformNode(`${prefix}/torso-joint`, scene); torso.parent = calibration; torso.position.y = 1.08
    const chest = CreateCapsule(`${prefix}/chest`, { radius: .32, height: .72, tessellation: 10 }, scene); chest.parent = torso; chest.position.y = .24; chest.scaling.z = .68; chest.material = material; chest.isPickable = false
    const head = new TransformNode(`${prefix}/head-joint`, scene); head.parent = torso; head.position.y = .58
    const helmet = CreateSphere(`${prefix}/helmet`, { diameter: .34, segments: 10 }, scene); helmet.parent = head; helmet.material = armor; helmet.isPickable = false
    const visor = CreateBox(`${prefix}/visor`, { width: .24, height: .09, depth: .04 }, scene); visor.parent = head; visor.position.set(0, .015, -.17); visor.material = weaponMaterial; visor.isPickable = false
    const leftArm = limb(`${prefix}/left-arm`, torso, .17, .68, material); leftArm.position.set(-.34, .46, 0); leftArm.rotation.z = -.18
    const rightArm = limb(`${prefix}/right-arm`, torso, .17, .68, material); rightArm.position.set(.34, .46, 0); rightArm.rotation.z = .18
    const leftLeg = limb(`${prefix}/left-leg`, calibration, .2, .82, armor); leftLeg.position.set(-.17, .82, 0)
    const rightLeg = limb(`${prefix}/right-leg`, calibration, .2, .82, armor); rightLeg.position.set(.17, .82, 0)
    const sockets = {
        head: socket(`${prefix}/socket/head`, calibration, ACTOR_SOCKET_LOCAL.head), name: socket(`${prefix}/socket/name`, calibration, ACTOR_SOCKET_LOCAL.name),
        leftHand: socket(`${prefix}/socket/left-hand`, calibration, ACTOR_SOCKET_LOCAL.leftHand), rightHand: socket(`${prefix}/socket/right-hand`, calibration, ACTOR_SOCKET_LOCAL.rightHand),
        weapon: socket(`${prefix}/socket/weapon`, calibration, ACTOR_SOCKET_LOCAL.weapon), muzzle: socket(`${prefix}/socket/muzzle`, calibration, ACTOR_SOCKET_LOCAL.muzzle),
    }
    const weapon = new TransformNode(`${prefix}/world-weapon`, scene); weapon.parent = sockets.weapon
    const receiver = CreateBox(`${prefix}/weapon-receiver`, { width: .12, height: .13, depth: .55 }, scene); receiver.parent = weapon; receiver.material = weaponMaterial; receiver.isPickable = false
    const barrel = CreateCylinder(`${prefix}/weapon-barrel`, { diameter: .045, height: .54, tessellation: 8 }, scene); barrel.parent = weapon; barrel.rotation.x = Math.PI / 2; barrel.position.z = -.48; barrel.material = weaponMaterial; barrel.isPickable = false
    return { root, calibration, torso, head, leftArm, rightArm, leftLeg, rightLeg, weapon, sockets, record: { ...entity }, oneShots: {}, wallTuckWeight: 0 }
}

/** Versioned entity keys arrive from replication; recycled slots never mutate old rigs. */
export class EntityViewsModule implements ClientModule {
    readonly name = 'entity-views'
    private readonly actors = new Map<GameplayEntityId, ActorRig>()
    private readonly attached = new Map<GameplayEntityId, TransformNode>()
    private context?: ClientModuleContext
    private suitMaterial?: StandardMaterial
    private armorMaterial?: StandardMaterial
    private weaponMaterial?: StandardMaterial

    initialize(context: ClientModuleContext): void {
        this.context = context; context.services.provide(ENTITY_VIEWS, this)
        const scene = context.services.get(SCENE)
        this.suitMaterial = new StandardMaterial('actor/suit/shared', scene); this.suitMaterial.diffuseColor = new Color3(.12, .39, .62); this.suitMaterial.freeze()
        this.armorMaterial = new StandardMaterial('actor/armor/shared', scene); this.armorMaterial.diffuseColor = new Color3(.19, .58, .72); this.armorMaterial.specularColor = new Color3(.4, .45, .5); this.armorMaterial.freeze()
        this.weaponMaterial = new StandardMaterial('actor/weapon/shared', scene); this.weaponMaterial.diffuseColor = new Color3(.065, .075, .09); this.weaponMaterial.specularColor = new Color3(.5, .5, .5); this.weaponMaterial.freeze()
    }
    update(frame: FrameUpdate): void {
        const now = frame.elapsedSeconds * 1000
        for (const actor of this.actors.values()) {
            const pose = evaluateActorPose(actor.record, frame.elapsedSeconds, actor.oneShots, actor.wallTuckWeight, now)
            const visualAimPitch = serverPitchToBabylonVisualPitch(pose.aimPitch)
            const swing = Math.sin(pose.gaitPhase) * .58 * pose.gaitWeight
            actor.leftLeg.rotation.x = swing; actor.rightLeg.rotation.x = -swing
            actor.leftArm.rotation.x = -swing * .48 - .72 - pose.recoilWeight * .12 - pose.mantleWeight * 1.25 - pose.adsWeight * .16
            actor.rightArm.rotation.x = swing * .48 - .78 - pose.recoilWeight * .18 - pose.mantleWeight * .95 - pose.adsWeight * .2
            actor.leftArm.rotation.z = -.18 - pose.reloadWeight * .55
            actor.rightArm.rotation.z = .18 + pose.reloadWeight * .32
            actor.torso.rotation.x = visualAimPitch * .42 - pose.wallTuckWeight * .25 + pose.slideWeight * .32 + pose.proneWeight * 1.15
            actor.torso.rotation.z = pose.hitWeight * .13 + pose.deadWeight * 1.25 + pose.dashWeight * .12
            actor.head.rotation.x = visualAimPitch * .55
            actor.calibration.position.y = -.34 * pose.crouchWeight - .67 * pose.proneWeight - .12 * pose.slideWeight + .03 * Math.sin(pose.gaitPhase * 2) * pose.gaitWeight
            actor.calibration.scaling.y = 1 - .12 * pose.crouchWeight - .2 * pose.proneWeight
            actor.calibration.scaling.x = actor.calibration.scaling.z = .88 + .12 * pose.respawnWeight
            actor.weapon.rotation.x = visualAimPitch - pose.wallTuckWeight * .55
            actor.weapon.position.z = pose.wallTuckWeight * .32 + pose.recoilWeight * .08 + pose.mantleWeight * .28 - pose.adsWeight * .06
        }
    }
    attach(entityId: GameplayEntityId, view: TransformNode): void { if (this.get(entityId)) throw new Error(`Entity view already attached: ${entityId}`); this.attached.set(entityId, view) }
    detach(entityId: GameplayEntityId): TransformNode | undefined { const actor = this.actors.get(entityId); if (actor) this.actors.delete(entityId); const custom = this.attached.get(entityId); this.attached.delete(entityId); return actor?.root ?? custom }
    get(entityId: GameplayEntityId): TransformNode | undefined { return this.actors.get(entityId)?.root ?? this.attached.get(entityId) }
    getSocket(entityId: GameplayEntityId, name: keyof typeof ACTOR_SOCKET_LOCAL): TransformNode | undefined { return this.actors.get(entityId)?.sockets[name] }
    debugActorStates(): readonly { readonly entityId: number; readonly stance: number; readonly movementMode: number; readonly calibrationY: number }[] {
        return [...this.actors.entries()].map(([entityId, actor]) => ({
            entityId, stance: actor.record.stance, movementMode: actor.record.movementMode,
            calibrationY: actor.calibration.position.y,
        }))
    }
    forEachPresentationPose(visitor: (entityId: number, position: Vec3, yaw: number) => void): void { for (const [entityId, actor] of this.actors) visitor(entityId, actor.root.position, actor.root.rotation.y) }
    triggerOneShot(entityId: GameplayEntityId, kind: ActorOneShot, nowMs = performance.now()): void { const actor = this.actors.get(entityId); if (actor) actor.oneShots[kind] = nowMs }
    setWallTuck(entityId: GameplayEntityId, weight: number): void { const actor = this.actors.get(entityId); if (actor) actor.wallTuckWeight = Math.max(0, Math.min(1, weight)) }
    applyRemotePlayer(entity: EntityRecord): void {
        if (!this.context || !this.suitMaterial || !this.armorMaterial || !this.weaponMaterial) return
        let actor = this.actors.get(entity.entityId)
        if (!actor) { actor = createActor(entity, this.suitMaterial, this.armorMaterial, this.weaponMaterial, this.context.services.get(SCENE)); this.actors.set(entity.entityId, actor); actor.oneShots.respawn = performance.now() }
        actor.record = { ...entity }
        actor.root.position.copyFromFloats(entity.position.x, entity.position.y, entity.position.z)
        actor.root.rotation.y = serverYawToBabylonVisualYaw(entity.bodyYaw)
        actor.root.setEnabled(true)
        actor.weapon.setEnabled(entity.equippedWeapon !== 0 && (entity.stateFlags & 1) === 0)
        actor.weapon.scaling.z = entity.equippedWeapon === 2 ? 1.18 : 1
    }
    removeAndDispose(entityId: GameplayEntityId): void { this.detach(entityId)?.dispose(false, true) }
    clearAndDispose(): void { for (const actor of this.actors.values()) actor.root.dispose(false, true); for (const view of this.attached.values()) view.dispose(false, true); this.actors.clear(); this.attached.clear() }
    dispose(): void { this.clearAndDispose(); this.suitMaterial?.dispose(); this.armorMaterial?.dispose(); this.weaponMaterial?.dispose(); this.context?.services.remove(ENTITY_VIEWS); this.context = undefined }
}
