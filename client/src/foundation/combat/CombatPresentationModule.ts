import { Color3 } from '@babylonjs/core/Maths/math.color.js'
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js'
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder.js'
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder.js'
import type { Mesh } from '@babylonjs/core/Meshes/mesh.js'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js'
import '@babylonjs/core/Culling/ray.js'
import { ImpactMaterial, Weapon, type Vec3 } from '../../protocol/generated'
import type { ClientModule, ClientModuleContext, FrameUpdate } from '../lifecycle'
import { AUDIO, CAMERA, COMBAT_PRESENTATION, ENTITY_VIEWS, NETWORKING, SCENE } from '../services'
import { ObjectPool } from './ObjectPool'

interface TimedMesh { readonly mesh: Mesh; expiresAt: number }

function material(name: string, color: Color3, context: ClientModuleContext): StandardMaterial {
    const value = new StandardMaterial(name, context.services.get(SCENE)); value.diffuseColor = color; value.specularColor.set(.1, .1, .1); return value
}

function makeWeapon(name: string, weapon: Weapon, context: ClientModuleContext): TransformNode {
    const scene = context.services.get(SCENE), root = new TransformNode(name, scene)
    const dark = material(`${name}/dark`, weapon === Weapon.Shotgun ? new Color3(.22, .16, .1) : new Color3(.12, .16, .2), context)
    const body = CreateBox(`${name}/body`, { width: weapon === Weapon.Shotgun ? .16 : .13, height: .16, depth: weapon === Weapon.Shotgun ? .72 : .62 }, scene)
    body.parent = root; body.material = dark
    const barrel = CreateCylinder(`${name}/barrel`, { diameter: weapon === Weapon.Shotgun ? .065 : .04, height: weapon === Weapon.Shotgun ? .68 : .58, tessellation: 8 }, scene)
    barrel.parent = root; barrel.rotation.x = Math.PI / 2; barrel.position.z = -.58; barrel.material = dark
    const grip = CreateBox(`${name}/grip`, { width: .1, height: .28, depth: .12 }, scene)
    grip.parent = root; grip.position.set(0, -.18, -.12); grip.rotation.x = -.25; grip.material = dark
    for (const mesh of [body, barrel, grip]) { mesh.isPickable = false; mesh.renderingGroupId = 1 }
    return root
}

/** Procedural presentation only; authoritative state remains in NetworkingModule. */
export class CombatPresentationModule implements ClientModule {
    readonly name = 'combat-presentation'
    private context?: ClientModuleContext
    private rifle?: TransformNode
    private shotgun?: TransformNode
    private muzzlePool?: ObjectPool<TimedMesh>
    private impactPool?: ObjectPool<TimedMesh>
    private tracerPool?: ObjectPool<TimedMesh>
    private readonly shotOrigins = new Map<number, Vec3>()
    private eventCursor = 0
    private recoil = 0
    private worldImpactMaterial?: StandardMaterial
    private playerImpactMaterial?: StandardMaterial
    private readonly tracerStart = new Vector3()
    private readonly tracerEnd = new Vector3()
    private readonly tracerMidpoint = new Vector3()
    private readonly muzzlePosition = new Vector3()

    initialize(context: ClientModuleContext): void {
        this.context = context
        context.services.provide(COMBAT_PRESENTATION, this)
        const camera = context.services.get(CAMERA)
        this.rifle = makeWeapon('viewmodel/rifle', Weapon.Rifle, context)
        this.shotgun = makeWeapon('viewmodel/shotgun', Weapon.Shotgun, context)
        // A right-handed Babylon camera looks down local -Z. Positive Z places
        // camera children behind the player and makes the viewmodel invisible.
        for (const root of [this.rifle, this.shotgun]) { root.parent = camera; root.position.set(.34, -.28, -.7) }
        const scene = context.services.get(SCENE)
        const flashMaterial = material('effects/muzzle', new Color3(1, .7, .15), context); flashMaterial.emissiveColor = flashMaterial.diffuseColor
        this.worldImpactMaterial = material('effects/impact-world', new Color3(1, .35, .1), context); this.worldImpactMaterial.emissiveColor = this.worldImpactMaterial.diffuseColor
        this.playerImpactMaterial = material('effects/impact-player', new Color3(1, .05, .05), context); this.playerImpactMaterial.emissiveColor = this.playerImpactMaterial.diffuseColor
        const tracerMaterial = material('effects/tracer', new Color3(1, .85, .35), context); tracerMaterial.emissiveColor = tracerMaterial.diffuseColor
        this.muzzlePool = new ObjectPool(12, (index) => { const mesh = CreateSphere(`muzzle/${index}`, { diameter: .12, segments: 4 }, scene); mesh.material = flashMaterial; mesh.setEnabled(false); return { mesh, expiresAt: 0 } }, (value) => value.mesh.setEnabled(false))
        this.impactPool = new ObjectPool(32, (index) => { const mesh = CreateSphere(`impact/${index}`, { diameter: .09, segments: 4 }, scene); mesh.material = this.worldImpactMaterial!; mesh.setEnabled(false); return { mesh, expiresAt: 0 } }, (value) => value.mesh.setEnabled(false))
        this.tracerPool = new ObjectPool(24, (index) => { const mesh = CreateBox(`tracer/${index}`, { width: .012, height: .012, depth: 1 }, scene); mesh.material = tracerMaterial; mesh.setEnabled(false); return { mesh, expiresAt: 0 } }, (value) => value.mesh.setEnabled(false))
    }

