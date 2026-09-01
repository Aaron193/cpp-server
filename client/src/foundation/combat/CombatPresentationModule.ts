import { Color3 } from '@babylonjs/core/Maths/math.color.js'
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js'
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder.js'
import type { Mesh } from '@babylonjs/core/Meshes/mesh.js'
import { PointLight } from '@babylonjs/core/Lights/pointLight.js'
import { ImpactMaterial, Weapon, type Vec3 } from '../../protocol/generated'
import type { ClientModule, ClientModuleContext, FrameUpdate } from '../lifecycle'
import { AIMING, AUDIO, CAMERA, CAMERA_RIG, COMBAT_PRESENTATION, ENTITY_VIEWS, HUD, NETWORKING, PHYSICS, SCENE, SIMULATION_AIM } from '../services'
import { BoundedEffectFamily, DecalBudget, type EffectSlot } from './BoundedEffects'
import { sampleTracerMotion, tracerTravelDurationMs, TRACER_FADE_MS } from './TracerMotion'
import { ViewmodelController } from './ViewmodelController'

interface TimedMesh extends EffectSlot { readonly mesh: Mesh; expiresAt: number; actionId: number }
interface TimedLight extends EffectSlot { readonly light: PointLight; expiresAt: number }
interface ScheduledImpact { readonly position: Vec3; readonly player: boolean; readonly dueAt: number }
interface TracerSlot extends TimedMesh {
    readonly head: Mesh
    readonly start: Vector3
    readonly direction: Vector3
    distance: number
    travelMs: number
    weapon: Weapon
    shotId: number | null
    pelletIndex: number
}

function material(name: string, color: Color3, context: ClientModuleContext): StandardMaterial {
    const value = new StandardMaterial(name, context.services.get(SCENE))
    value.diffuseColor = color
    value.specularColor.set(.1, .1, .1)
    return value
}

/** Action-correlated, bounded presentation. It never changes authoritative ammo/health. */
export class CombatPresentationModule implements ClientModule {
    readonly name = 'combat-presentation'
    private context?: ClientModuleContext
    private viewmodel?: ViewmodelController
    private muzzlePool?: BoundedEffectFamily<TimedMesh>
    private impactPool?: BoundedEffectFamily<TimedMesh>
    private tracerPool?: BoundedEffectFamily<TracerSlot>
    private lightPool?: BoundedEffectFamily<TimedLight>
    private readonly decals = new DecalBudget(6, 96)
    private readonly shotTracers = new Map<string, TracerSlot>()
    private readonly scheduledImpacts: ScheduledImpact[] = []
    private eventCursor = 0
    private worldImpactMaterial?: StandardMaterial
    private playerImpactMaterial?: StandardMaterial
    private tracerMaterial?: StandardMaterial
    private readonly fromScratch = new Vector3()
    private readonly toScratch = new Vector3()
    private readonly targetScratch = new Vector3()

    initialize(context: ClientModuleContext): void {
        this.context = context
        context.services.provide(COMBAT_PRESENTATION, this)
        this.viewmodel = new ViewmodelController(context.services.get(CAMERA), context.services.get(SCENE))
        const scene = context.services.get(SCENE)
        const flash = material('effects/muzzle', new Color3(1, .68, .12), context)
        flash.emissiveColor = flash.diffuseColor
        this.worldImpactMaterial = material('effects/impact-world', new Color3(1, .34, .08), context)
        this.worldImpactMaterial.emissiveColor = this.worldImpactMaterial.diffuseColor
        this.playerImpactMaterial = material('effects/impact-player', new Color3(1, .03, .04), context)
        this.playerImpactMaterial.emissiveColor = this.playerImpactMaterial.diffuseColor
        this.tracerMaterial = material('effects/tracer', new Color3(1, .82, .24), context)
        this.tracerMaterial.diffuseColor.set(.08, .035, .002)
        this.tracerMaterial.emissiveColor.set(1, .48, .06)
        this.tracerMaterial.disableLighting = true

        const timed = (mesh: Mesh): TimedMesh => ({ mesh, expiresAt: 0, actionId: 0, startedAtMs: 0, priority: 0 })
        this.muzzlePool = new BoundedEffectFamily(12, (index) => {
            const mesh = CreateSphere(`muzzle/${index}`, { diameter: .12, segments: 4 }, scene)
            mesh.material = flash
            mesh.isPickable = false
            mesh.setEnabled(false)
            return timed(mesh)
        }, (slot) => slot.mesh.setEnabled(false))
        this.impactPool = new BoundedEffectFamily(40, (index) => {
            const mesh = CreateSphere(`impact/${index}`, { diameter: .085, segments: 4 }, scene)
            mesh.material = this.worldImpactMaterial!
            mesh.isPickable = false
            mesh.setEnabled(false)
            return timed(mesh)
        }, (slot) => slot.mesh.setEnabled(false))
        this.tracerPool = new BoundedEffectFamily<TracerSlot>(28, (index) => {
            const mesh = CreateBox(`tracer/${index}`, { width: .018, height: .018, depth: 1 }, scene)
            const head = CreateSphere(`tracer/${index}/head`, { diameter: .055, segments: 5 }, scene)
            mesh.material = this.tracerMaterial!
            head.material = this.tracerMaterial!
            mesh.isPickable = head.isPickable = false
            mesh.renderingGroupId = head.renderingGroupId = 2
            mesh.setEnabled(false)
            head.setEnabled(false)
            return {
                mesh, head, start: Vector3.Zero(), direction: Vector3.Forward(), distance: 0,
                travelMs: 0, weapon: Weapon.None, shotId: null, pelletIndex: 0, expiresAt: 0, actionId: 0, startedAtMs: 0, priority: 0,
            }
        }, (slot) => this.resetTracer(slot))
        this.lightPool = new BoundedEffectFamily(3, (index) => {
            const light = new PointLight(`effects/transient-light/${index}`, Vector3.Zero(), scene)
            light.diffuse = new Color3(1, .55, .15)
            light.range = 4
            light.intensity = 0
            return { light, expiresAt: 0, startedAtMs: 0, priority: 0 }
        }, (slot) => { slot.light.intensity = 0 })
    }

