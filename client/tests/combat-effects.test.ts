import { afterEach, describe, expect, it, vi } from 'vitest'
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js'
import { Scene } from '@babylonjs/core/scene.js'
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js'
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js'
import { CombatPresentationModule } from '../src/foundation/combat/CombatPresentationModule'
import { CombatPresentationState } from '../src/foundation/combat/CombatState'
import { INFANTRY_WEAPONS } from '../src/foundation/combat/WeaponDefinitions'
import {
    BULLET_HOLE_CAPACITY,
    WorldImpactEffects,
} from '../src/foundation/combat/WorldImpactEffects'
import {
    sampleTracerMotion,
    impactTravelDurationMs,
    shotAgeMs,
    tracerInitialAgeMs,
    tracerRibbonWidth,
} from '../src/foundation/combat/TracerMotion'
import {
    ServiceRegistry,
    type ClientModuleContext,
    type ServiceToken,
} from '../src/foundation/lifecycle'
import {
    AIMING,
    AUDIO,
    CAMERA,
    CAMERA_RIG,
    ENTITY_VIEWS,
    NETWORKING,
    PHYSICS,
    SCENE,
    SIMULATION_AIM,
} from '../src/foundation/services'
import {
    ActionKind,
    ActionRejectReason,
    ImpactMaterial,
    Weapon,
} from '../src/protocol/generated'

const disposers: (() => void)[] = []
afterEach(() => {
    disposers.reverse().forEach((dispose) => dispose())
    disposers.length = 0
    vi.restoreAllMocks()
})
function fixture() {
    const engine = new NullEngine(),
        scene = new Scene(engine)
    scene.useRightHandedSystem = true
    const camera = new FreeCamera('camera', new Vector3(0, 1.6, 0), scene)
    camera.setTarget(new Vector3(0, 1.6, -1))
    scene.activeCamera = camera
    const combat = new CombatPresentationState()
    combat.initializeOffline()
    const services = new ServiceRegistry()
    const provide = <T>(key: ServiceToken<T>, value: unknown) =>
        services.provide(key, value as T)
    provide(SCENE, scene)
    provide(CAMERA, camera)
    provide(NETWORKING, {
        combat,
        status: 'connected',
        weaponDefinitions: INFANTRY_WEAPONS,
        tickRate: 60,
        serverTickNow: undefined,
    })
    provide(PHYSICS, {
        probeStatic: () => undefined,
        velocity: Vector3.Zero(),
        grounded: true,
        movementState: undefined,
    })
    provide(AIMING, { snapshot: { aimProgress: 0 } })
    provide(SIMULATION_AIM, {
        direction: () => ({ x: 0, y: 0, z: -1 }),
        angles: { yaw: 0, pitch: 0 },
    })
    provide(CAMERA_RIG, { addRecoil: vi.fn(), addDamage: vi.fn() })
    provide(ENTITY_VIEWS, {
        getSocket: () => undefined,
        triggerOneShot: vi.fn(),
        get: () => undefined,
    })
    const audio = { playWeapon: vi.fn(), playImpact: vi.fn(), playUi: vi.fn() }
    provide(AUDIO, audio)
    const module = new CombatPresentationModule()
    module.initialize({ services } as ClientModuleContext)
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const update = (at: number) => {
        const dt = (at - now) / 1000
        now = at
        module.update({
            frame: 1,
            deltaSeconds: Math.max(1 / 60, dt),
            elapsedSeconds: now / 1000,
        })
        scene.render()
    }
    const shot = (id = 10, actionId = 1) =>
        combat.shot({
            serverTick: 100,
            shooterId: 2,
            inputSequence: 1,
            actionId,
            shotId: id,
            weapon: Weapon.Rifle,
            origin: { x: -40, y: 1.6, z: -5 },
            pelletEndPositions: [{ x: 380, y: 1.6, z: -5 }],
        })
    disposers.push(() => {
        module.dispose()
        scene.dispose()
        engine.dispose()
    })
    return { scene, camera, combat, module, update, shot, audio }
}

