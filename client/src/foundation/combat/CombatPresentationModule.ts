import { Color3 } from '@babylonjs/core/Maths/math.color.js'
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js'
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder.js'
import type { Mesh } from '@babylonjs/core/Meshes/mesh.js'
import { PointLight } from '@babylonjs/core/Lights/pointLight.js'
import { ActionKind, ImpactMaterial, type Vec3 } from '../../protocol/generated'
import type { ClientModule, ClientModuleContext, FrameUpdate } from '../lifecycle'
import { AUDIO, CAMERA, CAMERA_RIG, COMBAT_PRESENTATION, ENTITY_VIEWS, HUD, NETWORKING, PHYSICS, SCENE, SIMULATION_AIM } from '../services'
import { BoundedEffectFamily, DecalBudget, type EffectSlot } from './BoundedEffects'
import { ViewmodelController } from './ViewmodelController'

interface TimedMesh extends EffectSlot { readonly mesh: Mesh; expiresAt: number; actionId: number }
interface TimedLight extends EffectSlot { readonly light: PointLight; expiresAt: number }
function material(name: string, color: Color3, context: ClientModuleContext): StandardMaterial { const value = new StandardMaterial(name, context.services.get(SCENE)); value.diffuseColor = color; value.specularColor.set(.1, .1, .1); return value }