    update(frame: FrameUpdate): void {
        if (!this.context || !this.viewmodel) return
        const now = performance.now()
        const networking = this.context.services.get(NETWORKING)
        const local = networking.combat.localPlayer
        const physics = this.context.services.get(PHYSICS)
        if (this.eventCursor > networking.combat.lastEventId) {
            this.eventCursor = 0
            this.shotTracers.clear()
            this.scheduledImpacts.length = 0
        }
        const aiming = this.context.services.get(AIMING).snapshot
        this.viewmodel.update(local.weapon, local.dead, local.reloading, Math.hypot(physics.velocity.x, physics.velocity.z), physics.grounded, now, frame.deltaSeconds, physics.movementState, aiming.aimProgress)
        networking.combat.forEachEventAfter(this.eventCursor, (event) => {
            this.eventCursor = event.id
            switch (event.kind) {
                case 'local-fire': {
                    this.viewmodel?.fire(now)
                    this.context?.services.get(CAMERA_RIG).addRecoil(event.weapon === Weapon.Shotgun ? .012 : .006, (event.actionId & 1 ? 1 : -1) * .0015)
                    const muzzle = this.viewmodel?.muzzlePosition() ?? this.context?.services.get(CAMERA).globalPosition
                    const direction = this.context?.services.get(SIMULATION_AIM).direction()
                    if (!muzzle || !direction) break
                    const range = event.weapon === Weapon.Shotgun ? 20 : 80
                    const end = { x: muzzle.x + direction.x * range, y: muzzle.y + direction.y * range, z: muzzle.z + direction.z * range }
                    this.flash(muzzle, now, event.actionId)
                    this.tracer(muzzle, end, now, event.actionId, event.weapon)
                    this.context?.services.get(AUDIO).playWeapon(event.weapon)
                    break
                }
                case 'local-reload':
                    this.viewmodel?.setState('reload', now)
                    this.context?.services.get(AUDIO).playUi('reload')
                    break
                case 'action-result':
                    if (!event.value.accepted) {
                        this.repairAction(event.value.actionId)
                        this.viewmodel?.rejectAction()
                        this.context?.services.get(AUDIO).playUi('reject')
                    }
                    break
                case 'action-timeout':
                    this.repairAction(event.actionId)
                    this.viewmodel?.rejectAction()
                    break
                case 'predicted-contact':
                    this.impact(event.position, false, now, 2)
                    break
                case 'shot': {
                    const remote = event.value.shooterId !== local.playerId
                    const visualMuzzle = remote
                        ? this.context?.services.get(ENTITY_VIEWS).getSocket(event.value.shooterId, 'muzzle')?.getAbsolutePosition()
                        : this.viewmodel?.muzzlePosition() ?? this.context?.services.get(CAMERA).globalPosition
                    const origin = visualMuzzle ?? event.value.origin
                    event.value.pelletEndPositions.forEach((endPosition, pelletIndex) => {
                        let tracer = pelletIndex === 0 && event.correlated ? this.findTracerForAction(event.value.actionId) : undefined
                        if (tracer) this.correctTracerPath(tracer, endPosition, now, false)
                        else tracer = this.tracer(origin, endPosition, now, event.value.actionId, event.value.weapon)
                        if (tracer) this.bindShot(event.value.shotId, pelletIndex, tracer)
                    })
                    if (remote) {
                        this.flash(origin, now, event.value.actionId)
                        this.context?.services.get(ENTITY_VIEWS).triggerOneShot(event.value.shooterId, 'recoil', now)
                        this.context?.services.get(AUDIO).playWeapon(event.value.weapon, origin)
                    }
                    break
                }
                case 'impact': {
                    const tracer = this.shotTracers.get(this.shotTracerKey(event.value.shotId, event.value.pelletIndex))
                    if (tracer) this.correctTracerPath(tracer, event.value.position, now, true)
                    this.scheduleImpact(
                        event.value.position,
                        event.value.material === ImpactMaterial.Player,
                        tracer ? tracer.startedAtMs + tracer.travelMs : now,
                        now,
                    )
                    break
                }
                case 'damage':
                    if (event.localHit) this.context?.services.get(AUDIO).playUi('hit')
                    else if (event.localDamage) {
                        this.context?.services.get(AUDIO).playUi('damage')
                        this.context?.services.get(CAMERA_RIG).addDamage(0, Math.min(2, event.value.amount / 25))
                        this.context?.services.optional(HUD)?.showDirectionalDamage(0, event.value.amount)
                    } else this.context?.services.get(ENTITY_VIEWS).triggerOneShot(event.value.targetId, 'hit', now)
                    break
                case 'death':
                    this.context?.services.get(ENTITY_VIEWS).triggerOneShot(event.value.victimId, 'death', now)
                    break
                case 'respawn':
                    this.context?.services.get(ENTITY_VIEWS).triggerOneShot(event.value.playerId, 'respawn', now)
                    break
                case 'round':
                    this.context?.services.get(AUDIO).playUi('round')
                    break
                case 'chat':
                    break
            }
        })
        this.updateTracers(now)
        this.presentScheduledImpacts(now)
        this.releaseExpired(now)
    }