describe('projectile presentation regressions', () => {
    it('moves an incoming round past the viewer and respects world depth', () => {
        const f = fixture()
        f.shot()
        f.update(1000)
        f.update(1050)
        const ribbon = f.scene.meshes.find(
            (mesh) =>
                mesh.name.startsWith('tracer/') &&
                !mesh.name.endsWith('/tip') &&
                mesh.isEnabled()
        )!
        expect(ribbon.position.x).toBeLessThan(0)
        expect(ribbon.renderingGroupId).toBe(0)
        expect(ribbon.material?.disableDepthWrite).toBe(true)
        f.update(1100)
        expect(ribbon.position.x).toBeGreaterThan(10)
        expect(ribbon.isEnabled()).toBe(true)
        f.update(1800)
        expect(
            f.scene.meshes.filter(
                (m) => m.name.startsWith('tracer/') && m.isEnabled()
            )
        ).toHaveLength(0)
    })
    it('does not delete a flight when its future impact arrives in the same network batch', () => {
        const f = fixture()
        f.shot()
        f.update(1000)
        f.combat.impact({
            serverTick: 106,
            shotId: 10,
            pelletIndex: 0,
            position: { x: 22, y: 1.55095, z: -5 },
            normal: { x: -1, y: 0, z: 0 },
            material: ImpactMaterial.World,
        })
        f.update(1050)
        expect(f.audio.playImpact).not.toHaveBeenCalled()
        expect(
            f.scene.meshes.some(
                (m) => m.name.startsWith('tracer/') && m.isEnabled()
            )
        ).toBe(true)
        f.update(1101)
        expect(f.audio.playImpact).toHaveBeenCalledTimes(1)
        f.update(1200)
        expect(f.audio.playImpact).toHaveBeenCalledTimes(1)
        expect(
            f.scene.meshes.some(
                (m) => m.name.startsWith('tracer/') && m.isEnabled()
            )
        ).toBe(false)
    })
    it('only repairs local effects when a remote shooter has the same action ID', () => {
        const f = fixture()
        f.shot()
        f.combat.localFire(1, 1, Weapon.Rifle, 1000)
        f.update(1000)
        f.combat.actionResult(
            {
                serverTick: 100,
                actionId: 1,
                kind: ActionKind.Fire,
                accepted: false,
                reason: ActionRejectReason.Cadence,
                weapon: Weapon.Rifle,
                authoritativeMagazineAmmo: 30,
                authoritativeReserveAmmo: 120,
            },
            1000
        )
        f.update(1030)
        expect(
            f.scene.meshes.filter(
                (m) =>
                    m.name.startsWith('tracer/') &&
                    !m.name.endsWith('/tip') &&
                    m.isEnabled()
            )
        ).toHaveLength(1)
    })
    it('clips the head while the tail keeps moving, at 30, 60 and 144 FPS', () => {
        for (const fps of [30, 60, 144]) {
            const end = sampleTracerMotion(62, 100, 100, 1000 / fps)
            const after = sampleTracerMotion(62, 104, 100, 1000 / fps)
            expect(after.headDistance).toBe(62)
            expect(after.tailDistance).toBeGreaterThan(end.tailDistance)
            expect(after.streakLength).toBeLessThan(end.streakLength)
            expect(after.headOpacity).toBe(0)
            expect(sampleTracerMotion(62, 132, 100, 1000 / fps).complete).toBe(
                true
            )
        }
        expect(shotAgeMs(0xfffffffe, 1, 60)).toBe(50)
        expect(shotAgeMs(100, undefined, 60)).toBe(0)
    })
    it('preserves close-impact and uphill/downhill flight times without tick rounding', () => {
        expect(impactTravelDurationMs(5, 620, 9.81, 0)).toBeCloseTo(
            (1000 * 5) / 620
        )
        for (const y of [-0.9, 0, 0.9]) {
            const t = 0.2,
                projected = 620 * t - 0.5 * 9.81 * y * t * t
            expect(impactTravelDurationMs(projected, 620, 9.81, y)).toBeCloseTo(
                200
            )
        }
    })
    it('projects actual clipped holes onto non-pickable map meshes and preserves every hole until its timed fade expires', () => {
        const engine = new NullEngine(),
            scene = new Scene(engine)
        const wall = CreateBox(
            'map/test-wall',
            { width: 8, height: 8, depth: 1 },
            scene
        )
        wall.isPickable = false
        wall.computeWorldMatrix(true)
        const effects = new WorldImpactEffects(scene)
        disposers.push(() => {
            effects.dispose()
            scene.dispose()
            engine.dispose()
        })
        for (let i = 0; i < 35; i++)
            effects.impact(
                { x: 0.1 + i * 0.1, y: 0.1, z: -0.5 },
                { x: 0, y: 0, z: -1 },
                false,
                1000 + i
            )
        const decals = scene.meshes.filter((m) => m.name.startsWith('decal/'))
        expect(decals).toHaveLength(35)
        expect(
            decals.every((m) => m.getTotalVertices() > 0 && !m.isPickable)
        ).toBe(true)
        effects.update(41000, new Vector3(0, 0, -5))
        expect(decals.every((m) => !m.isDisposed() && m.visibility === 1)).toBe(
            true
        )
        effects.update(45000, new Vector3(0, 0, -5))
        expect(decals[0]!.visibility).toBeCloseTo(0.2)
        effects.update(46001, new Vector3(0, 0, -5))
        expect(decals[0]!.isDisposed()).toBe(true)
        expect(decals[34]!.isDisposed()).toBe(false)
        effects.update(48000, new Vector3(0, 0, -5))
        expect(
            scene.meshes.filter((m) => m.name.startsWith('decal/'))
        ).toHaveLength(0)
        expect(effects.telemetry.active).toBe(0)
    })
    it('preserves existing decals at the emergency capacity and admits new ones after expiration', () => {
        const engine = new NullEngine(),
            scene = new Scene(engine)
        const wall = CreateBox('map/wall', { size: 4 }, scene)
        wall.computeWorldMatrix(true)
        const effects = new WorldImpactEffects(scene)
        disposers.push(() => {
            effects.dispose()
            scene.dispose()
            engine.dispose()
        })
        const emit = (time: number) =>
            effects.impact(
                { x: 0, y: 0, z: -2 },
                { x: 0, y: 0, z: -1 },
                false,
                time
            )
        for (let i = 0; i < BULLET_HOLE_CAPACITY; i++) emit(1000)
        const first = scene.meshes.find((m) => m.name.startsWith('decal/'))!
        emit(2000)
        expect(first.isDisposed()).toBe(false)
        expect(
            scene.meshes.filter((m) => m.name.startsWith('decal/'))
        ).toHaveLength(BULLET_HOLE_CAPACITY)
        emit(46000)
        expect(first.isDisposed()).toBe(true)
        expect(
            scene.meshes.filter((m) => m.name.startsWith('decal/'))
        ).toHaveLength(1)
    })
    it('retains visible flight after delayed delivery and a pixel-sized core at every render tier', () => {
        expect(tracerInitialAgeMs(1000, 130)).toBeCloseTo(19.5)
        expect(
            sampleTracerMotion(80, tracerInitialAgeMs(1000, 130), 130).complete
        ).toBe(false)
        for (const height of [351, 720, 1440])
            for (const distance of [30, 120, 420]) {
                const width = tracerRibbonWidth(distance, 1.2, height)
                const projectedWidth =
                    (width / (2 * distance * Math.tan(0.6))) * height
                expect(projectedWidth).toBeGreaterThanOrEqual(5.99)
            }
    })
})