/** Action-correlated, bounded presentation. It never changes authoritative ammo/health. */
export class CombatPresentationModule implements ClientModule {
    readonly name = 'combat-presentation'
    private context?: ClientModuleContext
    private viewmodel?: ViewmodelController
    private muzzlePool?: BoundedEffectFamily<TimedMesh>
    private impactPool?: BoundedEffectFamily<TimedMesh>
    private tracerPool?: BoundedEffectFamily<TimedMesh>
    private lightPool?: BoundedEffectFamily<TimedLight>
    private readonly decals = new DecalBudget(6, 96)
    private readonly shotOrigins = new Map<number, Vec3>()
    private eventCursor = 0
    private worldImpactMaterial?: StandardMaterial
    private playerImpactMaterial?: StandardMaterial
    private readonly a = new Vector3(); private readonly b = new Vector3(); private readonly midpoint = new Vector3()
    initialize(context: ClientModuleContext): void {
        this.context = context; context.services.provide(COMBAT_PRESENTATION, this)
        this.viewmodel = new ViewmodelController(context.services.get(CAMERA), context.services.get(SCENE))
        const scene = context.services.get(SCENE)
        const flash = material('effects/muzzle', new Color3(1, .68, .12), context); flash.emissiveColor = flash.diffuseColor
        this.worldImpactMaterial = material('effects/impact-world', new Color3(1, .34, .08), context); this.worldImpactMaterial.emissiveColor = this.worldImpactMaterial.diffuseColor
        this.playerImpactMaterial = material('effects/impact-player', new Color3(1, .03, .04), context); this.playerImpactMaterial.emissiveColor = this.playerImpactMaterial.diffuseColor
        const tracer = material('effects/tracer', new Color3(1, .84, .3), context); tracer.emissiveColor = tracer.diffuseColor
        const timed = (mesh: Mesh): TimedMesh => ({ mesh, expiresAt: 0, actionId: 0, startedAtMs: 0, priority: 0 })
        this.muzzlePool = new BoundedEffectFamily(12, (i) => { const mesh = CreateSphere(`muzzle/${i}`, { diameter: .12, segments: 4 }, scene); mesh.material = flash; mesh.setEnabled(false); return timed(mesh) }, (slot) => slot.mesh.setEnabled(false))
        this.impactPool = new BoundedEffectFamily(40, (i) => { const mesh = CreateSphere(`impact/${i}`, { diameter: .085, segments: 4 }, scene); mesh.material = this.worldImpactMaterial!; mesh.setEnabled(false); return timed(mesh) }, (slot) => slot.mesh.setEnabled(false))
        this.tracerPool = new BoundedEffectFamily(28, (i) => { const mesh = CreateBox(`tracer/${i}`, { width: .012, height: .012, depth: 1 }, scene); mesh.material = tracer; mesh.setEnabled(false); return timed(mesh) }, (slot) => slot.mesh.setEnabled(false))
        this.lightPool = new BoundedEffectFamily(3, (i) => { const light = new PointLight(`effects/transient-light/${i}`, Vector3.Zero(), scene); light.diffuse = new Color3(1, .55, .15); light.range = 4; light.intensity = 0; return { light, expiresAt: 0, startedAtMs: 0, priority: 0 } }, (slot) => { slot.light.intensity = 0 })
    }
    update(frame: FrameUpdate): void {
        if (!this.context || !this.viewmodel) return
        const now = performance.now(), networking = this.context.services.get(NETWORKING), local = networking.combat.localPlayer, physics = this.context.services.get(PHYSICS)
        if (this.eventCursor > networking.combat.lastEventId) { this.eventCursor = 0; this.shotOrigins.clear() }
        this.viewmodel.update(local.weapon, local.dead, local.reloading, Math.hypot(physics.velocity.x, physics.velocity.z), physics.grounded, now, frame.deltaSeconds)
        networking.combat.forEachEventAfter(this.eventCursor, (event) => {
            this.eventCursor = event.id
            switch (event.kind) {
                case 'local-fire': {
                    this.viewmodel?.fire(now); this.context?.services.get(CAMERA_RIG).addRecoil(event.weapon === 2 ? .065 : .035, (event.actionId & 1 ? 1 : -1) * .004)
                    const muzzle = this.viewmodel?.muzzlePosition() ?? this.context?.services.get(CAMERA).globalPosition
                    if (!muzzle) break
                    const direction = this.context?.services.get(SIMULATION_AIM).direction(); if (!direction) break
                    const end = { x: muzzle.x + direction.x * 24, y: muzzle.y + direction.y * 24, z: muzzle.z + direction.z * 24 }
                    this.flash(muzzle, now, event.actionId); this.tracer(muzzle, end, now, event.actionId); this.context?.services.get(AUDIO).playWeapon(event.weapon); break
                }
                case 'local-reload': this.viewmodel?.setState('reload', now); this.context?.services.get(AUDIO).playUi('reload'); break
                case 'action-result': if (!event.value.accepted) { this.repairAction(event.value.actionId); this.viewmodel?.rejectAction(); this.context?.services.get(AUDIO).playUi('reject') } break
                case 'action-timeout': this.repairAction(event.actionId); this.viewmodel?.rejectAction(); break
                case 'predicted-contact': this.impact(event.position, false, now, 2); break
                case 'shot': {
                    const origin = event.value.shooterId === local.playerId ? this.viewmodel?.muzzlePosition() ?? this.context?.services.get(CAMERA).globalPosition : this.context?.services.get(ENTITY_VIEWS).getSocket(event.value.shooterId, 'muzzle')?.getAbsolutePosition()
                    if (origin) { this.shotOrigins.set(event.value.shotId, { x: origin.x, y: origin.y, z: origin.z }); if (event.value.shooterId !== local.playerId) { this.flash(origin, now, event.value.actionId); this.context?.services.get(ENTITY_VIEWS).triggerOneShot(event.value.shooterId, 'recoil', now); this.context?.services.get(AUDIO).playWeapon(event.value.weapon, origin) } }
                    if (this.shotOrigins.size > 64) this.shotOrigins.delete(this.shotOrigins.keys().next().value!); break
                }
                case 'impact': { this.impact(event.value.position, event.value.material === ImpactMaterial.Player, now, 3); this.context?.services.get(AUDIO).playImpact(event.value.position); const origin = this.shotOrigins.get(event.value.shotId); if (origin) { this.tracer(origin, event.value.position, now, 0); this.shotOrigins.delete(event.value.shotId) } break }
                case 'damage': if (event.localHit) this.context?.services.get(AUDIO).playUi('hit'); else if (event.localDamage) { this.context?.services.get(AUDIO).playUi('damage'); this.context?.services.get(CAMERA_RIG).addDamage(0, Math.min(2, event.value.amount / 25)); this.context?.services.optional(HUD)?.showDirectionalDamage(0, event.value.amount) } else this.context?.services.get(ENTITY_VIEWS).triggerOneShot(event.value.targetId, 'hit', now); break
                case 'death': this.context?.services.get(ENTITY_VIEWS).triggerOneShot(event.value.victimId, 'death', now); break
                case 'respawn': this.context?.services.get(ENTITY_VIEWS).triggerOneShot(event.value.playerId, 'respawn', now); break
                case 'round': this.context?.services.get(AUDIO).playUi('round'); break
                case 'chat': break
            }
        })
        this.releaseExpired(now)
    }
    private repairAction(actionId: number): void { this.muzzlePool?.releaseWhere((slot) => slot.actionId === actionId); this.tracerPool?.releaseWhere((slot) => slot.actionId === actionId) }
    private releaseExpired(now: number): void { for (const pool of [this.muzzlePool, this.impactPool, this.tracerPool]) pool?.releaseWhere((slot) => slot.expiresAt <= now); this.lightPool?.releaseWhere((slot) => slot.expiresAt <= now) }
    private flash(position: Vec3, now: number, actionId: number): void { const slot = this.muzzlePool?.acquire(now, 3); if (!slot) return; slot.actionId = actionId; slot.mesh.position.copyFromFloats(position.x, position.y, position.z); slot.mesh.setEnabled(true); slot.expiresAt = now + 45; const light = this.lightPool?.acquire(now, 3); if (light) { light.light.position.copyFromFloats(position.x, position.y, position.z); light.light.intensity = 2.1; light.expiresAt = now + 35 } }
    private impact(position: Vec3, player: boolean, now: number, priority: number): void { const slot = this.impactPool?.acquire(now, priority); if (!slot) return; slot.mesh.material = player ? this.playerImpactMaterial! : this.worldImpactMaterial!; slot.mesh.position.copyFromFloats(position.x, position.y, position.z); slot.mesh.setEnabled(true); slot.expiresAt = now + 210; this.decals.add(position, player ? 'player' : 'world', now) }
    private tracer(from: Vec3, to: Vec3, now: number, actionId: number): void { const slot = this.tracerPool?.acquire(now, 2); if (!slot) return; slot.actionId = actionId; this.a.copyFromFloats(from.x, from.y, from.z); this.b.copyFromFloats(to.x, to.y, to.z); this.a.addToRef(this.b, this.midpoint).scaleInPlace(.5); slot.mesh.position.copyFrom(this.midpoint); slot.mesh.scaling.z = Vector3.Distance(this.a, this.b); slot.mesh.lookAt(this.b); slot.mesh.setEnabled(true); slot.expiresAt = now + 85 }
    dispose(): void { this.viewmodel?.dispose(); for (const pool of [this.muzzlePool, this.impactPool, this.tracerPool]) pool?.forEach((slot) => slot.mesh.dispose(false, true)); this.lightPool?.forEach((slot) => slot.light.dispose()); this.decals.clear(); this.shotOrigins.clear(); this.context?.services.remove(COMBAT_PRESENTATION); this.context = undefined }
    get effectPoolUtilization(): { readonly active: number; readonly capacity: number; readonly replacements: number } { const values = [this.muzzlePool?.telemetry, this.impactPool?.telemetry, this.tracerPool?.telemetry, this.lightPool?.telemetry].filter((v) => v !== undefined); return { active: values.reduce((sum, v) => sum + v.active, 0), capacity: values.reduce((sum, v) => sum + v.capacity, 0), replacements: values.reduce((sum, v) => sum + v.replacements, 0) } }
}