    private repairAction(actionId: number): void {
        this.muzzlePool?.releaseWhere((slot) => slot.actionId === actionId)
        this.tracerPool?.releaseWhere((slot) => slot.actionId === actionId)
    }

    private releaseExpired(now: number): void {
        for (const pool of [this.muzzlePool, this.impactPool]) pool?.releaseWhere((slot) => slot.expiresAt <= now)
        this.tracerPool?.releaseWhere((slot) => slot.expiresAt <= now)
        this.lightPool?.releaseWhere((slot) => slot.expiresAt <= now)
    }

    private flash(position: Vec3, now: number, actionId: number): void {
        const slot = this.muzzlePool?.acquire(now, 3)
        if (!slot) return
        slot.actionId = actionId
        slot.mesh.position.copyFromFloats(position.x, position.y, position.z)
        slot.mesh.setEnabled(true)
        slot.expiresAt = now + 45
        const light = this.lightPool?.acquire(now, 3)
        if (light) {
            light.light.position.copyFromFloats(position.x, position.y, position.z)
            light.light.intensity = 2.1
            light.expiresAt = now + 35
        }
    }

    private impact(position: Vec3, player: boolean, now: number, priority: number): void {
        const slot = this.impactPool?.acquire(now, priority)
        if (!slot) return
        slot.mesh.material = player ? this.playerImpactMaterial! : this.worldImpactMaterial!
        slot.mesh.position.copyFromFloats(position.x, position.y, position.z)
        slot.mesh.setEnabled(true)
        slot.expiresAt = now + 210
        this.decals.add(position, player ? 'player' : 'world', now)
    }

    private scheduleImpact(position: Vec3, player: boolean, dueAt: number, now: number): void {
        if (dueAt <= now) {
            this.presentImpact(position, player, now)
            return
        }
        // Keep delayed presentation bounded under sustained shotgun fire.
        if (this.scheduledImpacts.length >= 64) this.scheduledImpacts.shift()
        this.scheduledImpacts.push({ position: { ...position }, player, dueAt })
    }

    private presentScheduledImpacts(now: number): void {
        for (let index = this.scheduledImpacts.length - 1; index >= 0; index--) {
            const pending = this.scheduledImpacts[index]!
            if (pending.dueAt > now) continue
            this.scheduledImpacts.splice(index, 1)
            this.presentImpact(pending.position, pending.player, now)
        }
    }

    private presentImpact(position: Vec3, player: boolean, now: number): void {
        this.impact(position, player, now, 3)
        this.context?.services.get(AUDIO).playImpact(position)
    }

    private tracer(from: Vec3, to: Vec3, now: number, actionId: number, weapon: Weapon): TracerSlot | undefined {
        const slot = this.tracerPool?.acquire(now, 2)
        if (!slot) return undefined
        slot.actionId = actionId
        slot.weapon = weapon
        slot.shotId = null
        slot.pelletIndex = 0
        slot.start.copyFromFloats(from.x, from.y, from.z)
        this.configureTracerPath(slot, to, now, weapon)
        slot.mesh.setEnabled(true)
        slot.head.setEnabled(true)
        this.positionTracer(slot, now)
        return slot
    }

