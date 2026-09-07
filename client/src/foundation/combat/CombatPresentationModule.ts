import { Vector3 } from '@babylonjs/core/Maths/math.vector.js'
import { Ray } from '@babylonjs/core/Culling/ray.js'
import type { Mesh } from '@babylonjs/core/Meshes/mesh.js'
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js'
import {
    ImpactMaterial,
    Weapon,
    type Vec3,
    type Impact,
} from '../../protocol/generated'
import type {
    ClientModule,
    ClientModuleContext,
    FrameUpdate,
} from '../lifecycle'
import {
    AIMING,
    AUDIO,
    CAMERA,
    CAMERA_RIG,
    COMBAT_PRESENTATION,
    ENTITY_VIEWS,
    HUD,
    NETWORKING,
    PHYSICS,
    SCENE,
    SIMULATION_AIM,
} from '../services'
import { BoundedEffectFamily, type EffectSlot } from './BoundedEffects'
import {
    sampleTracerMotion,
    tracerTravelDurationMs,
    shotAgeMs,
    tracerRibbonWidth,
    tracerInitialAgeMs,
    impactTravelDurationMs,
} from './TracerMotion'
import {
    createRibbon,
    effectBillboard,
    effectMaterial,
    positionRibbon,
    type Ribbon,
} from './CombatEffectVisuals'
import { WorldImpactEffects, isWorldSurface } from './WorldImpactEffects'
import { ViewmodelController } from './ViewmodelController'

interface TracerSlot extends EffectSlot {
    ribbon: Ribbon
    tip: Mesh
    start: Vector3
    direction: Vector3
    muzzleOffset: Vector3
    previousHead: Vector3
    distance: number
    travelMs: number
    gravity: number
    weapon: Weapon
    actionId: number
    local: boolean
    shotId: number | null
    pelletIndex: number
    terminal: Impact | null
    impactPresented: boolean
}
interface PendingImpact {
    value: Impact
    dueAt: number
}

/** Cosmetic flights follow authoritative launch vectors; only Damage confirms a hit. */
export class CombatPresentationModule implements ClientModule {
    readonly name = 'combat-presentation'
    private context?: ClientModuleContext
    private viewmodel?: ViewmodelController
    private effects?: WorldImpactEffects
    private tracerMaterial?: StandardMaterial
    private tipMaterial?: StandardMaterial
    private tracerPool?: BoundedEffectFamily<TracerSlot>
    private readonly shotTracers = new Map<string, TracerSlot>()
    private readonly localActions = new Map<number, number>()
    private readonly scheduledImpacts: PendingImpact[] = []
    private eventCursor = 0
    private nextClearanceCheck = 0
    private wallTuck = 0
    private readonly head = new Vector3()
    private readonly tail = new Vector3()
    private readonly scratch = new Vector3()

    initialize(context: ClientModuleContext): void {
        this.context = context
        context.services.provide(COMBAT_PRESENTATION, this)
        const scene = context.services.get(SCENE)
        this.viewmodel = new ViewmodelController(
            context.services.get(CAMERA),
            scene
        )
        this.effects = new WorldImpactEffects(scene)
        this.tracerMaterial = effectMaterial(scene, 'tracer')
        this.tipMaterial = effectMaterial(scene, 'spark')
        this.tracerPool = new BoundedEffectFamily<TracerSlot>(
            96,
            (index) => ({
                ribbon: createRibbon(
                    `tracer/${index}`,
                    scene,
                    this.tracerMaterial!
                ),
                tip: effectBillboard(
                    `tracer/${index}/tip`,
                    scene,
                    this.tipMaterial!
                ),
                start: new Vector3(),
                direction: new Vector3(),
                muzzleOffset: new Vector3(),
                previousHead: new Vector3(),
                distance: 0,
                travelMs: 0,
                gravity: 0,
                weapon: Weapon.None,
                actionId: 0,
                local: false,
                shotId: null,
                pelletIndex: 0,
                terminal: null,
                impactPresented: false,
                startedAtMs: 0,
                priority: 0,
            }),
            (slot) => {
                if (slot.shotId !== null) {
                    const key = `${slot.shotId}:${slot.pelletIndex}`
                    if (this.shotTracers.get(key) === slot)
                        this.shotTracers.delete(key)
                }
                // A pool replacement must not swallow a confirmed, scheduled impact.
                if (slot.terminal && !slot.impactPresented)
                    this.queueImpact(
                        slot.terminal,
                        slot.startedAtMs + slot.travelMs
                    )
                slot.shotId = null
                slot.terminal = null
                slot.ribbon.mesh.setEnabled(false)
                slot.tip.setEnabled(false)
            }
        )
    }