    update(frame: FrameUpdate): void {
        if (!this.context) return
        const context = this.context, networking = context.services.get(NETWORKING), local = networking.combat.localPlayer
        if (this.eventCursor > networking.combat.lastEventId) { this.eventCursor = 0; this.shotOrigins.clear(); this.recoil = 0 }
        if (this.rifle && this.shotgun) {
            this.rifle.setEnabled(local.weapon === Weapon.Rifle && !local.dead)
            this.shotgun.setEnabled(local.weapon === Weapon.Shotgun && !local.dead)
            this.recoil *= Math.exp(-frame.deltaSeconds * 18)
            const root = local.weapon === Weapon.Shotgun ? this.shotgun : this.rifle
            root.position.z = -.7 + this.recoil * .12; root.rotation.x = this.recoil * .09
        }
        networking.combat.forEachEventAfter(this.eventCursor, (event) => {
            this.eventCursor = event.id
            switch (event.kind) {
                case 'local-fire': {
                    this.recoil = 1
                    const ray = context.services.get(CAMERA).getForwardRay(1)
                    ray.direction.scaleToRef(.8, this.muzzlePosition)
                    ray.origin.addToRef(this.muzzlePosition, this.muzzlePosition)
                    const now = performance.now()
                    ray.direction.scaleToRef(24, this.tracerEnd)
                    ray.origin.addToRef(this.tracerEnd, this.tracerEnd)
                    this.flash(this.muzzlePosition, now)
                    // Combat is hitscan, but an immediate cosmetic tracer makes
                    // every trigger pull readable even when the shot hits sky.
                    this.tracer(this.muzzlePosition, this.tracerEnd, now)
                    context.services.get(AUDIO).playWeapon(event.weapon)
                    break
                }
                case 'shot': {
                    const origin = event.value.shooterId === local.playerId ? context.services.get(CAMERA).globalPosition : context.services.get(ENTITY_VIEWS).get(event.value.shooterId)?.absolutePosition
                    if (origin) { this.shotOrigins.set(event.value.shotId, { x: origin.x, y: origin.y, z: origin.z }); if (event.value.shooterId !== local.playerId) { this.flash(origin, performance.now()); context.services.get(AUDIO).playWeapon(event.value.weapon, origin) } }
                    if (this.shotOrigins.size > 64) this.shotOrigins.delete(this.shotOrigins.keys().next().value!)
                    break
                }
                case 'impact': {
                    this.impact(event.value.position, event.value.material === ImpactMaterial.Player, performance.now()); context.services.get(AUDIO).playImpact(event.value.position)
                    const origin = this.shotOrigins.get(event.value.shotId); if (origin) { this.tracer(origin, event.value.position, performance.now()); this.shotOrigins.delete(event.value.shotId) }
                    break
                }
                case 'damage': if (event.localHit) context.services.get(AUDIO).playUi('hit'); else if (event.localDamage) context.services.get(AUDIO).playUi('damage'); break
                case 'death': context.services.get(ENTITY_VIEWS).get(event.value.victimId)?.setEnabled(false); break
                case 'respawn': context.services.get(ENTITY_VIEWS).get(event.value.playerId)?.setEnabled(true); break
                case 'round': context.services.get(AUDIO).playUi('round'); break
            }
        })
        const now = performance.now()
        this.releaseExpired(this.muzzlePool, now)
        this.releaseExpired(this.impactPool, now)
        this.releaseExpired(this.tracerPool, now)
    }

    private releaseExpired(pool: ObjectPool<TimedMesh> | undefined, now: number): void { pool?.forEachActive((value) => { if (value.expiresAt <= now) pool.release(value) }) }
    private flash(position: Vec3, now: number): void { const value = this.muzzlePool?.acquire(); if (!value) return; value.mesh.position.copyFromFloats(position.x, position.y, position.z); value.mesh.setEnabled(true); value.expiresAt = now + 45 }
    private impact(position: Vec3, player: boolean, now: number): void { const value = this.impactPool?.acquire(); if (!value) return; value.mesh.material = player ? this.playerImpactMaterial! : this.worldImpactMaterial!; value.mesh.position.copyFromFloats(position.x, position.y, position.z); value.mesh.setEnabled(true); value.expiresAt = now + 180 }
    private tracer(from: Vec3, to: Vec3, now: number): void {
        const value = this.tracerPool?.acquire(); if (!value) return
        this.tracerStart.copyFromFloats(from.x, from.y, from.z); this.tracerEnd.copyFromFloats(to.x, to.y, to.z)
        this.tracerStart.addToRef(this.tracerEnd, this.tracerMidpoint).scaleInPlace(.5)
        value.mesh.position.copyFrom(this.tracerMidpoint); value.mesh.scaling.z = Vector3.Distance(this.tracerStart, this.tracerEnd); value.mesh.lookAt(this.tracerEnd); value.mesh.setEnabled(true); value.expiresAt = now + 80
    }
    dispose(): void {
        this.rifle?.dispose(false, true); this.shotgun?.dispose(false, true)
        this.muzzlePool?.forEach((value) => value.mesh.dispose(false, true))
        this.impactPool?.forEach((value) => value.mesh.dispose(false, true))
        this.tracerPool?.forEach((value) => value.mesh.dispose(false, true))
        this.shotOrigins.clear(); this.context?.services.remove(COMBAT_PRESENTATION); this.context = undefined
    }

    get effectPoolUtilization(): { readonly active: number; readonly capacity: number } {
        return { active: (this.muzzlePool?.activeCount ?? 0) + (this.impactPool?.activeCount ?? 0) + (this.tracerPool?.activeCount ?? 0), capacity: (this.muzzlePool?.capacity ?? 0) + (this.impactPool?.capacity ?? 0) + (this.tracerPool?.capacity ?? 0) }
    }
}