    private configureTracerPath(slot: TracerSlot, to: Vec3, now: number, weapon: Weapon): void {
        this.toScratch.copyFromFloats(to.x, to.y, to.z)
        this.toScratch.subtractToRef(slot.start, slot.direction)
        slot.distance = slot.direction.length()
        if (slot.distance > 0.0001) slot.direction.scaleInPlace(1 / slot.distance)
        else slot.direction.copyFromFloats(0, 0, -1)
        slot.travelMs = tracerTravelDurationMs(slot.distance, weapon)
        slot.expiresAt = now + slot.travelMs + TRACER_FADE_MS
    }

    private correctTracerPath(slot: TracerSlot, to: Vec3, now: number, onlyIfShorter: boolean): void {
        this.toScratch.copyFromFloats(to.x, to.y, to.z)
        const correctedDistance = Vector3.Distance(slot.start, this.toScratch)
        if (onlyIfShorter && correctedDistance >= slot.distance) return
        const elapsed = Math.max(0, now - slot.startedAtMs)
        this.toScratch.subtractToRef(slot.start, slot.direction)
        slot.distance = correctedDistance
        if (slot.distance > 0.0001) slot.direction.scaleInPlace(1 / slot.distance)
        slot.travelMs = Math.max(elapsed, tracerTravelDurationMs(slot.distance, slot.weapon))
        slot.expiresAt = slot.startedAtMs + slot.travelMs + TRACER_FADE_MS
    }

    private updateTracers(now: number): void {
        this.tracerPool?.forEachActive((slot) => this.positionTracer(slot, now))
    }

    private positionTracer(slot: TracerSlot, now: number): void {
        const sample = sampleTracerMotion(slot.distance, now - slot.startedAtMs, slot.travelMs)
        slot.start.addToRef(slot.direction.scaleToRef(sample.centerDistance, this.fromScratch), slot.mesh.position)
        slot.start.addToRef(slot.direction.scaleToRef(sample.headDistance, this.targetScratch), slot.head.position)
        slot.direction.scaleToRef(slot.distance, this.targetScratch)
        slot.start.addToRef(this.targetScratch, this.toScratch)
        slot.mesh.scaling.z = Math.max(.001, sample.streakLength)
        slot.mesh.lookAt(this.toScratch)
        slot.mesh.visibility = sample.opacity
        slot.head.visibility = sample.opacity
    }

    private findTracerForAction(actionId: number): TracerSlot | undefined {
        let found: TracerSlot | undefined
        this.tracerPool?.forEachActive((slot) => { if (!found && slot.actionId === actionId) found = slot })
        return found
    }

    private shotTracerKey(shotId: number, pelletIndex: number): string { return `${shotId}:${pelletIndex}` }

    private bindShot(shotId: number, pelletIndex: number, slot: TracerSlot): void {
        if (slot.shotId !== null) this.shotTracers.delete(this.shotTracerKey(slot.shotId, slot.pelletIndex))
        slot.shotId = shotId
        slot.pelletIndex = pelletIndex
        this.shotTracers.set(this.shotTracerKey(shotId, pelletIndex), slot)
    }

    private resetTracer(slot: TracerSlot): void {
        if (slot.shotId !== null) {
            const key = this.shotTracerKey(slot.shotId, slot.pelletIndex)
            if (this.shotTracers.get(key) === slot) this.shotTracers.delete(key)
        }
        slot.shotId = null
        slot.pelletIndex = 0
        slot.mesh.visibility = slot.head.visibility = 0
        slot.mesh.setEnabled(false)
        slot.head.setEnabled(false)
    }

    dispose(): void {
        this.viewmodel?.dispose()
        for (const pool of [this.muzzlePool, this.impactPool]) pool?.forEach((slot) => slot.mesh.dispose(false, true))
        this.tracerPool?.forEach((slot) => { slot.mesh.dispose(false, false); slot.head.dispose(false, false) })
        this.lightPool?.forEach((slot) => slot.light.dispose())
        this.tracerMaterial?.dispose()
        this.decals.clear()
        this.shotTracers.clear()
        this.scheduledImpacts.length = 0
        this.context?.services.remove(COMBAT_PRESENTATION)
        this.context = undefined
    }

    get effectPoolUtilization(): { readonly active: number; readonly capacity: number; readonly replacements: number } {
        const values = [this.muzzlePool?.telemetry, this.impactPool?.telemetry, this.tracerPool?.telemetry, this.lightPool?.telemetry].filter((value) => value !== undefined)
        return {
            active: values.reduce((sum, value) => sum + value.active, 0),
            capacity: values.reduce((sum, value) => sum + value.capacity, 0),
            replacements: values.reduce((sum, value) => sum + value.replacements, 0),
        }
    }
}