    async start(): Promise<void> {
        // Compile while joining, so the first 58 ms muzzle flash isn't consumed by shader compilation.
        let sample: TracerSlot | undefined
        this.tracerPool?.forEach((slot) => {
            sample ??= slot
        })
        if (!sample) return
        await Promise.all([
            this.effects!.prepare(),
            this.tracerMaterial!.forceCompilationAsync(sample.ribbon.mesh),
            this.tipMaterial!.forceCompilationAsync(sample.tip),
        ])
    }

    update(frame: FrameUpdate): void {
        if (!this.context || !this.viewmodel) return
        const now = performance.now()
        const networking = this.context.services.get(NETWORKING)
        const local = networking.combat.localPlayer
        const physics = this.context.services.get(PHYSICS)
        if (this.eventCursor > networking.combat.lastEventId) {
            this.clear()
            this.eventCursor = 0
        }
        if (now >= this.nextClearanceCheck) {
            this.nextClearanceCheck = now + 80
            const direction = this.context.services
                    .get(SIMULATION_AIM)
                    .direction(),
                eye = this.context.services.get(CAMERA).position
            const fraction = physics.probeStatic(eye, {
                x: direction.x * 1.4,
                y: direction.y * 1.4,
                z: direction.z * 1.4,
            })
            this.wallTuck =
                fraction === undefined
                    ? 0
                    : Math.max(0, Math.min(1, (1 - fraction) * 1.4))
        }
        const aiming = this.context.services.get(AIMING).snapshot
        this.viewmodel.update(
            local.weapon,
            local.dead,
            local.reloading,
            Math.hypot(physics.velocity.x, physics.velocity.z),
            physics.grounded,
            now,
            frame.deltaSeconds,
            physics.movementState,
            aiming.aimProgress,
            networking.weaponDefinitions[
                local.weapon === Weapon.Shotgun ? Weapon.Shotgun : Weapon.Rifle
            ].reloadTime,
            this.wallTuck
        )
        networking.combat.forEachEventAfter(this.eventCursor, (event) => {
            this.eventCursor = event.id
            switch (event.kind) {
                case 'local-fire': {
                    this.viewmodel!.fire(now)
                    this.context!.services.get(CAMERA_RIG).addRecoil(
                        event.weapon === Weapon.Shotgun ? 0.012 : 0.006,
                        (event.actionId & 1 ? 1 : -1) * 0.0015
                    )
                    const muzzle =
                        this.viewmodel!.muzzlePosition() ??
                        this.context!.services.get(CAMERA).globalPosition
                    const origin =
                        this.context!.services.get(CAMERA).globalPosition
                    const direction =
                        this.context!.services.get(SIMULATION_AIM).direction()
                    const definition = this.definition(event.weapon)
                    const end = {
                        x: origin.x + direction.x * definition.range,
                        y: origin.y + direction.y * definition.range,
                        z: origin.z + direction.z * definition.range,
                    }
                    this.effects!.flash(
                        muzzle,
                        direction,
                        now,
                        event.actionId,
                        true,
                        event.weapon === Weapon.Shotgun
                    )
                    this.tracer(
                        origin,
                        end,
                        muzzle,
                        now,
                        event.actionId,
                        event.weapon,
                        true
                    )
                    this.localActions.set(event.actionId, now)
                    this.context!.services.get(AUDIO).playWeapon(event.weapon)
                    break
                }
                case 'local-reload':
                    this.viewmodel!.setState('reload', now)
                    this.context!.services.get(AUDIO).playUi('reload')
                    break
                case 'action-result':
                    if (!event.value.accepted)
                        this.repairAction(event.value.actionId)
                    break
                case 'action-timeout':
                    this.repairAction(event.actionId)
                    break
                case 'shot': {
                    const value = event.value,
                        remote = value.shooterId !== local.playerId
                    const muzzle = remote
                        ? (this.context!.services.get(ENTITY_VIEWS)
                              .getSocket(value.shooterId, 'muzzle')
                              ?.getAbsolutePosition() ?? value.origin)
                        : (this.viewmodel!.muzzlePosition() ?? value.origin)
                    const age = Math.max(
                        0,
                        shotAgeMs(
                            value.serverTick,
                            networking.serverTickNow,
                            networking.tickRate
                        ) - 50
                    )
                    value.pelletEndPositions.forEach((end, pellet) => {
                        let slot: TracerSlot | undefined
                        if (!remote && pellet === 0)
                            this.tracerPool!.forEachActive((candidate) => {
                                if (
                                    candidate.local &&
                                    candidate.actionId === value.actionId &&
                                    candidate.shotId === null
                                )
                                    slot = candidate
                            })
                        if (slot) {
                            // Preserve the elapsed flight; confirmation never restarts a predicted shot.
                            slot.start.copyFromFloats(
                                value.origin.x,
                                value.origin.y,
                                value.origin.z
                            )
                            this.configure(slot, end)
                        } else {
                            // An already-finished predicted rifle shot must not replay on late confirmation.
                            if (
                                !remote &&
                                pellet === 0 &&
                                this.localActions.has(value.actionId)
                            )
                                return
                            slot = this.tracer(
                                value.origin,
                                end,
                                muzzle,
                                now,
                                value.actionId,
                                value.weapon,
                                !remote
                            )
                            slot.startedAtMs -= tracerInitialAgeMs(
                                age,
                                slot.travelMs
                            )
                        }
                        slot.shotId = value.shotId
                        slot.pelletIndex = pellet
                        this.shotTracers.set(`${value.shotId}:${pellet}`, slot)
                    })
                    if (remote) {
                        const end = value.pelletEndPositions[0]
                        if (end)
                            this.effects!.flash(
                                muzzle,
                                {
                                    x: end.x - value.origin.x,
                                    y: end.y - value.origin.y,
                                    z: end.z - value.origin.z,
                                },
                                now,
                                value.actionId,
                                false,
                                value.weapon === Weapon.Shotgun
                            )
                        this.context!.services.get(ENTITY_VIEWS).triggerOneShot(
                            value.shooterId,
                            'recoil',
                            now
                        )
                        this.context!.services.get(AUDIO).playWeapon(
                            value.weapon,
                            muzzle
                        )
                    }
                    break
                }
                case 'impact': {
                    const slot = this.shotTracers.get(
                        `${event.value.shotId}:${event.value.pelletIndex}`
                    )
                    if (slot) this.stopAtImpact(slot, event.value, now)
                    else this.queueImpact(event.value, now)
                    break
                }
                case 'damage': {
                    if (event.localHit)
                        this.context!.services.get(AUDIO).playUi('hit')
                    if (event.localDamage) {
                        this.context!.services.get(AUDIO).playUi('damage')
                        const source =
                            event.value.sourceId === null
                                ? undefined
                                : this.context!.services.get(ENTITY_VIEWS).get(
                                      event.value.sourceId
                                  )
                        const eye =
                            this.context!.services.get(CAMERA).globalPosition
                        const yaw =
                            this.context!.services.get(SIMULATION_AIM).angles
                                .yaw
                        const relativeYaw = source
                            ? Math.atan2(
                                  source.position.x - eye.x,
                                  eye.z - source.position.z
                              ) - yaw
                            : 0
                        this.context!.services.get(CAMERA_RIG).addDamage(
                            relativeYaw,
                            Math.min(2, event.value.amount / 25)
                        )
                        if (source)
                            this.context!.services.optional(
                                HUD
                            )?.showDirectionalDamage(
                                relativeYaw,
                                event.value.amount
                            )
                    } else
                        this.context!.services.get(ENTITY_VIEWS).triggerOneShot(
                            event.value.targetId,
                            'hit',
                            now
                        )
                    break
                }
                case 'death':
                    this.context!.services.get(ENTITY_VIEWS).triggerOneShot(
                        event.value.victimId,
                        'death',
                        now
                    )
                    break
                case 'respawn':
                    this.context!.services.get(ENTITY_VIEWS).triggerOneShot(
                        event.value.playerId,
                        'respawn',
                        now
                    )
                    if (event.value.playerId === local.playerId) this.clear()
                    break
                case 'round':
                    this.clear()
                    this.context!.services.get(AUDIO).playUi('round')
                    break
                case 'predicted-contact':
                case 'chat':
                    break
            }
        })
        this.tracerPool!.forEachActive((slot) =>
            this.positionTracer(slot, now, frame.deltaSeconds * 1000)
        )
        for (let i = this.scheduledImpacts.length - 1; i >= 0; i--) {
            const pending = this.scheduledImpacts[i]!
            if (pending.dueAt <= now) {
                this.presentImpact(pending.value, now)
                this.scheduledImpacts.splice(i, 1)
            }
        }
        this.effects!.update(
            now,
            this.context.services.get(CAMERA).globalPosition,
            this.viewmodel.muzzlePosition()
        )
        for (const [action, at] of this.localActions)
            if (now - at > 5000) this.localActions.delete(action)
    }
    private definition(weapon: Weapon) {
        return this.context!.services.get(NETWORKING).weaponDefinitions[
            weapon === Weapon.Shotgun ? Weapon.Shotgun : Weapon.Rifle
        ]
    }
    private repairAction(actionId: number): void {
        this.effects?.reject(actionId)
        this.tracerPool?.releaseWhere(
            (slot) => slot.local && slot.actionId === actionId
        )
        this.viewmodel?.rejectAction()
    }
    private tracer(
        origin: Vec3,
        end: Vec3,
        muzzle: Vec3,
        now: number,
        actionId: number,
        weapon: Weapon,
        local: boolean
    ): TracerSlot {
        const slot = this.tracerPool!.acquire(now, local ? 3 : 2)
        slot.start.copyFromFloats(origin.x, origin.y, origin.z)
        slot.muzzleOffset.copyFromFloats(
            muzzle.x - origin.x,
            muzzle.y - origin.y,
            muzzle.z - origin.z
        )
        // Remote interpolated sockets can be displaced; don't warp an entire ballistic path to them.
        if (slot.muzzleOffset.length() > 2) slot.muzzleOffset.setAll(0)
        slot.previousHead.copyFrom(slot.start)
        slot.weapon = weapon
        slot.local = local
        slot.actionId = actionId
        slot.shotId = null
        slot.pelletIndex = 0
        slot.terminal = null
        slot.impactPresented = false
        this.configure(slot, end)
        slot.ribbon.mesh.setEnabled(true)
        slot.tip.setEnabled(true)
        return slot
    }
    private configure(slot: TracerSlot, end: Vec3): void {
        slot.direction.copyFromFloats(
            end.x - slot.start.x,
            end.y - slot.start.y,
            end.z - slot.start.z
        )
        slot.distance = slot.direction.length()
        slot.direction.normalize()
        const definition = this.definition(slot.weapon)
        slot.travelMs =
            definition.muzzleVelocity > 0
                ? (slot.distance / definition.muzzleVelocity) * 1000
                : tracerTravelDurationMs(slot.distance, slot.weapon)
        slot.gravity =
            definition.muzzleVelocity > 0 ? definition.projectileGravity : 0
    }
    private stopAtImpact(slot: TracerSlot, impact: Impact, now: number): void {
        if (slot.terminal) return
        const speed = slot.distance / Math.max(0.001, slot.travelMs)
        // Project onto the original launch vector. Do not aim at the gravity-displaced endpoint
        // and then apply gravity a second time, or change speed as a correction arrives.
        const dx = impact.position.x - slot.start.x,
            dy = impact.position.y - slot.start.y,
            dz = impact.position.z - slot.start.z
        const duration = impactTravelDurationMs(
            dx * slot.direction.x +
                dy * slot.direction.y +
                dz * slot.direction.z,
            speed * 1000,
            slot.gravity,
            slot.direction.y
        )
        slot.travelMs = Math.max(0.001, Math.min(slot.travelMs, duration))
        slot.distance = speed * slot.travelMs
        slot.terminal = impact
        if (now >= slot.startedAtMs + slot.travelMs) {
            this.presentImpact(impact, now)
            slot.impactPresented = true
        }
    }
    private samplePosition(
        slot: TracerSlot,
        distance: number,
        out: Vector3
    ): void {
        const t =
            ((distance / Math.max(0.001, slot.distance)) * slot.travelMs) / 1000
        out.copyFrom(slot.direction)
            .scaleInPlace(distance)
            .addInPlace(slot.start)
        out.y -= slot.gravity * t * t * 0.5
        // Short muzzle-to-ballistic transition, exhausted well before an incoming round passes the viewer.
        const blend =
            Math.pow(Math.max(0, 1 - distance / 8), 2) *
            (slot.terminal
                ? 1 - Math.min(1, distance / Math.max(0.001, slot.distance))
                : 1)
        out.x += slot.muzzleOffset.x * blend
        out.y += slot.muzzleOffset.y * blend
        out.z += slot.muzzleOffset.z * blend
        if (slot.terminal) {
            const endpoint = slot.terminal.position
            const endT = slot.travelMs / 1000
            const amount = Math.pow(
                Math.min(1, distance / Math.max(0.001, slot.distance)),
                4
            )
            out.x +=
                (endpoint.x - slot.start.x - slot.direction.x * slot.distance) *
                amount
            out.y +=
                (endpoint.y -
                    slot.start.y -
                    slot.direction.y * slot.distance +
                    slot.gravity * endT * endT * 0.5) *
                amount
            out.z +=
                (endpoint.z - slot.start.z - slot.direction.z * slot.distance) *
                amount
        }
    }
    private positionTracer(
        slot: TracerSlot,
        now: number,
        frameMs: number
    ): void {
        let sample = sampleTracerMotion(
            slot.distance,
            now - slot.startedAtMs,
            slot.travelMs,
            frameMs
        )
        this.samplePosition(slot, sample.headDistance, this.head)
        if (
            !slot.terminal &&
            this.context!.services.get(NETWORKING).status === 'offline'
        ) {
            this.head.subtractToRef(slot.previousHead, this.scratch)
            const length = this.scratch.length()
            if (length > 0.001) {
                const pick = this.context!.services.get(SCENE).pickWithRay(
                    new Ray(
                        slot.previousHead,
                        this.scratch.scaleInPlace(1 / length),
                        length
                    ),
                    isWorldSurface
                )
                if (pick?.hit && pick.pickedPoint) {
                    const normal = pick.getNormal(true) ?? this.scratch.negate()
                    this.stopAtImpact(
                        slot,
                        {
                            serverTick: 0,
                            shotId: 0,
                            pelletIndex: 0,
                            position: {
                                x: pick.pickedPoint.x,
                                y: pick.pickedPoint.y,
                                z: pick.pickedPoint.z,
                            },
                            normal: { x: normal.x, y: normal.y, z: normal.z },
                            material: ImpactMaterial.World,
                        },
                        now
                    )
                    sample = sampleTracerMotion(
                        slot.distance,
                        now - slot.startedAtMs,
                        slot.travelMs,
                        frameMs
                    )
                    this.samplePosition(slot, sample.headDistance, this.head)
                }
            }
        }
        slot.previousHead.copyFrom(this.head)
        if (
            slot.terminal &&
            !slot.impactPresented &&
            now >= slot.startedAtMs + slot.travelMs
        ) {
            this.presentImpact(slot.terminal, now)
            slot.impactPresented = true
        }
        if (sample.complete) {
            this.tracerPool!.release(slot)
            return
        }
        this.samplePosition(slot, sample.tailDistance, this.tail)
        const eye = this.context!.services.get(CAMERA).globalPosition
        const camera = this.context!.services.get(CAMERA)
        const distance = Vector3.Distance(eye, this.head)
        const width = tracerRibbonWidth(
            distance,
            camera.fov,
            this.context!.services.get(SCENE).getEngine().getRenderHeight()
        )
        slot.tip.position.copyFrom(this.head)
        slot.tip.scaling.setAll(width * 1.4)
        slot.tip.visibility = sample.headOpacity * 0.75
        positionRibbon(slot.ribbon, this.tail, this.head, eye, width)
        slot.ribbon.mesh.visibility =
            sample.opacity * (slot.weapon === Weapon.Shotgun ? 0.6 : 0.95)
    }
    private presentImpact(value: Impact, now: number): void {
        this.effects!.impact(
            value.position,
            value.normal,
            value.material === ImpactMaterial.Player,
            now
        )
        this.context!.services.get(AUDIO).playImpact(value.position)
    }
    private queueImpact(value: Impact, dueAt: number): void {
        if (this.scheduledImpacts.length >= 96) this.scheduledImpacts.shift()
        this.scheduledImpacts.push({ value, dueAt })
    }
    private clear(): void {
        this.tracerPool?.forEachActive((slot) => {
            slot.impactPresented = true
        })
        this.tracerPool?.releaseWhere(() => true)
        this.shotTracers.clear()
        this.localActions.clear()
        this.scheduledImpacts.length = 0
        this.effects?.clear()
    }
    dispose(): void {
        this.clear()
        this.viewmodel?.dispose()
        this.effects?.dispose()
        this.tracerPool?.forEach((slot) => {
            slot.ribbon.mesh.dispose()
            slot.tip.dispose()
        })
        this.tipMaterial?.dispose(false, true)
        this.tracerMaterial?.dispose(false, true)
        this.context?.services.remove(COMBAT_PRESENTATION)
        this.context = undefined
    }
    get effectPoolUtilization() {
        const a = this.tracerPool?.telemetry,
            b = this.effects?.telemetry
        return {
            active: (a?.active ?? 0) + (b?.active ?? 0),
            capacity: (a?.capacity ?? 0) + (b?.capacity ?? 0),
            replacements: (a?.replacements ?? 0) + (b?.replacements ?? 0),
        }
    }
}
