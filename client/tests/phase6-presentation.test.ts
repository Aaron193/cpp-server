import { describe, expect, it } from 'vitest'
import { ActionKind, ActionRejectReason, EntityKind, MatchPhase, Weapon, type EntityRecord } from '../src/protocol/generated'
import { ACTOR_SOCKET_LOCAL, auditActorCalibration, evaluateActorPose, selectLocomotion } from '../src/foundation/entities/ActorPresentation'
import { CameraRigController } from '../src/foundation/camera/CameraRig'
import { SimulationAim } from '../src/foundation/camera/SimulationAim'
import { BoundedEffectFamily, DecalBudget, type EffectSlot } from '../src/foundation/combat/BoundedEffects'
import { auditViewmodelCalibration } from '../src/foundation/combat/ViewmodelController'
import { CombatPresentationState } from '../src/foundation/combat/CombatState'
import { sampleTracerMotion, tracerTravelDurationMs, TRACER_FADE_MS, TRACER_LENGTH_METERS } from '../src/foundation/combat/TracerMotion'
import { selectVoiceToSteal } from '../src/foundation/audio/AudioModule'
import { MinimapPrivacyModel, projectRadar, radarAspectRatio } from '../src/foundation/hud/MinimapModel'
import { MatchFeelClock } from '../src/foundation/hud/MatchFeel'
import { deriveHudStates } from '../src/foundation/hud/HudState'
import { frameKillcamCamera, KillcamBuffer } from '../src/foundation/replay/KillcamBuffer'

const entity = (patch: Partial<EntityRecord> = {}): EntityRecord => ({ entityId: 4, kind: EntityKind.Player, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, bodyYaw: 0, aimPitch: 0, grounded: true, stateFlags: 0, equippedWeapon: Weapon.Rifle, ...patch })

describe('Phase 6 bounded character, camera and UX presentation', () => {
    it('audits articulated rig/socket calibration and every locomotion branch', () => {
        expect(auditActorCalibration()).toMatchObject({ passed: true })
        expect(ACTOR_SOCKET_LOCAL.muzzle.z).toBeLessThan(ACTOR_SOCKET_LOCAL.rightHand.z)
        expect(selectLocomotion(entity())).toBe('idle')
        expect(selectLocomotion(entity({ velocity: { x: 2, y: 0, z: 0 } }))).toBe('walk')
        expect(selectLocomotion(entity({ velocity: { x: 6, y: 0, z: 0 } }))).toBe('run')
        expect(selectLocomotion(entity({ stateFlags: 2 }))).toBe('crouch')
        expect(selectLocomotion(entity({ grounded: false }))).toBe('air')
        expect(selectLocomotion(entity({ stateFlags: 1 }))).toBe('dead')
        expect(evaluateActorPose(entity({ stateFlags: 4 }), 1).reloadWeight).toBe(1)
        expect(evaluateActorPose(entity(), 1, { recoil: 950 }, 1, 1000)).toMatchObject({ recoilWeight: expect.any(Number), wallTuckWeight: 1 })
        expect(auditViewmodelCalibration().passed).toBe(true)
    })
    it('keeps simulation aim one-way from camera feel and resets FOV/recoil', () => {
        const aim = new SimulationAim(); aim.set(.4, -.2); const before = aim.direction()
        const rig = new CameraRigController(1.1); rig.addRecoil(.1); rig.addDamage(.5); rig.setFovTarget(.8)
        const pose = rig.update({ predictedFeet: { x: 2, y: 1, z: 3 }, correctionResidual: { x: .1, y: 0, z: -.1 }, eyeHeight: 1.62, velocity: { x: 4, y: 0, z: 0 }, grounded: true, simulationYaw: .4, simulationPitch: -.2 }, 1 / 60)
        expect(pose.position.x).not.toBe(2); expect(pose.pitch).not.toBe(-.2); expect(aim.direction()).toEqual(before)
        rig.hardReset(); const reset = rig.update({ predictedFeet: { x: 0, y: 0, z: 0 }, correctionResidual: { x: 0, y: 0, z: 0 }, eyeHeight: 1.6, velocity: { x: 0, y: 0, z: 0 }, grounded: true, simulationYaw: 0, simulationPitch: 0 }, 0)
        expect(reset).toMatchObject({ yaw: 0, pitch: 0, fov: 1.1 })
    })
    it('correlates independent action IDs and repairs rejection/timeouts without mutating authority', () => {
        const combat = new CombatPresentationState(); combat.setPlayerId(7); combat.localFire(101, 9, Weapon.Rifle, 100); combat.localReload(102, 10, Weapon.Rifle, 100)
        combat.shot({ serverTick: 4, shooterId: 7, inputSequence: 9, actionId: 101, shotId: 2, weapon: Weapon.Rifle, origin: { x: 0, y: 1, z: 0 }, pelletEndPositions: [{ x: 0, y: 1, z: -80 }] })
        combat.actionResult({ serverTick: 4, actionId: 101, kind: ActionKind.Fire, accepted: false, reason: ActionRejectReason.Cadence, weapon: Weapon.Rifle, authoritativeMagazineAmmo: 20, authoritativeReserveAmmo: 80 }, 130)
        expect(combat.eventsAfter(0).find((event) => event.kind === 'shot')).toMatchObject({ correlated: true })
        expect(combat.eventsAfter(0).find((event) => event.kind === 'action-result')).toMatchObject({ latencyMs: 30 })
        expect(combat.expireActions(1700, 1500)).toBe(1); expect(combat.pendingActionCount).toBe(0)
        expect(combat.localPlayer.health).toBeNull()
    })
    it('replaces fixed effects by priority/age and caps decals', () => {
        type Slot = EffectSlot & { id: number }
        const pool = new BoundedEffectFamily<Slot>(2, (id) => ({ id, startedAtMs: 0, priority: 0 }), () => {})
        pool.acquire(1, 0); pool.acquire(2, 1); const replacement = pool.acquire(3, 2)
        expect(pool.telemetry).toMatchObject({ active: 2, capacity: 2, replacements: 1 }); expect(replacement.startedAtMs).toBe(3)
        const decals = new DecalBudget(2, 3, 10); for (let i = 0; i < 10; i++) decals.add({ x: i < 5 ? 1 : 20, z: 1 }, 'world', i)
        expect(decals.active).toBeLessThanOrEqual(3)
        expect(selectVoiceToSteal([{ priority: 2, startedAt: 2 }, { priority: 1, startedAt: 3 }, { priority: 1, startedAt: 1 }], 2)).toBe(2)
    })
    it('moves a short cosmetic tracer over multiple frames and fades after arrival', () => {
        const travel = tracerTravelDurationMs(80, Weapon.Rifle)
        const early = sampleTracerMotion(80, 16, travel)
        const middle = sampleTracerMotion(80, travel / 2, travel)
        const arrived = sampleTracerMotion(80, travel, travel)
        const faded = sampleTracerMotion(80, travel + TRACER_FADE_MS, travel)
        expect(travel).toBe(80)
        expect(tracerTravelDurationMs(20, Weapon.Shotgun)).toBeCloseTo(44.44, 1)
        expect(tracerTravelDurationMs(1, Weapon.Rifle)).toBe(24)
        expect(early.centerDistance).toBeLessThan(middle.centerDistance)
        expect(middle.streakLength).toBe(TRACER_LENGTH_METERS)
        expect(arrived.streakLength).toBeLessThan(80)
        expect(arrived.complete).toBe(false)
        expect(faded).toMatchObject({ opacity: 0, complete: true })
    })
    it('preserves radar aspect and reveals only fading gunfire rumors in FFA', () => {
        const projection = { minX: -40, maxX: 40, minZ: -20, maxZ: 20, northYaw: 0 }
        expect(radarAspectRatio(projection)).toBe(2); expect(projectRadar({ x: 0, z: 0 }, projection)).toEqual({ xPercent: 50, yPercent: 50 })
        const radar = new MinimapPrivacyModel(projection, 1000); radar.observeGunfire(9, { x: 10, y: 0, z: 5 }, 0)
        expect(radar.visibleEnemies([{ entityId: 99 }], 500)).toHaveLength(1); expect(radar.visibleEnemies([{ entityId: 99 }], 1001)).toHaveLength(0)
    })
    it('steps match animations and enumerates HUD/replay states deterministically', () => {
        const feel = new MatchFeelClock(); feel.hit(100); feel.resource(100); feel.kill(100)
        expect(feel.sample(150, 4.5)).toMatchObject({ countdownBeat: 5, hitOpacity: expect.any(Number), resourceFlash: expect.any(Number), killOpacity: expect.any(Number) })
        const common = { phase: MatchPhase.Active, dead: false, reloading: false, damaged: false, replay: 'live' as const }
        expect(deriveHudStates({ ...common, connection: 'connecting' })).toContain('connecting')
        expect(deriveHudStates({ ...common, connection: 'rejected', detail: 'map mismatch' })).toEqual(expect.arrayContaining(['rejection', 'mismatch']))
        expect(deriveHudStates({ ...common, connection: 'connected', dead: true, reloading: true, damaged: true, replay: 'killcam' })).toEqual(expect.arrayContaining(['active', 'death', 'reload', 'damage', 'killcam']))
        expect(deriveHudStates({ ...common, connection: 'reconnecting', phase: MatchPhase.Intermission, replay: 'spectator' })).toEqual(expect.arrayContaining(['reconnect', 'intermission', 'spectate']))
    })
    it('bounds killcam tape and samples pre-death playback with collision fallback', () => {
        const tape = new KillcamBuffer(3, 2); for (let i = 0; i < 5; i++) tape.recordPose({ atMs: i * 100, entityId: i % 2, position: { x: i, y: 0, z: 0 }, yaw: 0, pitch: 0 }); for (let i = 0; i < 4; i++) tape.recordEvent({ atMs: i * 100, kind: 'shot', sourceId: 1, targetId: null, position: null })
        expect(tape.size).toEqual({ poses: 3, events: 2 }); tape.beginPlayback(400, 1000, 300, 0); expect(tape.samplePlayback(1150)?.atMs).toBe(250)
        expect(frameKillcamCamera({ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, () => false).usedCollisionFallback).toBe(false)
        expect(frameKillcamCamera({ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, () => true).usedCollisionFallback).toBe(true)
    })
})
